# CamWallet Mobile App

Application mobile de paiement QR prépayé pour le marché camerounais.

## Stack

- **React Native** + **Expo** (~52)
- **Expo Router** (navigation basée sur les fichiers)
- **Zustand** (state management)
- **react-native-qrcode-svg** (génération QR)
- **expo-local-authentication** (biométrie)
- **expo-secure-store** (stockage sécurisé PIN)

## Structure

```
mobile/
├── app/
│   ├── constants/
│   │   └── theme.ts          # Design system (couleurs, typo, spacing)
│   ├── store/
│   │   └── useStore.ts       # Zustand global store
│   ├── components/
│   │   └── ui.tsx            # Composants réutilisables (Button, Avatar, Badge…)
│   ├── screens/
│   │   ├── SplashScreen.tsx
│   │   ├── OnboardingScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── HistoryScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   └── modals/
│   │       ├── SendModal.tsx     # Envoi P2P (contact → montant → PIN → reçu)
│   │       ├── ReceiveModal.tsx  # QR statique & dynamique
│   │       ├── RechargeModal.tsx # MTN MoMo / Orange Money / Agent
│   │       └── ScanModal.tsx     # Scanner QR Code
│   └── index.tsx             # App root + navigation tabs
├── app.json
└── package.json
```

## Démarrage rapide

```bash
# Installer les dépendances
npm install

# Démarrer Expo
npm start

# Android
npm run android

# iOS
npm run ios
```

## Fonctionnalités MVP

| Feature | Statut |
|---------|--------|
| Splash + Onboarding 3 slides | ✅ |
| Inscription téléphone + OTP SMS | ✅ |
| Création PIN à 6 chiffres | ✅ |
| Dashboard solde (masquable) | ✅ |
| Envoi P2P (contact → montant → PIN → reçu) | ✅ |
| Recevoir (QR statique + dynamique) | ✅ |
| Recharge (MTN MoMo / Orange Money / Agent) | ✅ |
| Scanner QR Code | ✅ |
| Historique filtrable + recherche | ✅ |
| Profil + paramètres | ✅ |
| Partage reçu WhatsApp | ✅ |
| Navigation bottom tabs | ✅ |

## Design System

**Palette** : Dark fintech — fond `#0A0F1E`, vert CamWallet `#00C896`, surfaces `#111827` / `#161D2F`

**Typographie** : System font (San Francisco iOS / Roboto Android)

**Animations** : Spring animations, shake PIN incorrect, scan line animée

## Comptes de test

- **PIN** : `123456`
- **OTP** : `847291`

## Build production

```bash
# Android APK
eas build --platform android --profile preview

# iOS TestFlight
eas build --platform ios --profile preview
```

## Variables d'environnement requises

```env
EXPO_PUBLIC_API_URL=https://api.camwallet.cm
EXPO_PUBLIC_OM_CLIENT_ID=xxx
EXPO_PUBLIC_MTN_CLIENT_ID=xxx
EXPO_PUBLIC_SMS_PROVIDER=africas_talking
```
