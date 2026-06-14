# Changelog

Toutes les évolutions notables de CamWallet sont documentées dans ce fichier.

Le format s'appuie sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/)
et le projet suit le [versionnement sémantique](https://semver.org/lang/fr/).

## [1.2.0] — 2026-06-14

Profil utilisateur enrichi sur les trois couches, plus l'outillage de dev.

### Ajouté

#### Backend
- Champs `User.avatarUrl / dateOfBirth / city` (migration).
- `PATCH /users/profile` : validation `class-validator` (nom, email, ville, date de naissance).
- `GET /users/me` : profil complet + solde + statistiques (nombre de transactions, total envoyé/reçu).
- `POST /users/avatar` : upload image via Cloudinary (`CloudinaryModule`), avec repli data URI en dev. Type validé par signature binaire (PNG/JPEG/WEBP).
- `GET /admin/users/:id` : détail (infos, document KYC, transactions, audit, stats) ; `POST /admin/users/:id/reset-pin`.

#### Mobile
- `ProfileScreen` branché sur l'API : photo de profil (avec initiales en repli, upload galerie via `expo-image-picker`), infos, badge KYC, formulaire d'édition inline, statistiques, section sécurité (changement de PIN par OTP, bascule biométrie).

#### Admin
- Vue détail utilisateur (modal) au clic sur une ligne : infos complètes, photos KYC, historique des transactions, journal d'audit, et actions inline (bloquer/débloquer, réinitialiser le PIN, approuver/rejeter le KYC).

#### Outillage
- `Makefile` : `make mobile` (Expo), `make admin` (Vite dev), `make backend-dev`, et `make dev-all` (backend watch + admin + Expo en parallèle via `concurrently`, hot reload partout).
- `CLAUDE.md` mis à jour (frontends connectés à l'API, modules `notifications`/`cloudinary`, auth admin durcie, surface d'API).

### Sécurité
- Upload avatar : validation du type par signature binaire (rejet SVG / non-image) ; pas de champ URL libre dans `PATCH /users/profile`.

[1.2.0]: https://github.com/ndjoumessi/camwallet/releases/tag/v1.2.0

## [1.1.0] — 2026-06-14

Trois nouvelles fonctionnalités : scan QR réel, notifications push et
graphiques temps réel du tableau de bord admin.

### Ajouté

#### Mobile
- **Scan QR réel** via `expo-camera` : la caméra remplace le scan simulé,
  permission demandée à la première ouverture, décodage du QR en temps réel
  (URI `camwallet://pay`, JSON ou numéro brut) puis ouverture de l'écran d'envoi
  pré-rempli (destinataire et montant).
- **Notifications push** via `expo-notifications` : demande de permission,
  enregistrement du jeton Expo côté backend après connexion, affichage des
  notifications au premier plan et incrément du badge à la réception.

#### Backend
- Champ `User.pushToken` (migration) et endpoint `POST /users/push-token` pour
  enregistrer le jeton de notification.
- Envoi d'une notification « argent reçu » après chaque crédit : paiement P2P,
  paiement par QR et recharge (via webhook opérateur). L'envoi est non bloquant
  et ne peut pas faire échouer la transaction.
- `GET /admin/stats/timeseries?period=7d|30d|90d` : séries temporelles réelles
  par jour (volume, frais perçus, transactions, nouveaux utilisateurs), série
  continue avec jours sans activité à zéro.

#### Tableau de bord admin
- Graphiques branchés sur les données réelles : volume (aire), revenus/frais par
  jour (barres) et activité utilisateurs + transactions (lignes), avec un
  **sélecteur de période** 7 j / 30 j / 90 j.

### Supprimé
- Dernières données de démonstration des graphiques du dashboard (`VOLUME_DATA`,
  `REVENUE_DATA`) et les marqueurs « · démo » : tous les graphiques sont
  désormais alimentés par l'API.

[1.1.0]: https://github.com/ndjoumessi/camwallet/releases/tag/v1.1.0

## [1.0.0] — 2026-06-14

Première version stable de **CamWallet** — portefeuille prépayé QR pour le
Cameroun, adossé à Orange Money et MTN Mobile Money. Le solde est un crédit
interne (« Crédit QR »), sans licence bancaire BEAC/COBAC.

Le monorepo réunit trois sous-projets indépendants : `backend/` (API NestJS +
Prisma + PostgreSQL), `mobile/` (application Expo / React Native) et
`camwallet-admin/` (tableau de bord React + Vite).

### Ajouté

#### Backend (API NestJS)
- API REST sous le préfixe global `api/v1`, documentation Swagger sur `/api/docs`
  (hors production), `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`)
  et throttling (10 req / 60 s).
