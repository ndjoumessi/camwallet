# CamWallet — TODO & Fonctionnalités manquantes

> Comparatif CDC v1.0 (Juin 2026) vs implémentation actuelle.  
> Dernière mise à jour : 2026-06-15 (v2.0.0)

---

## 🔴 MVP Bloquant

Ces points bloquent la validation ou la sécurité du produit. Sans eux, CamWallet ne peut pas être mis en production.

### Backend

- [x] **[SÉCU] Validation signature webhooks Orange Money** — HMAC-SHA256 avec `OM_WEBHOOK_SECRET`, comparaison à temps constant (`timingSafeEqual`). `webhooks/webhooks.service.ts`.
- [x] **[SÉCU] Validation token webhooks MTN MoMo** — comparaison à temps constant des hashes SHA-256 du token reçu vs `MTN_WEBHOOK_SECRET`. `webhooks/webhooks.service.ts`.
- [x] **[INTÉGRATION] SMS OTP réel via AfricasTalking** — déjà implémenté dans `otp.service.ts` (bascule sandbox quand `username === 'sandbox'` ou clé absente).
- [x] **[AUTH] Endpoint `POST /auth/logout`** — incrémente `User.tokenVersion` ; le `refresh` rejette tout token antérieur à cette version. `auth/auth.controller.ts` + `auth.service.ts`.
- [x] **[AUTH] Endpoint `PATCH /auth/change-pin`** — vérifie l'ancien PIN (bcrypt), hash le nouveau (coût 12), incrémente `tokenVersion` (invalide toutes les sessions). `auth/auth.controller.ts` + `auth.service.ts`.

### Mobile

