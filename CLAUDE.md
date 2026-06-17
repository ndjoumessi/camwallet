# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CamWallet is a QR-based prepaid payment app for Cameroon, backed by Orange Money and MTN Mobile Money. Users hold a virtual balance ("Crédit QR") — the product deliberately operates without a BEAC/COBAC banking licence, so the wallet is internal credit, not a bank account.

Monorepo with three independent sub-projects (no workspace tooling — each has its own `package.json` and `node_modules`):

- `backend/` — NestJS + Prisma + PostgreSQL REST API. The source of truth and the only datastore.
- `mobile/` — React Native + Expo (SDK 54, React 19, RN 0.81). **Wired to the real API** via `mobile/src/lib/api.ts` (axios + auto-refresh). Auth, profile, QR scan and push notifications are real. A few screens still read demo data from the Zustand store (`mobile/app/store/useStore.ts`) — notably `HomeScreen` balance/contacts and the `SendModal` send flow — so don't assume every screen is API-backed yet.
- `camwallet-admin/` — React + Vite + Recharts dashboard. **Wired to the real API** via `camwallet-admin/src/lib/api.ts` (native `fetch` + auto-refresh). All pages (dashboard, users, transactions, alerts, KYC, finance) read from the API; the monthly demo arrays are gone.

The frontend↔API integration layer **exists** now (it was built out across the admin and mobile clients). When adding features, extend the existing `src/lib/api.ts` client in each frontend rather than starting from scratch.

## Commands

All commands run from inside the respective sub-directory.

### backend
```bash
npm install
npx prisma migrate dev          # apply migrations (creates DB schema)
npm run prisma:generate         # regenerate Prisma client after schema.prisma edits
npm run prisma:seed             # seed dev data (prisma/seed.ts)
npm run start:dev               # watch mode, http://localhost:3000, Swagger at /api/docs
npm run test                    # jest unit tests (*.spec.ts under src/)
npm run test -- path/to.spec.ts # run a single test file
npm run test:e2e                # e2e tests (test/jest-e2e.json)
npm run lint                    # eslint --fix
```
After any `schema.prisma` change, run `prisma migrate dev` (regenerates the client) **and restart `start:dev`** — the running watcher holds the old generated client in memory until restarted.

### mobile
```bash
npm install
npx expo start                  # then scan QR with Expo Go (Metro on :8081)
npm run android | ios | web
```
Native modules in use: `expo-camera` (QR scan), `expo-notifications` (push), `expo-image-picker` (avatar), `expo-local-authentication` (biometrics). Camera/push/biometrics/gallery need a real device; code degrades gracefully on simulator / Expo Go.

### camwallet-admin
```bash
npm install
npm run dev                     # http://localhost:3001
npm run build                   # tsc + vite build
```
There is **no `tsconfig.json`** in the admin project, so the `tsc` step in `build` is effectively a no-op and Vite (esbuild) does not type-check. Validate admin changes with `npm run build` (catches syntax/transform errors); unused-var/type errors will not fail the build.

## Backend architecture

NestJS module-per-domain layout under `backend/src/`: `auth`, `users`, `wallets`, `transactions`, `qr`, `webhooks`, `admin`, `kyc`, `merchant`, `disputes`, `support`, `campay` (Orange Money + MTN MoMo PSP client), `sse` (admin real-time), `health`, plus global modules `prisma`, `notifications` (Expo push), `cloudinary` (image upload), and `common` (shared decorators/guards/middleware/i18n). `AppModule` wires them with global `ConfigModule`, `ThrottlerModule` (10 req / 60s), `ScheduleModule` (cron for withdrawal expiry) and `EventEmitterModule` (feeds SSE).

