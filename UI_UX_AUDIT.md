# Audit UI/UX — CamWallet

Audit réalisé sur `mobile/` (React Native + Expo) et `camwallet-admin/` (React + Vite).
Les bases sont saines : les tokens de design existent déjà (`mobile/app/constants/theme.ts`,
objet `C` dans `admin/App.tsx`) et correspondent à la palette demandée. Les problèmes sont
surtout des **finitions d'interaction et d'accessibilité**.

Légende priorité : **P0** bloquant/accessibilité · **P1** important · **P2** finition.

---

## MOBILE (React Native)

### P0 — Accessibilité & icônes
1. **Emojis utilisés comme icônes partout** (~70 occurrences) au lieu de `@expo/vector-icons`
   (pourtant installé). Ex : `index.tsx` nav `⊞ ≡ ◉` + `🔔`; `HomeScreen` actions `↑ ↓ ⚡ ⊞`,
   œil `🙈/👁`; `ProfileScreen` `📷 📍 ✏️ 🪪 🔒 🧬 🚪`; modals `✕ 📤 📷 ⌫ 🟠 🏪 💰 💳 …`.
   Les emojis ne s'adaptent pas au thème, varient selon l'OS et ne sont pas lisibles par les
   lecteurs d'écran.
2. **Boutons icon-only sans `accessibilityLabel`** : cloche de notif (`index.tsx:93`),
   œil solde (`HomeScreen:88`), boutons `✕` de fermeture de tous les modals, retour `←`.
3. **`SafeAreaView` de `react-native`** (déprécié, ne gère pas le bas / notch Android) dans
   `index.tsx`. Les modals plein écran n'utilisent pas de safe-area en haut.

### P1 — Feedback & touch targets
4. **Touch targets < 44×44pt** : cloche `padding:4` (~30px), œil solde `padding:6`,
   badge édition avatar (24px), pavé numérique de saisie PIN/montant.
5. **Pas de feedback "pressed"** sur de nombreux éléments cliquables : lignes de transaction,
   `TouchableOpacity` sans `activeOpacity`, header avatar `onPress={() => {}}` (no-op).
6. **Pas de skeleton loaders** : `ProfileScreen` et les écrans branchés API affichent un simple
   `ActivityIndicator`, ce qui donne une impression de lenteur.

### P2 — Cohérence & animations
7. **Modals sans micro-animation** (apparition sèche) — pas de spring/slide.
8. **`ui.tsx` Button** utilise `TouchableOpacity` (pas de variant `secondary` exposé proprement,
   pas de tailles, feedback limité). À élever en composant production (Pressable + variants + sizes).
9. **Drapeaux emoji `🇨🇲`** dans des badges fonctionnels (XAF) — remplacer par texte propre.
10. **Contraste** : `textMuted #64748B` sur `card #161D2F` ≈ 4.0:1 (sous 4.5:1) pour le texte
    secondaire de petite taille → réservé aux labels non essentiels, à surveiller.

---

## ADMIN (React)

### P0 — Icônes & accessibilité
1. **Emojis comme icônes** (~25) au lieu de `lucide-react` (installé) : sidebar `⊞ ⚠️ 👥 📋 ⚡ 💰`,
   KPI `💰 🏦 👥 ⚡ 📈`, topbar `🔄 ⎋`, recherche `🔍`, KYC `⏳ ✅ ❌ 📄`, alertes `🚨 ⚠️`,
   badges `✓ 🔒`.
2. **Boutons icon-only sans `aria-label`** : fermeture modal `✕`, actualiser, déconnexion.

### P1 — États interactifs (hover/focus)
3. **Aucun état `:hover` / `:focus` visible** : la sidebar, les lignes de tableau (`cursor:pointer`
   mais aucun changement visuel), les boutons d'action et les puces de filtre n'ont pas de retour
   au survol/focus clavier. Styles inline → impossible sans `onMouseEnter` ou `<style>`.
4. **Pas de focus clavier** sur les champs (input recherche `outline:none` sans alternative).

### P1 — Responsive
5. **Non responsive** : sidebar fixe 230px, grilles `gridTemplateColumns` fixes (`1.5fr 1fr`,
   `repeat(3,1fr)`), tableaux larges sans scroll horizontal → cassé sous ~900px. Aucune media query.

### P2 — Finitions
6. **KPI cards** plates : pas de dégradé subtil ni de flèche de tendance animée (la tendance
   existe en donnée via `trendProps`, mais rendu statique `↑/↓` emoji).
7. **Tableaux** sans indicateur de tri ni pagination (le `limit:50` est silencieux).
8. **Feedback d'action** : `setUserStatus`/`reviewKyc` n'affichent qu'un `cursor:wait` ;
   pas de toast succès/erreur (juste `alert()` natif en cas d'échec).
9. **Footer sidebar** "Dernière synchro: 14h32" est codé en dur.

---

## Plan de correction
- **Mobile** (commit 1) : refonte `ui.tsx` (Button variants/sizes + Pressable, Input, Skeleton,
  IconButton), remplacement des emojis par `@expo/vector-icons`, `accessibilityLabel`,
  `react-native-safe-area-context`, feedback pressed, animations 150–300ms / spring sur modals.
- **Admin** (commit 2) : `lucide-react`, helper hover/focus (composants `Btn`/`NavItem`/`Row`),
  responsive (sidebar repliable + grilles fluides + scroll tableaux), KPI dégradé + flèches
  animées, toasts d'action, indicateurs de tri.