- Modules par domaine : `auth`, `users`, `wallets`, `transactions`, `qr`,
  `webhooks`, `admin` et module global `prisma`.
- Authentification téléphone + PIN à 6 chiffres : inscription OTP en 3 étapes
  (`register` → `verify-otp` → `set-pin`), connexion avec verrouillage après
  3 échecs, JWT access/refresh séparés et `POST /auth/refresh`.
- Montants stockés en **BigInt centimes de FCFA** ; mutations de solde atomiques
  via `prisma.$transaction` (P2P, paiement QR, crédit webhook). Commission
  marchand QR de 0,5 %.
- Flux asynchrone Orange Money / MTN MoMo : ingestion des webhooks avec
  persistance de chaque évènement (`WebhookEvent`) avant traitement.
- `AuditLog` pour la traçabilité réglementaire (ANIF).

#### Mobile (Expo / React Native)
- Application connectée à l'API réelle (client axios avec Bearer et
  rafraîchissement automatique des tokens sur 401).
- Écran de connexion, restauration de session et flux d'application.
- Montée de version **Expo SDK 52 → 54** (React 19, React Native 0.81).

#### Tableau de bord admin (React + Vite)
- Connexion administrateur (`POST /auth/login-admin`) et garde d'accès par rôle.
- Client API en `fetch` natif : stockage des tokens, rafraîchissement
  automatique sur 401, conversion centimes → FCFA à la frontière.
- Pages branchées aux données réelles : **Dashboard** (KPIs, répartition par
  type, transactions récentes, tendances), **Utilisateurs** (recherche et
  filtre statut côté serveur), **Transactions** (filtre par type), **Alertes**
  (signalements dérivés des données réelles), **KYC** (file d'attente) et
  **Finances** (frais, solde plateforme, volume par type).
- Actions de modération : blocage / réactivation d'un compte et
  approbation / rejet KYC, chacune tracée dans l'`AuditLog` ; journal d'audit
  consultable (`GET /admin/audit`).
- Hook `useFetch` partagé (chargement / erreur / refetch) et rafraîchissement
  sans démontage des pages (préserve recherche, filtre et défilement).
- Tendances période sur période (30 j vs 30 j précédents) affichées dans les
  KPI ; formatage FCFA avec séparateur de milliers.

### Sécurité
- Connexion admin : comparaison à temps constant des identifiants, refus si la
  configuration est absente, verrouillage anti-bruteforce (5 essais → 15 min).
- Sessions admin révocables : les tokens portent une empreinte des identifiants
  (`adminCredHash`) revalidée au rafraîchissement ; la rotation de
  `ADMIN_PASSWORD` invalide les tokens déjà émis.
- CORS restreint à `admin.camwallet.cm` / `app.camwallet.cm` en production.

### Notes
- Vérification de signature des webhooks Orange Money / MTN MoMo encore stubbée
  (`TODO`) — les secrets existent en environnement mais ne sont pas validés.
- Les graphiques temporels mensuels du Dashboard restent des données de
  démonstration (`· démo`) : seules les tendances période sur période sont
  calculées côté backend.

[1.0.0]: https://github.com/ndjoumessi/camwallet/releases/tag/v1.0.0
