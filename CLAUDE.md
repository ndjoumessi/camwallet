# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CamWallet is a QR-based prepaid payment app for Cameroon, backed by Orange Money and MTN Mobile Money. Users hold a virtual balance ("Crédit QR") — the product deliberately operates without a BEAC/COBAC banking licence, so the wallet is internal credit, not a bank account.

Monorepo with three independent sub-projects (no workspace tooling — each has its own `package.json` and `node_modules`):

- `backend/` — NestJS + Prisma + PostgreSQL REST API. **This is the only project wired to a real datastore.**
- `mobile/` — React Native + Expo app. Currently a **mock prototype**: screens read from a hardcoded Zustand store (`mobile/app/store/useStore.ts`), not from the API.
- `camwallet-admin/` — React + Vite + Recharts dashboard. Also a **mock prototype**: all data is hardcoded inline in `camwallet-admin/src/App.tsx`.

When asked to "connect" or "wire up" the frontends, expect to be building the API integration layer from scratch — it does not exist yet.

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

### mobile
```bash
npm install
npx expo start                  # then scan QR with Expo Go
npm run android | ios | web
```

### camwallet-admin
```bash
npm install
npm run dev                     # http://localhost:3001
npm run build                   # tsc + vite build
```

## Backend architecture

Standard NestJS module-per-domain layout under `backend/src/`: `auth`, `users`, `wallets`, `transactions`, `qr`, `webhooks`, `admin`, plus a global `prisma` module. `AppModule` wires them together with global `ConfigModule` and `ThrottlerModule` (10 req / 60s).

Bootstrap conventions (`main.ts`) that affect every route:
- Global prefix `api/v1` — all endpoints live under `/api/v1/...`.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` — DTOs reject unknown fields, so request bodies must match the `class-validator` DTOs exactly.
- Swagger UI is mounted at `/api/docs` only when `NODE_ENV !== 'production'`.
- CORS is `*` in dev, locked to `admin.camwallet.cm` / `app.camwallet.cm` in production.

### Money is stored as BigInt centimes — this is the #1 gotcha
All amounts in the database and backend (`Wallet.balance`, `Transaction.amount`/`fee`, limits) are `BigInt` in **centimes of FCFA** (1 FCFA = 100). Example: `10000` = 100 FCFA. This avoids floating-point errors on financial values. Always use `bigint` literals (`5n`, `1000n`) in arithmetic. Note the two mock frontends use plain JS numbers in **whole FCFA** — any real integration must convert at the boundary.

### Financial integrity
Balance mutations (P2P, QR payment, webhook crediting) must be atomic. They run inside `prisma.$transaction(...)` doing debit + credit + transaction-record insert together — see `transactions/transactions.service.ts`. Preserve this pattern for any new money-moving flow; never debit/credit in separate awaits. The merchant commission on QR payments is computed as `(amount * 5n) / 1000n` (0.5%).

### Auth flow
Phone + 6-digit PIN, not email/password (admin is the exception). Registration is a 3-step OTP flow: `register` (creates user + empty wallet, sends OTP) → `verifyOtp` → `setPin` (bcrypt cost 12, issues JWTs). Login compares the PIN; after `MAX_PIN_ATTEMPTS` (3) failures the account is locked for 30 minutes via `User.lockedUntil`. JWTs use separate access/refresh secrets from config; the `JwtStrategy` is in `auth/strategies/`.

### Webhooks
`webhooks/webhooks.service.ts` ingests Orange Money / MTN MoMo callbacks. Every raw event is persisted to `WebhookEvent` for audit before processing; a `SUCCESSFUL` event matches a `PENDING` transaction by `operatorRef` and credits the wallet atomically. **Signature/token verification is stubbed (`TODO`)** — `OM_WEBHOOK_SECRET` / `MTN_WEBHOOK_SECRET` exist in env but are not yet validated.

### Data model
`schema.prisma` is the source of truth. Central tables: `User` → `Wallet` (1:1) and `Transaction` (sender/receiver self-relations on User). `AuditLog` exists for ANIF regulatory traceability. After editing `schema.prisma`, run `prisma:generate` and create a migration.

## Environment

Each sub-project needs a `.env` copied from its example. Only `backend/.env.example` is committed (the README references a `mobile/.env.example` that does not exist — `EXPO_PUBLIC_API_URL` is the relevant mobile var). Backend env covers: `DATABASE_URL`, JWT secrets, AfricasTalking SMS (OTP), Orange Money + MTN MoMo API credentials, Cloudinary (KYC document storage), and admin credentials.

Dev test credentials (from README): PIN `123456`, OTP `847291`, admin `admin@camwallet.cm` / `Admin@2025!`.

## Notes

- The backend `tsconfig.json` is loose (`strictNullChecks: false`, `noImplicitAny: false`) — code uses non-null assertions (`amount!`) freely.
- `mobile/` declares `expo-router` but `app/index.tsx` is a manual `splash → onboard → app` phase + tab-switch state machine, not file-based routing. Don't assume route files map to screens.
- The whole codebase (comments, log messages, user-facing strings) is in French — match that when editing.
