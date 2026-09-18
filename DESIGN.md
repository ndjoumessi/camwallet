---
name: CamWallet
description: Portefeuille de crédit QR prépayé pour le Cameroun — dark fintech premium
colors:
  emeraude: "#00C896"
  emeraude-dark: "#008F6A"
  emeraude-light: "#00C89618"
  bleu: "#3B82F6"
  jaune: "#F5C542"
  rouge: "#FF4D6D"
  violet: "#A78BFA"
  nuit: "#0A0F1E"
  surface: "#111827"
  card: "#161D2F"
  card-hover: "#1C2540"
  bordure: "#1E2D45"
  bordure-claire: "#263350"
  texte: "#EEF2FF"
  texte-discret: "#64748B"
  texte-doux: "#94A3B8"
typography:
  display:
    fontFamily: "system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, \"Helvetica Neue\", Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  xxxl: "32px"
  huge: "48px"
components:
  button-primary:
    backgroundColor: "{colors.emeraude}"
    textColor: "{colors.nuit}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  button-primary-hover:
    backgroundColor: "{colors.emeraude-dark}"
    textColor: "{colors.nuit}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.emeraude}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  button-danger:
    backgroundColor: "#FF4D6D15"
    textColor: "{colors.rouge}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.emeraude}"
    rounded: "{rounded.md}"
    padding: "15px 24px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "16px 20px"
  input:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  badge:
    backgroundColor: "{colors.emeraude-light}"
    textColor: "{colors.emeraude}"
    rounded: "{rounded.full}"
    padding: "3px 10px"
---

# Design System: CamWallet

## 1. Overview

**Creative North Star: "La Chambre Forte"**

CamWallet est conçu comme une chambre forte numérique — une interface qui inspire la même confiance qu'un coffre-fort, mais avec la fluidité d'une app pensée pour le Cameroun. Le fond *Nuit Abyssale* (`#0A0F1E`) n'est pas un effet de mode dark UI ; c'est une décision de lisibilité sur des écrans Android souvent exposés au soleil, et une déclaration d'identité qui distingue CamWallet de toutes les apps mobile money de première génération. L'*Émeraude CamWallet* (`#00C896`) n'apparaît que là où elle doit : actions primaires, confirmations, indicateurs de succès. Sa rareté est son pouvoir.

Le système est **product-register, restrained** : la palette ne se permet aucun bruit visuel. La tension entre la profondeur des surfaces (nuit → ardoise → carbone) et l'éclat de l'émeraude crée le premium sans l'ostentation. Ce n'est pas Revolut, ce n'est pas N26, ce n'est pas une app de mobile money à fond orange saturé — c'est quelque chose de distinct, et reconnaissable comme africain.

La typographie repose sur un seul système sans-serif (system-ui). Pas de pair typographique — les polices système garantissent la performance sur Android 3G et la lisibilité sur toutes densités d'écran. Le poids 900 est réservé aux montants financiers et aux valeurs display ; tout le reste utilise 700 ou moins.

**Key Characteristics:**
- Dark UI navy-nuit en 3 niveaux de surface (Nuit → Ardoise → Carbone)
- Un seul accent chromatique (Émeraude) ; toutes les autres couleurs sont sémantiques
- System-ui sans-serif, poids 400–900, échelle fixe 10–36 px
- Émeraude au repos = interdit — elle agit, elle ne décore pas
- Touch targets ≥ 44 × 44 px sur mobile ; densité tableau autorisée sur admin web
- Transitions 150–250 ms, ease-out exponentiel ; reduced-motion = passage instantané

## 2. Colors: La Palette Chambre Forte

Une palette dominée par les neutres nuit ; l'émeraude est l'unique couleur de marque non-sémantique. Les couleurs sémantiques (bleu, jaune, rouge, violet) existent uniquement pour les états — jamais pour la décoration.

