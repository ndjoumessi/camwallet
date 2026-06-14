# CamWallet — TODO & Fonctionnalités manquantes

> Comparatif CDC v1.0 (Juin 2026) vs implémentation actuelle.  
> Dernière mise à jour : 2026-06-15

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

- [ ] **[CRITIQUE] HomeScreen : solde et transactions depuis l'API** — balance et contacts sont encore lus depuis le Zustand store avec données hardcodées. Câbler `fetchBalance()` et `fetchHistory()` au montage et à chaque focus de l'écran.
- [ ] **[SÉCU] SendModal : validation PIN via l'API** — le PIN est actuellement validé côté client (`'123456'`). N'importe qui peut effectuer un paiement P2P sans connaître le vrai PIN. La validation doit passer par `POST /transactions/p2p` avec le PIN en body.
- [ ] **[UX] Contacts récents depuis l'API** — les 5 contacts de la HomeScreen sont hardcodés dans le store. Charger les vrais destinataires récents depuis `GET /transactions/history` (extraire les contacts uniques).
- [ ] **[FLOW] Modal Retrait complet** — il n'existe pas de `WithdrawModal` dans l'app. L'endpoint `POST /wallets/withdraw` existe côté backend mais aucun écran mobile ne permet de l'appeler.
- [ ] **[FLOW] RechargeModal câblée à l'API** — la recharge simule une confirmation immédiate sans appeler `POST /wallets/recharge`. Le vrai flux (initiation → polling ou deep link USSD → webhook → crédit) doit être implémenté.
- [ ] **[SÉCU] Déconnexion automatique après 15 min d'inactivité** — requis au §3.1 (AU-09, MVP). Implémenter un timer d'inactivité réinitialisé à chaque interaction utilisateur.

---

## 🟠 Haute priorité

Fonctionnalités marquées "Haute" dans le CDC ou nécessaires pour une beta utilisable.

### Backend

- [ ] **[ADMIN] Endpoint `POST /admin/transactions/:id/retry`** — relance manuelle d'une transaction en attente (§14.3.3 CDC). Utile pour les webhooks non reçus.
- [ ] **[ADMIN] Endpoint `GET /admin/integrations/status`** — santé temps réel de OM, MTN MoMo, SMS OTP et FCM (latence ping, uptime). Requis pour le tableau de bord admin (§14.3.7).
- [ ] **[NOTIF] Notification push + SMS sur décision KYC** — quand un admin approuve ou rejette un dossier KYC, l'utilisateur doit recevoir une notification push ET un SMS (§14.3.5). Actuellement aucune notification n'est envoyée depuis `admin.service.ts`.
- [ ] **[SÉCU] Historique des 3 derniers PIN** — interdire la réutilisation des 3 derniers PIN lors d'un changement (§5.2 CDC). Stocker les hashes des anciens PIN sur `User`.
- [ ] **[ANIF] Alerte automatique transactions > 500 000 FCFA** — générer une alerte ANIF et un audit log pour toute transaction dépassant ce seuil (§5.3 CDC). Ajouter dans `TransactionsService` après `$transaction`.

### Mobile

- [ ] **[UX] Détail transaction au clic dans HistoryScreen** — un clic sur une transaction dans l'historique doit ouvrir une vue de détail (destinataire, montant, frais, date, référence, statut). Requis §3.5 CDC.
- [ ] **[UX] Écran / modale Retrait accessible depuis HomeScreen** — bouton "Retirer" (ou équivalent) sur l'écran d'accueil permettant d'initier un retrait vers OM ou MTN.
- [ ] **[UX] Partage reçu WhatsApp après paiement QR** — le deep link `wa.me` est implémenté dans `SendModal` (P2P) mais pas dans le flux paiement QR (QR-07 CDC). Ajouter l'étape de partage post-confirmation QR.
- [ ] **[PROFIL] Changement de PIN depuis ProfileScreen** — formulaire (ancien PIN → nouveau PIN × 2) appelant `PATCH /auth/change-pin` une fois implémenté backend.
- [ ] **[PROFIL] Toggle préférences notifications** — switch push/SMS dans les paramètres profil (§3.6 CDC). Stocker côté `User` ou `UserSettings`.
- [ ] **[LÉGAL] Écrans CGU et Politique de confidentialité** — requis pour la publication sur l'App Store et le Play Store. Liens depuis ProfileScreen (§3.6 CDC).
- [ ] **[UX] Mode dégradé offline** — afficher le solde mis en cache (AsyncStorage) et permettre d'afficher son QR statique sans connexion (§5.4 CDC). Gérer l'état réseau avec `NetInfo`.

