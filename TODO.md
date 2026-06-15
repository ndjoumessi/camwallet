# CamWallet — TODO & Fonctionnalités manquantes

> Comparatif CDC v1.0 (Juin 2026) vs implémentation actuelle.  
> Dernière mise à jour : 2026-06-15 (v1.7.0)

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

- [ ] **[AU-06] Connexion biométrique** — Face ID / empreinte digitale via `expo-local-authentication` (déjà installé, non branché).
- [ ] **[AU-07] KYC complet Phase 2** — actuellement la soumission existe mais le parcours guidé (explication, re-soumission après rejet) est partiel.
- [ ] **[WL-08] Limite de retrait journalier paramétrable** — affichage et potentielle modification par l'utilisateur (selon son niveau KYC).
- [ ] **[WL-09] Programme de points fidélité** — 1 point = 10 FCFA payé, affichage solde points, catalogue de récompenses.
- [ ] **[QR-09] QR Code commerçant imprimable (PDF)** — génération et téléchargement d'un PDF avec le QR statique mis en page.
- [ ] **[P2P-07] Demande de remboursement (dispute)** — bouton "Demander un remboursement" sur une transaction reçue.
- [ ] **[3.6] Mode nuit / clair** — thème sombre (déjà sombre) + thème clair avec toggle dans Paramètres.
- [ ] **[3.6] Langue Anglais** — internationalisation (i18n) de l'app, Français par défaut.
- [ ] **[4.1] Espace commerçant avancé** — tableau de bord séparé : CA hebdo/mensuel, classement produits, gestion multi-employés, alertes solde bas.
- [ ] **[6.4] WhatsApp Business API officielle** — remplacement du deep link `wa.me` par l'API officielle pour envoi automatique de reçus.
- [ ] **[Infra] Intégration Sentry** — crash reporting mobile et backend.

### Admin

- [ ] **[14.4] Rôles multiples admin** — Super Admin / Admin / Analyste ANIF / Support avec droits différenciés (actuellement un seul rôle ADMIN).
- [ ] **[14.5] 2FA admin obligatoire** — TOTP (Google Authenticator / Authy) pour tous les comptes admin.
- [ ] **[14.2] WebSocket / SSE temps réel** — dashboard admin mis à jour en live (actuellement polling via bouton "Actualiser").
- [ ] **[14.3.2] Export CSV utilisateurs** — export filtré pour reporting ANIF.
- [ ] **[14.3.2] Note admin interne** — annotation privée sur un compte utilisateur, visible uniquement des admins.
- [ ] **[14.3.3] Export CSV/PDF transactions filtré**.
- [ ] **[14.5] IP Whitelisting / VPN** — restreindre l'accès au back-office par IP (infrastructure).
- [ ] **[14.5] Rotation mot de passe admin 90j** — alerte et blocage si le mot de passe admin n'a pas été changé depuis 90 jours.

### Infrastructure

- [ ] **[Infra] CI/CD GitHub Actions** — pipeline : lint → tests → build → déploiement auto sur push `main`.
- [ ] **[Infra] Monitoring Sentry + Datadog / Better Uptime** — alertes temps réel erreurs et disponibilité.
- [ ] **[Infra] Base de données managée avec backups daily** — migrer vers Supabase ou Neon pour la production.
- [ ] **[Infra] Soft delete users/wallets** — colonne `deletedAt` + trigger de protection audit_logs (jamais de DELETE physique, §7.2 CDC).
- [ ] **[Infra] CHECK constraint `balance >= 0`** — contrainte PostgreSQL garantissant qu'un solde ne peut jamais passer en négatif directement en base.

---

## Récapitulatif

| Priorité | Nombre d'items | Domaines principaux |
|---|---|---|
| 🔴 MVP Bloquant | 0 *(tous ✅)* | — |
| 🟠 Haute | 0 *(tous ✅)* | — |
| 🟡 Moyenne | 0 *(tous ✅)* | — |
| 🔵 Phase 2 | 22 | Mobile (11) + Admin (8) + Infra (5) - 2 partagés |
| **Total** | **61** | |
