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

NestJS module-per-domain layout under `backend/src/`: `auth`, `users`, `wallets`, `transactions`, `qr`, `webhooks`, `admin`, `kyc`, plus global modules `prisma`, `notifications` (Expo push), and `cloudinary` (image upload). `AppModule` wires them with global `ConfigModule` and `ThrottlerModule` (10 req / 60s).

Bootstrap conventions (`main.ts`) that affect every route:
- Global prefix `api/v1` — all endpoints live under `/api/v1/...`.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` — DTOs reject unknown fields, so request bodies must match the `class-validator` DTOs exactly.
- A global `BigInt.prototype.toJSON` converts every BigInt to **Number** in JSON responses (so amounts arrive as numbers in centimes — see below).
- Swagger UI is mounted at `/api/docs` only when `NODE_ENV !== 'production'`.
- CORS is `*` in dev, locked to `admin.camwallet.cm` / `app.camwallet.cm` in production.

### Money is stored as BigInt centimes — this is the #1 gotcha
All amounts in the database and backend (`Wallet.balance`, `Transaction.amount`/`fee`, limits) are `BigInt` in **centimes of FCFA** (1 FCFA = 100). Example: `10000` = 100 FCFA. This avoids floating-point errors. Always use `bigint` literals (`5n`, `1000n`) in arithmetic. Responses serialize BigInt → Number (centimes); **both frontends convert centimes → whole FCFA at the boundary** (`toFcfa` in each `src/lib/api.ts`). The mobile demo store still uses whole-FCFA numbers.

### Financial integrity
Balance mutations (P2P, QR payment, webhook crediting) must be atomic — `prisma.$transaction(...)` doing debit + credit + transaction-record insert together (`transactions/transactions.service.ts`). Never debit/credit in separate awaits. Merchant commission on QR payments is `(amount * 5n) / 1000n` (0.5%). Side effects that must not break the money flow (e.g. push notifications) run **after** the `$transaction` resolves and are fire-and-forget.

### Auth flow
Phone + 6-digit PIN for users; email + password for admin. User registration is a 3-step OTP flow: `register` → `verifyOtp` → `setPin` (issues JWTs). Login compares the PIN; after `MAX_PIN_ATTEMPTS` (3) failures the account locks 30 min (`User.lockedUntil`). JWTs use separate access/refresh secrets; `JwtStrategy` is stateless (returns `{ id: sub, role, adminRole }`, no DB lookup); `AdminGuard` checks `role === ADMIN`.

**PIN hashing — pepper + bcrypt** (`auth.service.ts`): every PIN is `bcrypt(HMAC-SHA256(pin, PIN_PEPPER), cost 10)`. The **pepper** (`PIN_PEPPER` env, `openssl rand -base64 32`) lives only in the environment — a DB-only leak (bcrypt hashes) can't be brute-forced without it, which matters given the tiny 6-digit keyspace. `bcrypt` cost is **10** (`PIN_BCRYPT_COST`), tuned down from 12 for login latency (brute-force is already bounded by the lockout). Two helpers: `pepperPin()` applies the HMAC (falls back to the raw PIN when `PIN_PEPPER` is unset — dev/local); `comparePin()` checks the peppered hash, then **falls back to the legacy raw-PIN hash and transparently re-hashes** (migration on next login), so introducing/rotating in nothing-breaks fashion is automatic for existing users. Admin/operator *passwords* (`admin.service.ts`) stay at bcrypt cost 12, no pepper. **`PIN_PEPPER` must be set durably in prod (Railway) and never rotated without the old value** — rotating it locks out every un-migrated PIN.

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

### Webhooks
`webhooks/webhooks.service.ts` ingests CamPay / Orange Money / MTN MoMo callbacks. Every raw event is persisted to `WebhookEvent` before processing; a `SUCCESSFUL` event matches a `PENDING` transaction by `operatorRef` and finalizes it atomically (RECHARGE credits the receiver; WITHDRAWAL just confirms — funds were reserved at request time; a `FAILED` withdrawal re-credits `amount + fee`). Processing is **idempotent** — only a still-`PENDING` tx is touched, so replayed callbacks are acquitted without double-crediting.

**Signature/token verification is implemented and fail-closed in prod:**
- **Orange Money** (`verifyOmSignature`) — `HMAC-SHA256(rawBody, OM_WEBHOOK_SECRET)` compared to the request signature with `crypto.timingSafeEqual` (constant-time).
- **MTN MoMo** (`verifyMtnToken`) — constant-time compare of `SHA-256(token)` vs `SHA-256(MTN_WEBHOOK_SECRET)` (hashing both first guarantees equal-length buffers for `timingSafeEqual`).
- **CamPay** (`campay.verifyWebhookSignature`) — verified signature; since the CamPay scheme (`sha256(token+reference)`) doesn't cover the amount, the service **cross-validates the payload amount against the DB transaction** before crediting (CamPay sends whole FCFA → ×100 to centimes), rejecting any mismatch.
- **Fail-closed**: if the relevant `*_WEBHOOK_SECRET` is unset, the handler throws `500` when `NODE_ENV === 'production'` (never accept an unauthenticated webhook in prod) and only **skips** verification with a `[SÉCU]` warning in dev. OM/MTN raw bodies must reach the handler intact for HMAC verification — keep the raw `Buffer` available (don't let a global JSON parser consume it before signature check).

### Data model
`schema.prisma` is the source of truth. Central tables: `User` → `Wallet` (1:1), `Transaction` (sender/receiver self-relations), `KycDocument` (1:1), `AuditLog` (ANIF traceability; `userId` nullable). `User` carries `role`, `status`, `kycStatus`, plus `pushToken`, `avatarUrl`, `dateOfBirth`, `city`. `Transaction` has **composite indexes `(senderId, createdAt)` and `(receiverId, createdAt)`** serving the history query (`WHERE senderId=? OR receiverId=? ORDER BY createdAt DESC`) — they supersede the old single-column `senderId`/`receiverId` indexes. After editing `schema.prisma`, run a migration + `prisma:generate` and restart the dev server.

### Performance & latence (prod)
The PIN login path was the latency hot spot. Measured with the k6 suite under `scripts/load-tests/*.js` (`BASE_URL=… k6 run scripts/load-tests/smoke.js`), p95 went from ~3s to ~400ms. The fixes, in order of impact:
- **Region co-location** — the Railway service was moved from `iad` (US-East) to **EU West**, next to the Supabase DB (`aws-0-eu-west-1`, Ireland). Cross-Atlantic DB round-trips were the dominant cost; **keep compute and DB in the same region**.
- **Connection pool** — `DATABASE_URL` (Supabase transaction pooler, `:6543`, `pgbouncer=true`) carries **`connection_limit=10&pool_timeout=20`**. Prisma's small default pool (`num_cpus×2+1`) starved under concurrency, queueing every query; this was the single biggest win and speeds up **every** endpoint. `prisma.service.ts` holds no pool config — it's all in the URL.
- **`login()` write is off the critical path** — on the common path (no failed attempts) it fire-and-forgets the `lastLoginAt` touch; it only `await`s the DB write when it must durably reset the brute-force counter (`pinAttempts`/`lockedUntil`). Worth ~200ms at p95.
- **bcrypt cost 10** for PINs (see *Auth flow*).
- `health/keep-warm.service.ts` — a `@Cron` every 5 min runs `SELECT 1` to keep the Prisma/pooler connection warm. NB: an internal cron can't wake a truly *sleeping* Railway container — use an external uptime pinger on `GET /api/v1/health` for that.

### API surface (selected)
- **auth**: `register`, `verify-otp`, `set-pin`, `login`, `login-admin`, `refresh`, `pin-reset/request`.
- **users** (JWT): `GET /users/me` (profile + wallet + stats: tx count, total sent/received), `PATCH /users/profile` (fullName, email, dateOfBirth, city), `POST /users/avatar` (multipart upload), `POST /users/push-token`.
- **kyc** (JWT): `POST /kyc/submit` (3-image multipart upload), `GET /kyc/status`.
- **admin** (JWT + AdminGuard + `PermissionsGuard`): `GET /admin/stats`, `GET /admin/stats/timeseries?period=7d|30d|90d`, `GET /admin/users` (search + `status` filter), `GET /admin/users/:id` (detail: info, KYC doc, transactions, audit, stats), `PATCH /admin/users/:id/status` (block/unblock), `POST /admin/users/:id/reset-pin`, `GET /admin/kyc` + `PATCH /admin/kyc/:userId` (approve/reject), `GET /admin/transactions`, `GET /admin/alerts`, `GET /admin/audit`, plus `anif/*`, `operations/*`, `settings`, `team/*`, and **`admin/support/*`** (tickets). Routes are gated per sub-role via `@RequirePermission` (see *RBAC backend* above). Admin moderation actions write to `AuditLog`.

## Frontend integration

Both frontends have a `src/lib/api.ts` client: token storage (mobile = `expo-secure-store`; admin = `localStorage`), Bearer header, and **single-flight refresh on 401**. The admin uses a shared `useFetch(fn, deps)` hook (`App.tsx`) returning `{ data, loading, error, refetch }`, a `RefreshContext` nonce for the "Actualiser" button, and `buildQuery` for query strings. The admin is a single large `App.tsx` with inline styles and a `C` design-token object; convert centimes→FCFA via `toFcfa` and format with `toLocaleString('fr-FR')`.

## Environment

Each sub-project needs a `.env` from its example. `backend/.env.example` and `camwallet-admin/.env.example` are committed. Relevant vars: mobile `EXPO_PUBLIC_API_URL` (origin, `/api/v1` appended), admin `VITE_API_URL` (defaults to `http://localhost:3000`). Backend env: `DATABASE_URL` (in prod, append `?pgbouncer=true&connection_limit=10&pool_timeout=20` — see *Performance*), JWT secrets, `PIN_PEPPER` (HMAC pepper for PIN hashing — set durably in prod, never rotate without the old value), AfricasTalking SMS (OTP), Orange Money + MTN MoMo credentials, Cloudinary, and `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

Dev test credentials (seed): user `+237677000001`, merchant `+237699000002`, all PIN `123456`; admin `admin@camwallet.cm` / `Admin@2025!`.

## Notes

- The backend `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`) — code uses non-null assertions (`amount!`) freely.
- The admin has **no `tsconfig.json`**; rely on `vite build` to catch errors.
- `mobile/` declares `expo-router` but `app/index.tsx` is a manual `splash → onboard → app` phase + tab-switch state machine, not file-based routing. Don't assume route files map to screens.
- In zsh, `$UID` is a readonly variable — don't use `UID` as a shell var name when scripting curl tests against user ids.
- The whole codebase (comments, log messages, user-facing strings) is in French — match that when editing.