Bootstrap conventions (`main.ts`) that affect every route:
- Global prefix `api/v1` — all endpoints live under `/api/v1/...`.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` (+ `transform`) — DTOs reject unknown fields, so request bodies must match the `class-validator` DTOs exactly.
- A global `BigInt.prototype.toJSON` converts every BigInt to **Number** in JSON responses (so amounts arrive as numbers in centimes — see below).
- Global `I18nExceptionFilter` translates error messages by the request's `Accept-Language` header (FR default, EN supported) — see *i18n* below.
- `helmet()` + `compression()` applied; app created with `rawBody: true` (needed for webhook signature verification).
- `TRUST_PROXY` env controls Express `trust proxy` (off by default; set when behind Nginx/Railway edge so `req.ip` is trustworthy and X-Forwarded-For is not spoofable).
- `keepAliveTimeout` (90s) / `headersTimeout` (95s) are raised above the edge proxy's idle timeout to avoid intermittent 502s on reused keep-alive sockets (Railway).
- Swagger UI is mounted at `/api/docs` only when `NODE_ENV !== 'production'`.
- CORS is `*` in dev, locked to `admin.camwallet.cm` / `app.camwallet.cm` in production.
- **Admin routes hardening**: `IpWhitelistMiddleware` + `AdminOriginMiddleware` are applied to `api/v1/admin/*` (env `ADMIN_IP_WHITELIST`, `ADMIN_ALLOWED_ORIGINS`; both no-op when unset, for dev).
- `GET /api/v1/health` (status/version/uptime) is public and used by the Railway healthcheck.

### Money is stored as BigInt centimes — this is the #1 gotcha
All amounts in the database and backend (`Wallet.balance`, `Transaction.amount`/`fee`, limits) are `BigInt` in **centimes of FCFA** (1 FCFA = 100). Example: `10000` = 100 FCFA. This avoids floating-point errors. Always use `bigint` literals (`5n`, `1000n`) in arithmetic. Responses serialize BigInt → Number (centimes); **both frontends convert centimes → whole FCFA at the boundary** (`toFcfa` in each `src/lib/api.ts`). The mobile demo store still uses whole-FCFA numbers.

### Financial integrity
Balance mutations (P2P, QR payment, webhook crediting) must be atomic — `prisma.$transaction(...)` doing debit + credit + transaction-record insert together (`transactions/transactions.service.ts`). Never debit/credit in separate awaits. Merchant commission on QR payments is `(amount * 5n) / 1000n` (0.5%). Side effects that must not break the money flow (e.g. push notifications) run **after** the `$transaction` resolves and are fire-and-forget.

### Auth flow
Phone + 6-digit PIN for users; email + password for admin. User registration is a 3-step OTP flow: `register` → `verifyOtp` → `setPin` (bcrypt cost 12, issues JWTs). Login compares the PIN; after `MAX_PIN_ATTEMPTS` (3) failures the account locks 30 min (`User.lockedUntil`). JWTs use separate access/refresh secrets; `JwtStrategy` is stateless (returns `{ id: sub, role, adminRole }`, no DB lookup); `AdminGuard` checks `role === ADMIN`.

**Admin auth** (`POST /auth/login-admin`): validates `email`/`password` against `ADMIN_EMAIL`/`ADMIN_PASSWORD` config with a **constant-time compare** (SHA-256 + `timingSafeEqual`), an in-memory per-email **lockout** (5 attempts → 15 min), and rejects when the config is unset. The issued token's `sub` is the real seeded ADMIN user's id (so admin actions are attributable in `AuditLog`) and carries an `adminCredHash` claim; `/auth/refresh` re-validates that hash, so rotating `ADMIN_PASSWORD` invalidates already-issued admin tokens. A second path, **per-user admin login** (`loginAdminUser`), authenticates team operators against their own `User.passwordHash` (role `ADMIN`, `status = ACTIVE`); those tokens carry `tv` (tokenVersion) instead of `adminCredHash` and are refresh-validated by tokenVersion.

### RBAC backend — sub-roles (`adminRole`)
`AdminGuard` only proves `role === ADMIN`. Beyond that, the backend enforces **sub-role permissions** from the JWT `adminRole` claim (`SUPER_ADMIN`, `ADMIN`, `COMPLIANCE_OFFICER`, `SUPPORT_OPERATOR`, `FINANCE_OFFICER`, `KYC_OFFICER`), mirroring the frontend RBAC. This is the authoritative layer — the frontend `ROLE_PAGES`/action gating is cosmetic; without the backend guard an operator could bypass the UI via the API.

- `src/admin/rbac/permissions.ts` — `ROLE_PERMISSIONS` matrix (sub-role → `resource:action` permission strings; `SUPER_ADMIN = ['*']`) + `roleHasPermission()`. **`isFullAccess`: `SUPER_ADMIN` and a legacy token with no `adminRole` get full access** (anti-lockout during rollout); an *unknown* non-null role gets nothing (stricter than the frontend, which defaults unknown to `*`).
- `@RequirePermission('resource:action')` (`require-permission.decorator.ts`) annotates a route; `PermissionsGuard` reads the metadata and throws 403 if the token's sub-role lacks it. **A route with no `@RequirePermission` is open to any admin** — used deliberately for cross-page reads (stats/lists, `GET /admin/team` for assignment dropdowns) that the frontend already hides per page. Strict gating targets **writes and sensitive reads** (KYC PII, audit, settings, team management, support).
- Apply order: `@UseGuards(AuthGuard('jwt'), AdminGuard, PermissionsGuard)` on `AdminController` and `SupportController`.
- Matrix summary: `ADMIN` = everything except team management, global settings, and ticket delete; `COMPLIANCE_OFFICER` = ANIF + audit + ANIF settings; `SUPPORT_OPERATOR` = support read/write + read users/transactions (no writes, no `support:delete`); `FINANCE_OFFICER` = metrics + operations; `KYC_OFFICER` = KYC only. Ticket delete (`support:delete`) and team management (`team:manage`) are **SUPER_ADMIN-only**.
- **Key-level cloisonnement**: `AdminService.updateSettings(adminId, updates, adminRole)` rejects (403) any non-`anif_*` key for non-`SUPER_ADMIN` callers, so `COMPLIANCE_OFFICER`/`ADMIN` can edit ANIF thresholds but not global settings (`require_2fa`, etc.).
- `refresh` preserves `adminRole` (config admin: from the claim, default `SUPER_ADMIN`; per-user operators: re-read from `User.adminRole`), so a refreshed operator token keeps its restricted sub-role.
- Unit tests: `src/admin/rbac/permissions.spec.ts`.

### Notifications & uploads
- `notifications/notifications.service.ts` sends Expo push via the Expo Push API after each **received** credit (P2P, QR payment, recharge). Non-blocking. Users register their Expo token via `POST /users/push-token` (stored on `User.pushToken`).
- `cloudinary/cloudinary.service.ts` uploads images (avatars + KYC documents). Validates the real type by **magic-byte signature** (PNG/JPEG/WEBP only — never the client MIME, so SVG/script payloads are rejected). When Cloudinary env is unset/placeholder it falls back to a base64 **data URI**, so uploads work in dev without credentials.

### KYC
`kyc/kyc.service.ts` handles identity verification. `POST /kyc/submit` takes three images (CNI recto + verso + selfie, `FileFieldsInterceptor`), uploads each via `CloudinaryService`, upserts the `KycDocument`, and sets `User.kycStatus = SUBMITTED` (atomic `$transaction`). `GET /kyc/status` returns the caller's status. Admins review via `GET /admin/kyc` (queue with photo URLs) → `PATCH /admin/kyc/:userId` (approve/reject, audited). `KycStatus`: `PENDING → SUBMITTED → APPROVED | REJECTED`.

### Payments via CamPay (recharge & withdrawal)
`campay/campay.service.ts` is the real PSP client (aggregates Orange Money + MTN MoMo for Cameroon; sandbox `demo.campay.net`, prod `campay.net`). It caches an OAuth token and exposes `collect` (recharge) and `withdraw` (payout). Env: `CAMPAY_BASE_URL`, `CAMPAY_USERNAME`, `CAMPAY_PASSWORD`, `CAMPAY_APP_TOKEN`, `CAMPAY_WEBHOOK_KEY`.
- **Recharge** (`WalletsService.recharge`): calls CamPay `/collect` to trigger the mobile-money prompt, records a `PENDING` transaction with the CamPay reference, and returns the USSD code. The actual credit is applied **by the CamPay webhook**, never synchronously. Sandbox caps amounts at 25 FCFA (2500 centimes).
- **Withdrawal** (`WalletsService.withdraw`): reserves (debits) the balance atomically, then fires CamPay `/withdraw` asynchronously (fire-and-forget). If CamPay fails, the withdrawal stays `PENDING` and is later expired + **refunded** by `WithdrawalsExpiryService` (a `@Cron` every 30s, window `WITHDRAWAL_TIMEOUT_MINUTES`).

### Webhooks
`webhooks/webhooks.service.ts` ingests CamPay / Orange Money / MTN MoMo callbacks (`POST /webhooks/campay`, `/orange-money`, `/mtn-momo`). Every raw event is persisted to `WebhookEvent` before processing; a `SUCCESSFUL` event matches a `PENDING` transaction by `operatorRef` and credits atomically. **Signature verification is now enforced** (no longer stubbed): CamPay `sha256(token+reference)`, OM HMAC-SHA256 over the raw body, MTN token compare — all timing-safe. In production a missing `OM_WEBHOOK_SECRET` / `MTN_WEBHOOK_SECRET` / `CAMPAY_WEBHOOK_KEY` throws; in dev it logs a `[SÉCU]` warning and skips (which is why `main.ts` enables `rawBody`).

### Real-time (SSE) for the admin
`sse/sse.service.ts` bridges `EventEmitter` events (`transaction|user|kyc|dispute|ping`) to an RxJS stream. To avoid leaking the JWT in a URL (logs/Referer/history), the admin first calls `POST /admin/sse-ticket` (JWT header → opaque single-use UUID, 60s TTL), then opens `GET /admin/events?ticket=...` (`@Sse()`). The admin "Alertes & Surveillance" page consumes this.

### Merchant & disputes (mobile-facing)
- **merchant** (JWT + `MerchantGuard`, allows `MERCHANT` or `ADMIN`): `GET /merchant/stats` (revenue day/week/month), `GET /merchant/transactions` (paginated received payments).
- **disputes** (JWT): `POST /disputes` (contest a transaction → `DisputeRequest`), `GET /disputes/me`. Backed by `TransactionsService.openDispute` / `getUserDisputes`.

### i18n (backend)
`common/i18n/` translates outbound error messages. `I18nExceptionFilter` (global) reads `Accept-Language`, `resolveLang` picks `fr`|`en` (FR default), and `translateMessage` maps French source strings to English via `error-messages.ts` (exact + interpolated-prefix matching). French is the source language; untranslated strings fall back to French.

### Data model
`schema.prisma` is the source of truth. Central tables: `User` → `Wallet` (1:1), `Transaction` (sender/receiver self-relations), `KycDocument` (1:1), `AuditLog` (ANIF traceability; `userId` nullable), plus `WebhookEvent`, `OtpCode`, `QrCode`, `SystemSettings`, `LoyaltyPoints`, `AdminNote`, `DisputeRequest`, and the Support trio `SupportTicket` → `SupportMessage` (with `TicketCategory`/`TicketPriority`/`TicketStatus` enums). `User` carries `role`, `status`, `kycStatus`, `adminRole`, `passwordHash`/`tokenVersion` (operator login), plus `pushToken`, `avatarUrl`, `dateOfBirth`, `city`. After editing `schema.prisma`, run a migration + `prisma:generate` and restart the dev server.

### API surface (selected)
- **auth**: `register`, `verify-otp`, `set-pin`, `login`, `login-admin`, `refresh`, `pin-reset/request`.
- **users** (JWT): `GET /users/me` (profile + wallet + stats: tx count, total sent/received), `PATCH /users/profile` (fullName, email, dateOfBirth, city), `POST /users/avatar` (multipart upload), `POST /users/push-token`.
- **wallet/transactions** (JWT): P2P send, QR payment, `recharge` (CamPay collect), `withdraw` (CamPay payout).
- **merchant** (JWT + MerchantGuard): `GET /merchant/stats`, `GET /merchant/transactions`.
- **disputes** (JWT): `POST /disputes`, `GET /disputes/me`.
- **kyc** (JWT): `POST /kyc/submit` (3-image multipart upload), `GET /kyc/status`.
- **webhooks** (public, signed): `POST /webhooks/campay`, `/orange-money`, `/mtn-momo`.
- **admin** (JWT + AdminGuard + `PermissionsGuard`): `GET /admin/stats`, `GET /admin/stats/timeseries?period=7d|30d|90d`, `GET /admin/users` (search + `status` filter), `GET /admin/users/:id` (detail: info, KYC doc, transactions, audit, stats), `PATCH /admin/users/:id/status` (block/unblock), `POST /admin/users/:id/reset-pin`, `GET /admin/kyc` + `PATCH /admin/kyc/:userId` (approve/reject), `GET /admin/transactions`, `GET /admin/alerts`, `GET /admin/audit`, `POST /admin/sse-ticket` + `GET /admin/events` (SSE), plus `anif/*`, `operations/*`, `settings`, `team/*`, and **`admin/support/*`** (tickets). Routes are gated per sub-role via `@RequirePermission` (see *RBAC backend* above). Admin moderation actions write to `AuditLog`.

## Frontend integration

Both frontends have a `src/lib/api.ts` client: token storage (mobile = `expo-secure-store`; admin = `localStorage`), Bearer header, and **single-flight refresh on 401**. The admin uses a shared `useFetch(fn, deps)` hook (`App.tsx`) returning `{ data, loading, error, refetch }`, a `RefreshContext` nonce for the "Actualiser" button, and `buildQuery` for query strings. The admin dashboard is still one large `App.tsx` (~4.6k lines) with inline styles and a `C` design-token object, but the login screen is now extracted to `LoginPage.tsx`; convert centimes→FCFA via `toFcfa` and format with `toLocaleString('fr-FR')`.

### Admin i18n & operator landing
- **i18n**: `src/i18n.ts` wires `react-i18next` with `locales/fr.json` + `locales/en.json` (FR default, persisted in `localStorage['lang']`); the login screen has an FR|EN selector.
- **Two surfaces, one Vite app**: `/` and `/operateurs` serve the static operator landing **"La Chambre Forte"** (`public/index-operateurs.html`); the dashboard lives under `/admin`. In production this routing is `vercel.json` (which also sets CSP + security headers); in dev the `serveLandingInDev` plugin in `vite.config.ts` rewrites `/` and `/operateurs` to the same HTML (no copy — single source). When touching routing, keep `vercel.json` and the Vite plugin in parity.

## Deployment

- **Backend → Railway**: built/started from the repo root via `railway.json` (and `nixpacks.toml` / root `package.json`): build `cd backend && npm ci && prisma generate && build`, start `prisma migrate deploy && node dist/main`, healthcheck `/api/v1/health`. Railway **auto-deploys** via its GitHub integration — there is **no CI deploy job** (it was removed; CI only lints/tests).
- **Admin → Vercel**: `vercel build` (vite) per `vercel.json`.

## Environment

Each sub-project needs a `.env` from its example. `backend/.env.example` and `camwallet-admin/.env.example` are committed. Relevant vars: mobile `EXPO_PUBLIC_API_URL` (origin, `/api/v1` appended), admin `VITE_API_URL` (defaults to `http://localhost:3000`). Backend env: `DATABASE_URL`, JWT secrets, AfricasTalking SMS (OTP), **CamPay** credentials (`CAMPAY_*`), webhook secrets (`CAMPAY_WEBHOOK_KEY`, `OM_WEBHOOK_SECRET`, `MTN_WEBHOOK_SECRET`), `WITHDRAWAL_TIMEOUT_MINUTES`, `TRUST_PROXY`, `ADMIN_IP_WHITELIST`, `ADMIN_ALLOWED_ORIGINS`, Cloudinary, and `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

Dev test credentials (seed): user `+237677000001`, merchant `+237699000002`, all PIN `123456`; admin `admin@camwallet.cm` / `Admin@2025!`.

## Notes

- The backend `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`) — code uses non-null assertions (`amount!`) freely.
- The admin has **no `tsconfig.json`**; rely on `vite build` to catch errors.
- `mobile/` declares `expo-router` but `app/index.tsx` is a manual `splash → onboard → app` phase + tab-switch state machine, not file-based routing. Don't assume route files map to screens.
- In zsh, `$UID` is a readonly variable — don't use `UID` as a shell var name when scripting curl tests against user ids.
- The whole codebase (comments, log messages, user-facing strings) is in French — match that when editing.
- `DESIGN.md` (design tokens — dark fintech palette, type scale) and `PRODUCT.md` (users, brand, design principles) at the repo root capture the product/visual brief; consult them for UI work.
