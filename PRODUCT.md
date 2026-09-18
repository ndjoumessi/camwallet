# Product

## Register

product

## Users

**App mobile** — Cameroungais (18-45 ans, majoritairement Android, données mobiles limitées) qui paient ou encaissent en QR Code dans leur vie quotidienne : commerçants de proximité, étudiants, salariés non-bancarisés. Contexte : en déplacement, souvent en 3G, parfois avec peu de temps. Tâche principale : envoyer ou recevoir du crédit QR, recharger depuis Orange Money / MTN MoMo, scanner un QR marchand.

**Dashboard admin** — Opérateurs CamWallet qui supervisent les transactions, valident les dossiers KYC, gèrent les alertes et consultent les indicateurs financiers. Contexte : desktop, sessions longues, besoin de densité d'information sans surcharge.

## Product Purpose

CamWallet est un portefeuille de crédit QR prépayé pour le Cameroun. Il s'intercale entre les utilisateurs et les opérateurs mobile money (Orange Money, MTN MoMo via CamPay) sans nécessiter de licence bancaire BEAC/COBAC. Le succès se mesure à la rapidité d'un paiement QR (< 10 secondes perçus), à la confiance que l'utilisateur accorde au solde affiché, et à la facilité avec laquelle un marchand encaisse sans formation préalable.

## Brand Personality

Moderne, premium, sombre. Fintech africain de nouvelle génération : l'interface doit inspirer confiance comme un produit international, tout en étant immédiatement reconnaissable comme pensé pour le marché camerounais (langue française, montants en FCFA, patterns locaux). Ton : direct, compétent, jamais arrogant.

## Anti-references

Éviter tout ce qui évoque les apps de loterie, de paris ou de mobile money "première génération" : dégradés criards, icônes en plastique brillant, animations excessives, palettes vert-orange saturées. Pas de style bancaire corporatif froid non plus (bleu institutionnel, grilles austères, formulaires sans âme). L'identité doit être distincte des néobanques européennes (Revolut, N26) — premium mais ancré Cameroun.

## Design Principles

1. **Une action par écran** — chaque vue a un objectif principal évident ; dans une app de paiement, l'ambiguïté est une erreur UX critique.
2. **La confiance par la retenue** — dark UI raffiné, typographie sobre, espacement généreux. Le premium vient de l'absence de superflu, pas de l'accumulation d'effets.
3. **Les montants sont sacrés** — le solde, le montant envoyé/reçu et les confirmations sont toujours lisibles, jamais tronqués, jamais cachés derrière une animation.
4. **Pensé pour Android en 3G** — touch targets ≥ 44 px, pas de hover-only states, poids d'assets raisonnable, dégradation gracieuse sur connexion lente.
5. **Français natif** — pas de traductions approximatives : microcopy, messages d'erreur et étiquettes sont écrits comme si un locuteur francophone camerounais les avait rédigés.

## Accessibility & Inclusion

WCAG AA minimum sur les deux surfaces. Contraste corps ≥ 4.5:1 sur fond sombre. Touch targets ≥ 44 × 44 px sur mobile. Pas d'information transmise par la couleur seule (statuts de transaction lisibles sans couleur). Prise en compte des préférences `prefers-reduced-motion` pour les animations.
