# CamWallet 🇨🇲

> Application mobile de paiement QR prépayé — Marché Cameroun

Adossée à Orange Money & MTN Mobile Money. Solde virtuel (Crédit QR), sans agrément BEAC/COBAC.

---

## Structure du monorepo

```
camwallet/
├── mobile/           # App React Native + Expo (iOS & Android)
├── backend/          # API REST Node.js + NestJS + PostgreSQL
└── camwallet-admin/  # Dashboard admin React + Vite
```

---

## Prérequis

| Outil | Version minimale |
|-------|-----------------|
| Node.js | 18+ |
| npm | 9+ |
| Expo CLI | `npm i -g expo-cli` |
| PostgreSQL | 14+ |
| Git | 2.x |

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
cp .env.example .env
# Remplir les variables dans .env
npm install
npx prisma migrate dev --name init
npm run start:dev
# API disponible sur http://localhost:3000
# Swagger : http://localhost:3000/api/docs
```

### 3. App mobile

```bash
cd mobile
npm install
cp .env.example .env
# Remplir EXPO_PUBLIC_API_URL=http://localhost:3000
npx expo start
# Scanner le QR avec Expo Go (Android/iOS)
```

### 4. Dashboard admin

```bash
cd camwallet-admin
npm install
npm run dev
# Dashboard disponible sur http://localhost:3001
```

---

## Architecture

```
┌─────────────────┐     REST/HTTPS      ┌──────────────────────┐
│  App Mobile     │◄───────────────────►│  Backend NestJS      │
│  React Native   │                     │  :3000               │
│  Expo ~52       │                     │  ┌────────────────┐  │
└─────────────────┘                     │  │ PostgreSQL      │  │
                                        │  │ + Prisma ORM   │  │
┌─────────────────┐     REST/HTTPS      │  └────────────────┘  │
│  Admin Dashboard│◄───────────────────►│                      │
│  React + Vite   │                     │  Webhooks OM/MoMo    │
│  :3001          │                     └──────────────────────┘
└─────────────────┘
```

## Flux principaux

**Recharge** : App → API OM/MoMo → Webhook → Backend crédite solde QR

**Paiement QR** : Scan → PIN → Backend débite payeur / crédite marchand → Notif

**Retrait** : Marchand → Backend vérifie solde → API OM/MoMo → Confirmation

---

## Comptes de test (développement)

| Type | Valeur |
|------|--------|
| PIN test | `123456` |
| OTP test | `847291` |
| Numéro test | `+237 6XX XXX XXX` |
| Admin email | `admin@camwallet.cm` |
| Admin password | `Admin@2025!` |

> ⚠️ Ces credentials sont pour l'environnement de développement uniquement.

---

## Variables d'environnement

Chaque sous-projet dispose d'un `.env.example`. Copier et remplir avant le démarrage.

Voir `backend/.env.example` pour la liste complète des variables requises.

---

## Modèle économique

| Source | Taux | Déclencheur |
|--------|------|-------------|
| Commission marchand | 0,5 % à 1 % | Par paiement reçu |
| Frais de retrait | 1 % (min. 50 FCFA) | Retrait vers OM/MoMo |
| Abonnement Pro | 2 000–5 000 FCFA/mois | Outils avancés marchand |

---

## Licence

Confidentiel — © 2025 CamWallet. Ne pas diffuser sans autorisation.