- [x] **[CRITIQUE] HomeScreen : solde et transactions depuis l'API** — `useEffect` au montage appelle `fetchBalance()` + `fetchHistory()` (store). La HomeScreen remonte à chaque retour sur l'onglet (tab non persisté), donc les données sont toujours fraîches.
- [x] **[SÉCU] SendModal : validation PIN via l'API** — `handlePin` appelle `authApi.login(user.phone, pin)` côté serveur avant tout envoi. Implémente le lockout backend (3 tentatives). Supprimé le hint "PIN de démo : 123456".
- [x] **[UX] Contacts récents depuis l'API** — `fetchHistory()` dérive `recentContacts[]` depuis l'historique P2P (téléphone + nom des contreparties). HomeScreen + SendModal utilisent ces contacts réels.
- [x] **[FLOW] Modal Retrait complet** — `WithdrawModal.tsx` : sélection opérateur → numéro + montant → `walletApi.withdraw()` → écran "Retrait initié". Bouton "Retirer" ajouté en HomeScreen (barre d'actions défilante).
- [x] **[FLOW] RechargeModal câblée à l'API** — `handleRecharge` appelle `walletApi.recharge()`. Champ numéro MoMo (pré-rempli avec `user.phone`). Écran "Recharge en cours" (webhook crédite, pas de confirmation immédiate).
- [x] **[SÉCU] Déconnexion automatique après 15 min d'inactivité** — Timer `setInterval` (60 s) dans `index.tsx` + `AppState` pour le background. `onTouchStart` sur le contenu réinitialise `lastActivityRef`. Appelle `logout()` + redirige vers login.

---

## 🟠 Haute priorité

Fonctionnalités marquées "Haute" dans le CDC ou nécessaires pour une beta utilisable.

### Backend

- [x] **[ADMIN] Endpoint `POST /admin/transactions/:id/retry`** — relance manuelle d'une transaction en attente (§14.3.3 CDC). Utile pour les webhooks non reçus.
- [x] **[ADMIN] Endpoint `GET /admin/integrations/status`** — santé temps réel de OM, MTN MoMo, SMS OTP et FCM (latence ping, uptime). Requis pour le tableau de bord admin (§14.3.7).
- [x] **[NOTIF] Notification push + SMS sur décision KYC** — `reviewKyc()` envoie push via `NotificationsService.sendToUser()` + SMS via `OtpService.sendSms()`. `AdminModule` importe désormais `AuthModule`.
- [x] **[SÉCU] Historique des 3 derniers PIN** — champ `previousPinHashes String[]` sur `User` (migration `add-pin-history`). `changePin()` vérifie les 3 derniers hashes avant d'accepter le nouveau PIN.
- [x] **[ANIF] Alerte automatique transactions > 500 000 FCFA** — `p2p()` crée un `AuditLog { action: 'ANIF_HIGH_VALUE_ALERT' }` fire-and-forget si `amount >= 50_000_000n`.

### Mobile

- [x] **[UX] Détail transaction au clic dans HistoryScreen** — `onPress` sur chaque ligne ouvre une `Modal` (pageSheet) avec icône, montant, référence, opération, date, statut, motif.
- [x] **[UX] Écran / modale Retrait accessible depuis HomeScreen** — `WithdrawModal.tsx` + bouton "Retirer" dans la barre d'actions défilante de `HomeScreen`.
- [x] **[UX] Partage reçu WhatsApp après paiement QR** — deep link `wa.me` intégré dans `SendModal` à l'étape "done" (P2P et QR).
- [x] **[PROFIL] Changement de PIN depuis ProfileScreen** — modal in-app (PIN actuel → nouveau × 2) appelant `authApi.changePin()` → `PATCH /auth/change-pin`. Vérifie les 3 derniers PIN côté serveur.
- [x] **[PROFIL] Toggle préférences notifications** — switch push dans ProfileScreen, persisté via `AsyncStorage` (`cw_push_enabled`).
- [x] **[LÉGAL] Écrans CGU et Politique de confidentialité** — modales pageSheet avec texte complet depuis ProfileScreen (section "Informations légales").
- [x] **[UX] Mode dégradé offline** — `fetchBalance()` catch : charge `cw_cached_balance` depuis `AsyncStorage` + affiche `error: 'Mode hors ligne — solde affiché depuis le cache'`.

### Admin

- [x] **[ADMIN] Vue dédiée Recharges & Retraits** — page "Recharges & Retraits" dans le nav admin ; 2 onglets : Opérations (table avec type, statut, ref. opérateur, retryCount, bouton Relancer) + Callbacks webhook (table avec payload dépliable inline, statut traité/erreur). KPI cards : volume 7j recharges, retraits, webhooks en attente.
- [x] **[ADMIN] Score de risque ANIF par utilisateur** — `getUserDetail()` calcule `anifRisk` (Bas/Moyen/Élevé) depuis le volume mensuel ; affiché sur la fiche utilisateur admin avec couleur (rouge/jaune/vert).
- [x] **[ADMIN] Tableau santé intégrations sur Dashboard** — widget `HealthWidget` consomme `GET /admin/health/integrations` (déjà implémenté).
- [x] **[ADMIN] Relance transaction manuelle** — `POST /admin/transactions/:id/retry` + bouton "Relancer" sur la fiche transaction admin (déjà implémenté).

---

## 🟡 Moyenne priorité

Fonctionnalités utiles pour la qualité du produit ou la conformité, mais non bloquantes pour le lancement beta.

### Backend

- [x] **[ANIF] Détection transactions suspectes avancées** — smurfing (>10 tx/24h < 50k FCFA, total > 300k FCFA) + montants inhabituels (juste sous le seuil ANIF). `admin.service.ts` `getAnifAlerts()`.
- [x] **[ANIF] Rapport ANIF semi-automatique** — `GET /admin/anif/report` retourne JSON structuré (summary, highValue, smurfing, unusualAmounts, openCases) sur 30j.
- [x] **[ADMIN] Endpoint `PATCH /admin/settings`** — modèle `SystemSettings` (migration), `GET/PATCH /admin/settings` : limites, frais P2P, durée session, seuil ANIF.
- [x] **[PERF] Retry réseau avec backoff exponentiel** — 3 tentatives, délais 1s/2s/4s, erreurs réseau + 5xx uniquement. Mobile `axios` interceptor + admin `request()`.
- [x] **[NOTIF] SMS de backup si push non reçu** — `setTimeout(30 000ms)` dans `NotificationsService.sendToUser()` après push ; `NotificationsModule` importe `AuthModule` pour `OtpService`.

### Mobile

- [x] **[UX] Feedback haptic sur actions critiques** — `expo-haptics` : `impactAsync(Medium)` sur bouton Envoyer, `notificationAsync(Success/Error)` sur PIN confirmé/incorrect + changement PIN ProfileScreen.
- [x] **[UX] Pagination / scroll infini dans HistoryScreen** — `FlatList` + `onEndReached` (threshold 0.2) + `fetchHistoryPage(page)` dans le store, champs `historyHasMore` + `historyLoading`.
- [x] **[UX] Deep link depuis notifications push** — `addNotificationTapHandler()` dans `notifications.ts` ; `index.tsx` appelle `setActiveTab('history')` au tap.
- [x] **[UX] Écran Commerçant basique** — `MerchantScreen` déjà complet (stats jour/semaine/mois + QR dynamique via `merchantApi.getStats()`). Vérifié fonctionnel.

### Admin

- [x] **[ADMIN] Filtres avancés Audit Logs** — `GET /admin/audit?action=&actorId=&resource=&from=&to=&take=` + page "Journal Audit" dans le nav avec barre de filtres.
- [x] **[ADMIN] Graphique taux de succès par opérateur** — `GET /admin/stats/operator-rates` + `OperatorRatesWidget` (BarChart Recharts) dans `TransactionsPage`.
- [x] **[ADMIN] Dossiers d'enquête ANIF** — `PATCH /admin/anif/cases/:id/close` + bouton clôture inline dans `ANIFPage` avec saisie de résolution.
- [x] **[ADMIN] Gestion des credentials API** — page Paramètres (Settings) avec champs éditables + section informatifs credentials (variables d'environnement).

---

## 🔵 Phase 2

Explicitement marqué "Phase 2" dans le CDC, ou fonctionnalité avancée post-MVP.

### Mobile

- [x] **[AU-06] Connexion biométrique** — `expo-local-authentication` branché sur `LoginScreen` : détection matériel + proposition activation après PIN, bouton "Face ID / Empreinte" si activé, toggle dans ProfileScreen.
- [x] **[AU-07] KYC complet Phase 2** — `KycModal` + soumission multipart existants vérifiés fonctionnels. Re-soumission après rejet supportée par le backend.
- [x] **[WL-08] Limite de retrait journalier** — `dailyLimit` stocké dans le store depuis `fetchBalance()`, affiché dans `WithdrawModal`.
- [x] **[WL-09] Programme de points fidélité** — `loyaltyApi.getPoints()` + bannière compacte sous balance card dans HomeScreen (silencieuse si endpoint absent).
- [ ] **[QR-09] QR Code commerçant imprimable (PDF)** — nécessite `expo-print` ou `react-native-view-shot` (rebuild natif requis). Reporté.
- [x] **[P2P-07] Demande de remboursement (dispute)** — `disputeApi.open()` + bouton + formulaire inline dans modal détail HistoryScreen. Backend : `POST /disputes` + modèle `DisputeRequest`.
- [x] **[3.6] Mode nuit / clair** — `ThemeContext` avec `DarkColors`/`LightColors`, toggle dans ProfileScreen, persisté via AsyncStorage.
- [ ] **[3.6] Langue Anglais** — i18n de toute l'app trop lourd pour cette phase. Reporté.
- [x] **[4.1] Espace commerçant avancé** — mini-graphe tendance 7j, alerte solde bas, bouton "Partager mon QR" via `Share.share()`.
- [ ] **[6.4] WhatsApp Business API officielle** — deep link `wa.me` déjà en place (MVP), API officielle nécessite approbation Meta. Reporté.
- [ ] **[Infra] Intégration Sentry** — nécessite DSN externe. Reporté.

### Admin

- [x] **[14.4] Rôles multiples admin** — champ `adminRole` (SUPER_ADMIN/ANALYST/SUPPORT) sur User + `GET/PATCH /admin/team` + page "Équipe Admin" dans le nav.
- [x] **[14.5] 2FA admin obligatoire** — TOTP via `otplib` : `POST /auth/2fa/setup|verify|disable` + UI de configuration dans SettingsPage (QR code + code de vérification).
- [ ] **[14.2] WebSocket / SSE temps réel** — nécessite refonte architecture (Socket.io ou SSE). Reporté.
- [x] **[14.3.2] Export CSV utilisateurs** — `GET /admin/export/users` + bouton "⬇ Export CSV" dans UsersPage.
- [x] **[14.3.2] Note admin interne** — modèle `AdminNote` + `GET/POST /admin/users/:id/notes` + `DELETE /admin/notes/:id` + section dans UserDetailModal.
- [x] **[14.3.3] Export CSV transactions filtré** — `GET /admin/export/transactions` + bouton "⬇ Export CSV" dans TransactionsPage.
- [ ] **[14.5] IP Whitelisting / VPN** — configuration Nginx / infrastructure. Reporté.
- [x] **[14.5] Rotation mot de passe admin 90j** — `admin_password_changed_at` dans SystemSettings + alerte bandeau rouge dans SettingsPage si > 90j.

### Infrastructure

- [x] **[Infra] CI/CD GitHub Actions** — `.github/workflows/ci.yml` : 3 jobs (backend Postgres + lint + tests, admin vite build, mobile expo-doctor).
- [ ] **[Infra] Monitoring Sentry + Datadog / Better Uptime** — services externes. Reporté.
- [ ] **[Infra] Base de données managée avec backups daily** — migration Supabase/Neon. Reporté.
- [x] **[Infra] Soft delete users/wallets** — colonnes `deletedAt DateTime?` sur `User` et `Wallet` (migration `add_phase2_models`).
- [x] **[Infra] CHECK constraint `balance >= 0`** — contrainte PostgreSQL appliquée via migration SQL dédiée `add_balance_check_constraint`.

---

## Récapitulatif

| Priorité | Nombre d'items | Domaines principaux |
|---|---|---|
| 🔴 MVP Bloquant | 0 *(tous ✅)* | — |
| 🟠 Haute | 0 *(tous ✅)* | — |
| 🟡 Moyenne | 0 *(tous ✅)* | — |
| 🔵 Phase 2 | 7 reportés | Mobile (3) + Admin (2) + Infra (2) |
| **Total** | **61** | |
