# CamWallet — Backend API

API REST NestJS + PostgreSQL pour l'application CamWallet.

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos valeurs

# 3. Lancer PostgreSQL (Docker)
docker run -d \
  --name camwallet-db \
  -e POSTGRES_DB=camwallet_dev \
  -e POSTGRES_USER=camwallet \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:15

# 4. Exécuter les migrations
npx prisma migrate dev --name init

# 5. Démarrer en développement
npm run start:dev
```

## Endpoints principaux

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | /api/v1/auth/register | Inscription + envoi OTP |
| POST | /api/v1/auth/verify-otp | Vérification OTP |
| POST | /api/v1/auth/set-pin | Création PIN 6 chiffres |
| POST | /api/v1/auth/login | Connexion |
| POST | /api/v1/transactions/p2p | Envoi P2P |
| POST | /api/v1/transactions/pay-qr | Paiement QR |
| GET | /api/v1/transactions/history | Historique |
| POST | /api/v1/webhooks/orange-money | Webhook OM |
| POST | /api/v1/webhooks/mtn-momo | Webhook MTN |

## Swagger UI

Disponible sur `http://localhost:3000/api/docs` (développement uniquement).

## Architecture des modules

```
src/
├── auth/           — Inscription, OTP SMS, PIN, JWT
├── users/          — Profil utilisateur, KYC
├── wallets/        — Solde, limites, historique
├── transactions/   — P2P, QR, recharge, retrait (ACID)
├── qr/             — Génération QR statique & dynamique
├── webhooks/       — Intégration OM & MTN MoMo
├── admin/          — Dashboard admin, alertes, KYC
└── prisma/         — Service base de données
```

## Sécurité

- Authentification JWT (access 15min + refresh 7j)
- PIN haché bcrypt (12 rounds)
- Blocage après 3 PIN incorrects (30 min)
- Rate limiting par endpoint
- Validation HMAC signatures opérateurs
- Audit log complet pour traçabilité ANIF
- Transactions ACID PostgreSQL