### Admin

- [ ] **[ADMIN] Vue dédiée Recharges & Retraits** — page admin listant les opérations OM/MoMo avec statut webhook en temps réel, référence opérateur, payload callback (§14.3.4 CDC).
- [ ] **[ADMIN] Score de risque ANIF par utilisateur** — calcul automatique Bas/Moyen/Élevé selon volume mensuel et comportement. Afficher sur la fiche utilisateur (§14.3.2 CDC).
- [ ] **[ADMIN] Tableau santé intégrations sur Dashboard** — widget affichant le statut OM, MTN, SMS, FCM avec latence et uptime (§14.3.1 CDC). Consomme `GET /admin/integrations/status`.
- [ ] **[ADMIN] Relance transaction manuelle** — bouton "Relancer" sur la fiche transaction admin pour les transactions `PENDING` bloquées (§14.3.3 CDC).

---

## 🟡 Moyenne priorité

Fonctionnalités utiles pour la qualité du produit ou la conformité, mais non bloquantes pour le lancement beta.

### Backend

- [ ] **[ANIF] Détection transactions suspectes avancées** — règles configurables : montants inhabituels, fréquence anormale, smurfing (séries de petits montants contournant les seuils) (§5.3 + §14.3.6 CDC).
- [ ] **[ANIF] Rapport ANIF semi-automatique** — génération d'un PDF/Word pré-rempli pour les transactions signalées (§14.3.6 CDC).
- [ ] **[ADMIN] Endpoint `PATCH /admin/settings`** — paramètres système modifiables : limites financières, taux frais, durée session, templates notifications (§14.3.9 CDC).
- [ ] **[PERF] Retry réseau avec backoff exponentiel** — 3 tentatives automatiques sur les appels API échoués (réseau instable 3G, §5.4 CDC). Configurer dans `axios` interceptors.
- [ ] **[NOTIF] SMS de backup si push non reçu** — si la notification push n'est pas reçue dans 30 secondes, envoyer un SMS de confirmation (§6.5 CDC).

### Mobile

- [ ] **[UX] Feedback haptic sur actions critiques** — vibration sur confirmation PIN, paiement réussi, erreur (§9.3 CDC). Utiliser `expo-haptics`.
- [ ] **[UX] Pagination / scroll infini dans HistoryScreen** — charger les transactions par pages depuis l'API plutôt qu'un tableau statique de 50 éléments.
- [ ] **[UX] Deep link depuis notifications push** — une notification push "Vous avez reçu 5 000 FCFA" doit ouvrir l'app sur l'HistoryScreen ou le détail de la transaction.
- [ ] **[UX] Écran Commerçant basique** — si `user.role === MERCHANT` : afficher stats journalières (CA, nb transactions) et QR dynamique par montant depuis HomeScreen (§4.1 CDC).

### Admin

- [ ] **[ADMIN] Filtres avancés Audit Logs** — filtre par acteur, type d'action, entité concernée, plage de dates. Actuellement limité aux 50 derniers entrées sans filtre.
- [ ] **[ADMIN] Graphique taux de succès par opérateur** — OM vs MTN sur période glissante dans la vue Transactions (§14.3.3 CDC).
- [ ] **[ADMIN] Dossiers d'enquête ANIF** — ouverture, assignation à un analyste, suivi, clôture des dossiers de conformité (§14.3.6 CDC).
- [ ] **[ADMIN] Gestion des credentials API** — affichage masqué et rotation possible des clés OM/MTN depuis l'interface (§14.3.7 CDC).

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
| 🔴 MVP Bloquant | 6 *(5 backend ✅)* | Mobile (6) |
| 🟠 Haute | 15 | Backend (5) + Mobile (7) + Admin (4) - 1 partagé |
| 🟡 Moyenne | 13 | Backend (5) + Mobile (4) + Admin (4) |
| 🔵 Phase 2 | 22 | Mobile (11) + Admin (8) + Infra (5) - 2 partagés |
| **Total** | **61** | |