### Primary
- **Émeraude CamWallet** (`#00C896`): La couleur de marque. Boutons primaires, états actifs, indicateurs de succès, dots temps réel, logo. Présente sur ≤ 15 % de n'importe quel écran. Sa rareté est son signal.
- **Émeraude Profonde** (`#008F6A`): État hover/pressed du bouton primaire et des liens actifs. Jamais utilisée seule comme couleur de fond.
- **Émeraude Voile** (`#00C89618`): Fond de badge success, tint de fond sur cards actives, fond d'item de navigation sélectionné. L'émeraude à l'état d'ombre portée.

### Secondary
- **Bleu Info** (`#3B82F6`): Actions informationnelles, états info, icônes QR code, liens secondaires.
- **Jaune Alerte** (`#F5C542`): Transactions en attente (pending), état warning, couleur opérateur MTN MoMo.
- **Rouge Danger** (`#FF4D6D`): Erreurs, boutons destructifs, transactions échouées.
- **Violet Suspendu** (`#A78BFA`): Comptes suspendus, transactions signalées (flagged).

### Neutral
- **Nuit Abyssale** (`#0A0F1E`): Fond de page global. Le niveau le plus profond — jamais utilisé comme couleur de texte.
- **Ardoise** (`#111827`): Surface de contenu principal. Sidebar, panels, modals, fonds de sections.
- **Carbone** (`#161D2F`): Fond de carte (card). Le niveau le plus élevé avant l'interactif.
- **Carbone Hover** (`#1C2540`): État pressé/hover des cartes et éléments interactifs. Fond des skeletons.
- **Fissure** (`#1E2D45`): Bordure par défaut. Trace le contour des cards et séparations sans écraser.
- **Fissure Claire** (`#263350`): Bordure focus sur inputs, bordure légère sur éléments secondaires.
- **Texte** (`#EEF2FF`): Texte principal, valeurs, montants. Contraste ≥ 13:1 sur Nuit Abyssale.
- **Texte Discret** (`#64748B`): Labels secondaires, métadonnées, timestamps, en-têtes de tableaux. Contraste ≥ 4.5:1 sur surfaces Ardoise/Carbone.
- **Texte Doux** (`#94A3B8`): Valeurs tertiaires, sous-labels de charts, texte de placeholder de remplissage.

### Named Rules
**La Règle de l'Émeraude Unique.** `#00C896` est la seule couleur non-neutre et non-sémantique du système. Elle ne décore jamais — elle agit. Si vous hésitez à l'utiliser, ne l'utilisez pas.

**La Règle des États Stricts.** Jaune = pending, Rouge = error/danger, Violet = suspended/flagged. Ces rôles sont fixes et ne changent jamais — ne les détournez pas pour d'autres usages.

## 3. Typography: Un Seul Sans, Mille Poids

**Toutes les surfaces:** `system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`

**Character:** Un seul système typographique — pas de pair. Le poids fait tout le travail hiérarchique. Geometric humanist selon la plateforme (SF Pro sur iOS, Roboto sur Android, Segoe UI sur Windows) — tous lisibles en taille réduite, tous sans serif. L'interface doit s'effacer derrière les montants, pas derrière une typographie expressive.

