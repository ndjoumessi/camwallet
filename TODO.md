# CamWallet — TODO & feuille de route

> État réel du produit vs CDC v1.0 (Juin 2026).
> Dernière mise à jour : **2026-06-19 — v3.5.5** (en production sur Railway + Vercel).

---

## 📊 Synthèse

| Priorité | État |
|---|---|
| 🔴 MVP Bloquant | ✅ 100 % livré |
| 🟠 Haute (CDC) | ✅ 100 % livré |
| 🟡 Moyenne (CDC) | ✅ 100 % livré |
| 🟢 Post-MVP (v2.4 → v3.2.17) | ✅ livré (CamPay, webhooks signés, SMS AfricasTalking, KYC IA) |
| 🟣 Évolutions v3.3 → v3.5.5 | ✅ livré (voir ci-dessous) |
| ⏳ Reportés | 6 chantiers (dont 4 bloqués sur config externe) |
| 🔵 Optionnels | 2 |
| ❌ Hors scope | 1 |

Le MVP et **toutes** les priorités du CDC sont livrés et déployés. Le backlog restant
est composé d'évolutions Phase 2 et de tâches d'activation prod (credentials live).

---

## 🟣 Évolutions livrées v3.3.0 → v3.5.5

### Paiements & fiabilité
- [x] **Idempotency keys sur tous les transferts financiers** — middleware `IdempotencyMiddleware` (cache Redis, TTL 24h) sur `POST /transactions/p2p`, `/transactions/pay-qr`, `/wallets/recharge`, `/wallets/withdraw`. En-tête `Idempotency-Key` (UUID mobile, réutilisé au retry) → réponse rejouée à l'identique, **0 double transaction**. _(v3.5.4, **corrigé et vérifié en prod v3.5.5** — le matching de route initial ne s'exécutait pas)._
- [x] **Optimisations connexions lentes (2G/3G)** — timeout 15s, retry 3× backoff (1/2/4s), bannière « Connexion lente / Hors ligne », indicateur de qualité réseau (barre signal basée latence réelle), gzip. _(v3.5.4)_
- [x] **Mode hors-ligne mobile** — solde mis en cache (`AsyncStorage`) et affiché quand l'API est injoignable. _(v3.4.0)_

### Fidélité
- [x] **Programme de fidélité / cashback** — modèles `LoyaltyPoints` + `LoyaltyEvent`, +1 pt/1000 FCFA envoyés, +5/recharge, +10/KYC ; niveaux Bronze/Argent/Or/Platine ; `GET /loyalty/balance` & `/history` ; section mobile + widget admin. _(v3.4.0)_
- [x] **Seuils & règles de fidélité configurables** depuis l'admin (`system_settings`, seed `onModuleInit`). _(v3.4.1)_

### Performance backend
- [x] **Cache applicatif** — `AppCacheModule` (Redis si `REDIS_URL`, sinon mémoire), cache solde/profil/stats/santé, invalidation ciblée, logs HIT/MISS. _(v3.4.0)_
- [x] **Redis opérationnel en production** (Railway Redis) — intégration « Cache (Redis) » dans la santé (UP/DOWN/FALLBACK), hit ~4× plus rapide, vérifié en prod. _(v3.5.3)_

### KYC & stockage
- [x] **Cloudinary KYC opérationnel en production** — upload optimisé (quality/format auto), dossiers dédiés `cni_recto`/`cni_verso`/`selfie`, repli base64, `ping()` dans la santé. _(v3.3.2)_

### Conformité (ANIF)
- [x] **Export PDF du rapport de conformité ANIF** — générateur multi-sections (stats, alertes, dossiers, règles), pied « Confidentiel — CamWallet © 2026 ». _(v3.4.0)_

### Admin — dashboard
- [x] **Carte Google Maps du Cameroun** — répartition géographique par région (10 régions en Polygon, tooltips dark, fit-bounds, frontières), repli SVG d3-geo. _(v3.3.0 → v3.3.1, raffinements jusqu'à v3.5.x)_
- [x] **Graphiques enrichis** — sparklines KPI, donut interactif, BarChart groupé à légende cliquable, AreaChart « Transactions par heure ». _(v3.5.0)_
- [x] **Optimisations perfs admin** — code-splitting Vite (bundle 1.7 Mo → 724 Ko), mémoïsation des charts, images KYC lazy. _(v3.5.0)_

### Mobile
- [x] **Scan QR marchand amélioré** — détection de type, checkmark animé, torche, pinch-zoom, historique des 5 derniers scans, haptique. _(v3.5.0)_

### Qualité transverse
- [x] **Audit UI/UX complet + i18n FR/EN** — correction des textes codés en dur (mobile + admin), parité des clés (mobile 578=578, admin ~1214), confirmations sur actions KYC, a11y, tokens couleur, états hover, messages d'erreur spécifiques. _(v3.5.1 + v3.5.2)_

---

## ⏳ Reportés

### Bloqués sur configuration / accès externe (action requise hors code)
- [ ] ⏳ **Notifications push FCM / Firebase** — remplacer Expo Push. **Bloqué** : créer le projet Firebase + `FIREBASE_SERVICE_ACCOUNT_JSON` + **build natif EAS** (sortie d'Expo Go). Expo Push fonctionne en attendant.
- [ ] ⏳ **Widget Android écran d'accueil** (solde + raccourcis). **Bloqué** : code natif + build EAS (non testable en Expo Go).
- [ ] ⏳ **AfricasTalking — credentials LIVE** — actuellement sandbox/log. Activer une clé de production pour l'envoi réel des SMS OTP.
- [ ] ⏳ **CamPay — passage en LIVE** — actuellement sandbox. Basculer sur les credentials de production OM/MTN via CamPay + valider les webhooks signés en réel.
- [ ] ⏳ **Domaine custom `.cm`** — `admin.camwallet.cm` / `app.camwallet.cm` (DNS + certificats + CORS déjà prévu en prod).

### Faisable en interne (effort)
- [ ] ⏳ **Admin : `React.lazy` par route + virtualisation des tables** — nécessite d'éclater le `App.tsx` monolithique (~5000 lignes) en modules par page.

---

## 🔵 Optionnels

- [ ] 🔵 **SDK marchand public + portail développeur** — API publique avec API keys, rate-limiting, doc OpenAPI. Surface sensible (sécurité) — à cadrer.
- [ ] 🔵 **PWA utilisateur** (login/solde/envoi/QR) — décidé non prioritaire (l'app mobile native couvre le besoin).

---

## ❌ Hors scope

- [ ] ❌ **WhatsApp Business API officielle** — nécessite l'approbation Meta ; le deep link `wa.me` couvre le MVP.

---

## 🟢 Rappel — socle livré (MVP + CDC + Post-MVP)

Pour mémoire, déjà livré et déployé (détails dans l'historique git / `CHANGELOG.md`) :
sécurité webhooks signés (OM/MTN/CamPay, fail-closed), SMS OTP AfricasTalking,
auth PIN + lockout + pepper, RBAC admin (6 sous-rôles), KYC + IA Claude Vision
(auto-approbation réglable), ANIF (détection smurfing, rapports, dossiers d'enquête),
2FA admin, SSE temps réel, exports CSV, IP whitelisting, rotation mot de passe,
soft-delete, contrainte `balance >= 0`, CI/CD GitHub Actions, Sentry, biométrie,
disputes, mode nuit, i18n FR/EN, perf p95 ~328 ms (EU West + pool + bcrypt 10 + keep-warm).
