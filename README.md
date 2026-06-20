# CamWallet 🇨🇲

> Application mobile de paiement QR prépayé — Marché Cameroun

Adossée à **Orange Money** & **MTN Mobile Money** (via CamPay). L'utilisateur détient un solde virtuel (« Crédit QR ») : le produit opère **délibérément sans agrément BEAC/COBAC** — le portefeuille est du crédit interne, pas un compte bancaire.

<p>
  <img alt="version" src="https://img.shields.io/badge/version-3.6.2-2563eb">
  <img alt="backend" src="https://img.shields.io/badge/backend-NestJS%20%2B%20Prisma-e0234e">
  <img alt="mobile" src="https://img.shields.io/badge/mobile-Expo%20SDK%2054-000020">
  <img alt="admin" src="https://img.shields.io/badge/admin-React%20%2B%20Vite-646cff">
  <img alt="licence" src="https://img.shields.io/badge/licence-Confidentiel-red">
</p>

---

## Sommaire

- [Structure du monorepo](#structure-du-monorepo)
- [Fonctionnalités clés](#fonctionnalités-clés)
- [Stack technique](#stack-technique)
- [Prérequis](#prérequis)
- [Démarrage rapide](#démarrage-rapide)
- [Architecture](#architecture)
- [Flux principaux](#flux-principaux)
- [Build APK Android (sans EAS)](#build-apk-android-sans-eas)
- [Déploiement & environnements](#déploiement--environnements)
- [Sécurité](#sécurité)
- [Conventions importantes](#conventions-importantes)
- [Comptes de test](#comptes-de-test-développement)
- [Variables d'environnement](#variables-denvironnement)
- [Modèle économique](#modèle-économique)
- [Licence](#licence)

---

## Structure du monorepo

Trois sous-projets **indépendants** (pas de workspace tooling — chacun a son `package.json` et ses `node_modules`) :

```
camwallet/
├── mobile/           # App React Native + Expo SDK 54 (iOS & Android) — câblée à l'API réelle
├── backend/          # API REST NestJS + Prisma + PostgreSQL — source de vérité unique
└── camwallet-admin/  # Dashboard admin React + Vite + Recharts — câblé à l'API réelle
```

Les deux frontends consomment l'API via un client `src/lib/api.ts` (Bearer + refresh single-flight sur 401). Plus aucune donnée mock/démo dans le code.

---

## Fonctionnalités clés

- **Paiement QR** marchand (scan → PIN → débit payeur / crédit marchand, commission 0,5 %).
- **Transferts P2P** entre utilisateurs, contacts récents dérivés de l'historique réel.
- **Recharge / Retrait** via Orange Money & MTN MoMo (webhooks signés, idempotents).
- **KYC** (CNI recto/verso + selfie) avec **pré-validation IA Claude Vision** et revue admin.
- **Programme de fidélité** (Bronze → Argent → Or → Platine), seuils & règles configurables depuis l'admin.
- **Notifications push** (Expo) à chaque crédit reçu.
- **Biométrie** (déverrouillage), avatar, profil éditable.
- **Dashboard admin** : stats, séries temporelles, utilisateurs, transactions, alertes, KYC, finance, rapport ANIF (export PDF), équipe (RBAC sous-rôles), support (tickets).
- **i18n FR/EN** complète des deux côtés (FR-first, parité de clés vérifiée).
- **Mode connexions lentes** (2G/3G) : timeouts, retries, indicateur réseau, gzip.

---

## Stack technique

| Couche | Technologies |
|--------|-------------|
| **Mobile** | React Native 0.81, React 19, Expo SDK 54, Zustand, axios, react-i18next, expo-camera / -notifications / -local-authentication / -constants |
| **Backend** | NestJS, Prisma ORM, PostgreSQL, JWT (access/refresh), bcrypt + HMAC pepper, ThrottlerModule, Swagger |
| **Admin** | React, Vite, Recharts, jsPDF + autotable, i18n maison |
| **Infra** | Redis (cache, optionnel → repli mémoire), Cloudinary (uploads), AfricasTalking (OTP SMS), CamPay / OM / MTN MoMo, Anthropic (KYC IA) |
| **CI/CD** | GitHub Actions (tests, build admin, **build APK Android sans EAS**), Railway (backend), Vercel (admin) |

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | **20+** (requis par Expo SDK 54 ; la CI utilise Node 20) |
| npm | 9+ |
| PostgreSQL | 14+ |
| Git | 2.x |
| Java (build APK local) | JDK 17 |

> Expo CLI n'est plus à installer globalement : on utilise `npx expo …`.

---

## Démarrage rapide

### 1. Cloner le dépôt

```bash
git clone https://github.com/ndjoumessi/camwallet.git
cd camwallet
```

### 2. Backend API

```bash
cd backend
cp .env.example .env          # remplir DATABASE_URL, secrets JWT, PIN_PEPPER, etc.
npm install
npx prisma migrate dev        # applique les migrations (schéma DB)
npm run prisma:seed           # données de dev
npm run start:dev             # http://localhost:3000 — Swagger : /api/docs
```

> ⚠️ Le `.env` local peut pointer vers la base **prod** (Supabase). Dans ce cas **ne jamais lancer `prisma migrate dev`** (il muterait la prod) — voir [CLAUDE.md](./CLAUDE.md).

### 3. App mobile

```bash
cd mobile
npm install
cp .env.example .env          # EXPO_PUBLIC_API_URL=http://localhost:3000
npx expo start                # scanner le QR avec Expo Go
```

### 4. Dashboard admin

```bash
cd camwallet-admin
npm install
npm run dev                   # http://localhost:3001
```

---

## Architecture

```
┌─────────────────┐     REST/HTTPS      ┌───────────────────────────────┐
│  App Mobile     │◄───────────────────►│  Backend NestJS (:3000)       │
│  React Native   │     JWT + refresh   │  ┌─────────────────────────┐  │
│  Expo SDK 54    │                     │  │ PostgreSQL + Prisma     │  │
└─────────────────┘                     │  ├─────────────────────────┤  │
                                        │  │ Cache Redis (opt.)      │  │
┌─────────────────┐     REST/HTTPS      │  │ Idempotency middleware  │  │
│  Admin Dashboard│◄───────────────────►│  │ RBAC sous-rôles         │  │
│  React + Vite   │     RBAC            │  └─────────────────────────┘  │
│  (:3001)        │                     │  Webhooks CamPay / OM / MoMo  │
└─────────────────┘                     └───────────────────────────────┘
                                          ▲ Cloudinary · Claude Vision (KYC)
                                          │ AfricasTalking (OTP) · Expo Push
```

Backend en modules-par-domaine (`backend/src/`) : `auth`, `users`, `wallets`, `transactions`, `qr`, `webhooks`, `admin`, `kyc` (+ `kyc-ai`), `loyalty`, plus modules globaux `prisma`, `notifications`, `cloudinary`, `cache`, `loyalty`. Préfixe global `api/v1`. Détails complets dans [CLAUDE.md](./CLAUDE.md).

---

## Flux principaux

**Recharge** : App → API OM/MoMo → Webhook signé → Backend crédite le solde QR (atomique, idempotent).

**Paiement QR** : Scan → PIN → Backend débite payeur / crédite marchand (commission 0,5 %) → Notif push.

**Retrait** : Marchand → Backend réserve les fonds → API OM/MoMo → Webhook confirme (échec ⇒ recrédit `montant + frais`).

> Toutes les mutations de solde sont **atomiques** (`prisma.$transaction`) et les écritures financières sont **idempotentes** (`Idempotency-Key`, rejouées à l'identique en cas de retry).

---

## Build APK Android (sans EAS)

Le workflow `.github/workflows/build-android.yml` produit un **APK release signé** sur GitHub Actions (prebuild Expo + Gradle, **sans EAS**). APK **universel** (~111 Mo, toutes ABI → compatible 32 et 64 bits).

**Déclencheurs**
- `workflow_dispatch` (depuis l'onglet *Actions*) — input `version` optionnel pour le nom de fichier.
- Push d'un tag `v*` → l'APK est **attaché automatiquement** à la Release correspondante.

**Secrets requis** (Settings → Secrets → Actions) : `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Générer le keystore une fois :

```bash
./scripts/generate-keystore.sh
base64 -i camwallet-release.keystore | tr -d '\n' | pbcopy   # → secret ANDROID_KEYSTORE_BASE64
```

> ⚠️ **Ne jamais committer** `camwallet-release.keystore` (gitignoré). Le perdre = impossible de mettre à jour l'app sur le Play Store.

**Télécharger le dernier APK** : onglet [Releases](https://github.com/ndjoumessi/camwallet/releases) → asset `camwallet-vX.Y.Z-android.apk`.

---

## Déploiement & environnements

| Cible | Hébergeur | Déclenchement |
|-------|-----------|---------------|
| Backend | **Railway** (EU West, à côté de la DB Supabase) | auto sur push `main` |
| Admin | **Vercel** | auto sur push `main` |
| APK Android | **GitHub Actions** → Release | push d'un tag `v*` |

- Backend prod : `https://camwallet-production.up.railway.app` — santé : `GET /api/v1/health` (renvoie la version du `package.json` une fois redéployé).
- **Releases** : tags `vX.Y.Z` + GitHub releases ; les **trois `package.json` + `mobile/app.json` (`expo.version`/`versionCode`)** sont bumpés ensemble.

---

## Sécurité

- **PIN** haché en `bcrypt(HMAC-SHA256(pin, PIN_PEPPER))` ; le *pepper* vit uniquement dans l'environnement (un leak DB seul est inexploitable). Verrouillage après 3 échecs.
- **Webhooks** vérifiés et *fail-closed* en prod : HMAC OM, token MTN, signature CamPay (+ contrôle du montant vs DB) — comparaisons à temps constant.
- **Auth admin** : compare-temps-constant, lockout par e-mail, hash de credential dans le token (rotation du mot de passe ⇒ invalide les tokens).
- **RBAC sous-rôles** appliqué côté backend (`@RequirePermission` + `PermissionsGuard`) — l'UI n'est que cosmétique.
- **Uploads** validés par signature *magic-byte* (jamais le MIME client).
- `ValidationPipe` `whitelist` + `forbidNonWhitelisted` (rejet des champs inconnus).

---

## Conventions importantes

- **L'argent est stocké en `BigInt` centimes de FCFA** (1 FCFA = 100). Les réponses sérialisent BigInt → Number (centimes) ; les deux frontends convertissent en FCFA entiers à la frontière (`toFcfa`). ⚠️ piège n°1 du projet.
- **Tout le code est en français** (commentaires, logs, chaînes) — à respecter en éditant.
- **i18n** : mobile `mobile/src/i18n/{fr,en}.json`, admin `camwallet-admin/src/locales/{fr,en}.json` — garder la **parité de clés** FR/EN.
- L'admin **n'a pas de `tsconfig.json`** : valider avec `npm run build` (Vite ne type-check pas).
- Détails d'architecture, pièges et leçons CI : **[CLAUDE.md](./CLAUDE.md)**.

---

## Comptes de test (développement)

| Type | Valeur |
|------|--------|
| Utilisateur | `+237677000001` |
| Marchand | `+237699000002` |
| PIN (tous) | `123456` |
| Admin email | `admin@camwallet.cm` |
| Admin password | `Admin@2025!` |

> ⚠️ Credentials d'environnement de **développement uniquement** (issus du seed `prisma/seed.ts`).

---

## Variables d'environnement

Chaque sous-projet dispose d'un `.env.example` — copier et remplir avant le démarrage.

- **mobile** : `EXPO_PUBLIC_API_URL` (origine, `/api/v1` ajouté), `EXPO_PUBLIC_ENV`.
- **admin** : `VITE_API_URL` (défaut `http://localhost:3000`).
- **backend** : `DATABASE_URL`, secrets JWT, `PIN_PEPPER`, OTP (AfricasTalking), OM/MTN, Cloudinary, `ANTHROPIC_API_KEY` (KYC IA, optionnel), `REDIS_URL` (optionnel), `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Liste complète : `backend/.env.example`.

---

## Modèle économique

| Source | Taux | Déclencheur |
|--------|------|-------------|
| Commission marchand | 0,5 % | Par paiement QR reçu |
| Frais de retrait | 1 % (min. 50 FCFA) | Retrait vers OM/MoMo |
| Abonnement Pro | 2 000–5 000 FCFA/mois | Outils avancés marchand |

---

## Licence

Confidentiel — © 2025 CamWallet. Ne pas diffuser sans autorisation.