### Hierarchy
- **Display** (900, 30–36 px, line-height 1.2, letter-spacing –0.5 px): Montants principaux (solde wallet, montant d'une transaction). Jamais pour des labels ou des titres de section.
- **Headline** (700–900, 24 px, line-height 1.2): Valeurs clés de dashboard admin, titres d'écran principaux.
- **Title** (700, 17 px, line-height 1.3): En-têtes de section, noms dans les listes de contacts, noms d'écran dans la navbar.
- **Body** (400–500, 14–15 px, line-height 1.5): Texte d'interface courant, descriptions, étiquettes de champs. Max 65–75ch sur surfaces web.
- **Label** (600, 10–12 px, line-height 1.2, letter-spacing 0.06em): En-têtes de tableaux (uppercase), badges de statut, métadonnées de transaction. Minimum absolu : 10 px.

### Named Rules
**La Règle du Montant Sacré.** Les montants financiers sont toujours en poids 700–900, jamais tronqués, toujours suivis de « FCFA » ou « XAF ». Un montant illisible est une erreur UX critique — pas une décision stylistique acceptable.

**La Règle du 900 Réservé.** Le poids 900 n'est autorisé que sur les valeurs numériques display (soldes, totaux). Les titres d'écran et en-têtes : maximum 700.

## 4. Elevation: Couches Teintées et Lueur Émeraude

CamWallet utilise la profondeur par **paliers de teinte** plutôt que par ombres lourdes. Les 3 niveaux de surface (Nuit → Ardoise → Carbone) créent la hiérarchie sans `box-shadow`. Les ombres n'apparaissent que sur les éléments actifs (CTA, modals) et les notifications.

### Shadow Vocabulary
- **Lueur CTA** (`0 4px 8px rgba(0,200,150,0.30)`): Bouton primaire. Aura subtile émeraude qui confirme l'action principale. Présente au repos et à l'état pressé.
- **Lueur Carte** (`0 4px 12px rgba(0,200,150,0.10)`): Cards interactives (Pressable). Signal visuel de cliquabilité ; absente sur les cards purement informatives.
- **Modal Vault** (`0 -8px 24px rgba(0,0,0,0.50)`): Bottom-sheets et modals. Ombre directionnelle vers le haut — la surface émerge de derrière la page.
- **Toast** (`0 10px 30px -10px rgba(0,0,0,0.65)`): Notifications in-app. Détachement net du fond, sans couleur de marque.

### Named Rules
**La Règle du Plat par Défaut.** Les surfaces sont plates au repos. Les ombres répondent à un état (hover, élévation, focus) — jamais à titre décoratif. Un fond Nuit Abyssale n'a pas besoin d'aide pour sembler profond.

## 5. Components

### Buttons
Shape raffinée, légèrement arrondie (12 px) — ni pill ni carré. La forme communique la confiance, pas la douceur.

- **Shape:** Gently rounded (12 px / `{rounded.md}`)
- **Primary:** Fond Émeraude (`#00C896`), texte Nuit Abyssale (`#0A0F1E`), padding 15 × 24 px, Lueur CTA active. Min-height 52 px (md), 58 px (lg).
- **Hover / Pressed:** Fond Émeraude Profonde (`#008F6A`), scale `0.97`, transition 150 ms ease-out.
- **Focus visible:** `outline: 2px solid #00C896; outline-offset: 2px` — jamais supprimé, jamais masqué.
- **Secondary:** Fond Ardoise (`#111827`), border `1px solid #263350`, texte Émeraude. Shape identique.
- **Danger:** Fond rouge voile (`#FF4D6D15`), texte Rouge (`#FF4D6D`). Shape identique. Aucune icône décorative.
- **Ghost:** Fond transparent, texte Émeraude, aucune border. Padding identique aux autres variantes.
- **Disabled:** Opacité 40 %, `pointer-events: none`. La couleur de base reste visible (pas de gris générique).

### Cards / Containers
- **Corner Style:** Generously rounded (16 px / `{rounded.lg}`)
- **Background:** Carbone (`#161D2F`)
- **Border:** `1px solid #1E2D45` (Fissure)
- **Shadow Strategy:** Lueur Carte sur Pressable/cliquables ; flat sur cards informatives
- **Internal Padding:** 16–20 px standard ; 12–14 px compact (admin dense)
- **Hover:** Fond Carbone Hover (`#1C2540`), transition 150 ms

### Inputs / Fields
- **Style:** Fond Ardoise (`#111827`), border `1px solid #1E2D45`, radius 12 px
- **Focus:** Border passe à Émeraude (`#00C896`) ; icône gauche (si présente) passe en émeraude. Pas de glow — la couleur suffit.
- **Error:** Border Rouge (`#FF4D6D`) ; message d'erreur en texte Rouge sous le champ, 12 px / 400.
- **Placeholder:** Texte Discret (`#64748B`) — contraste ≥ 4.5:1 requis, vérifié.
- **Label:** 12 px / 600 / Texte Doux (`#94A3B8`), 6 px de marge sous le label avant le champ.

### Badges / Status Chips
- **Style:** Fond couleur-sémantique à ~10 % d'opacité, texte couleur-sémantique solide, radius full (20 px), padding 3 × 10 px, 11 px / 600.
- **Exemples de statuts:** Succès → `#00C89618` / `#00C896` ; Pending → `#F5C54215` / `#B89000` ; Flagged → `#A78BFA18` / `#A78BFA` ; Error → `#FF4D6D15` / `#FF4D6D`.

### Navigation (Admin Dashboard)
- Sidebar fond Ardoise (`#111827`), items 14 px / 500, Texte Doux par défaut.
- **Item actif :** fond Émeraude Voile (`#00C89618`), texte Émeraude, `border-left: 2px solid #00C896`. Exception documentée à la règle border-left : ici la bordure est un indicateur de sélection, pas un accent décoratif.
- **Item hover :** fond Carbone (`#161D2F`), texte Texte, transition 150 ms.
- **Logo :** 24 px / 900, « Cam » en Texte (`#EEF2FF`), « Wallet » en Émeraude (`#00C896`).

### QR Payment Display (Signature)
La carte de paiement QR est le composant le plus vu de l'app. Fond Carbone (`#161D2F`), border 1 px Fissure, radius 16 px. Contenu : nom du marchand en Title, montant en Display / 900 / Émeraude centré, QR code SVG centré. Confirmation : animation de check émeraude sur fond Émeraude Voile. Aucun autre élément visuel sur cet écran pendant le scan — zéro distraction.

## 6. Do's and Don'ts

### Do:
- **Do** utiliser `#00C896` (Émeraude) uniquement sur les actions primaires, les états success et les confirmations — jamais comme décoration.
- **Do** respecter les 3 niveaux de surface dans l'ordre (Nuit → Ardoise → Carbone). Jamais Carbone comme fond de page globale.
- **Do** afficher les montants en poids 700–900, jamais tronqués, avec séparateur de milliers et unité FCFA.
- **Do** garantir un touch target ≥ 44 × 44 px sur tous les éléments interactifs mobile.
- **Do** appliquer les états sémantiques stricts : jaune = pending, rouge = error/danger, violet = suspended/flagged.
- **Do** inclure `:focus-visible` (outline émeraude 2 px) sur tous les éléments interactifs — jamais supprimé.
- **Do** utiliser les Skeleton components (`#1C2540`, animation pulse 700 ms) pour les états de chargement — jamais de spinner centré dans du contenu.
- **Do** écrire tous les textes (labels, erreurs, microcopy) en français camerounais natif — jamais de traduction littérale depuis l'anglais.

### Don't:
- **Don't** utiliser de dégradés criards, d'icônes en plastique brillant, ni de palettes vert-orange saturées style « app de mobile money première génération » ou app de loterie.
- **Don't** reproduire l'esthétique des néobanques européennes (Revolut, N26) : dark + violet électrique + pill buttons. CamWallet est premium et africain — pas une copie.
- **Don't** utiliser l'émeraude (`#00C896`) à titre décoratif, comme fond de section, ou pour mettre en valeur du texte non-actionnable.
- **Don't** animer des propriétés CSS de layout (width, height, top, left) — uniquement `transform` et `opacity`.
- **Don't** utiliser le poids 900 ailleurs que sur des montants display et des valeurs numériques de dashboard.
- **Don't** utiliser `border-left` en couleur d'accent sur des cards ou items de liste — sauf sur l'item de navigation actif (seule exception documentée au §5 Navigation).
- **Don't** descendre sous `#64748B` (Texte Discret) pour du texte de corps sur fond sombre — risque de contraste insuffisant (< 4.5:1).
- **Don't** ouvrir un modal comme première réponse à toute action — épuiser les alternatives inline d'abord. Les modals sont une décision, pas un réflexe.
- **Don't** afficher des erreurs ou des statuts uniquement par la couleur — toujours accompagner d'une icône ou d'un libellé textuel (accessibilité daltonisme).
