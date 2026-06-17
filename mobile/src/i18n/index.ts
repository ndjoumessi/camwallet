import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import fr from './fr.json';
import en from './en.json';

const LANG_KEY = 'cw_language';
const SUPPORTED = ['fr', 'en'] as const;
type Lang = (typeof SUPPORTED)[number];

// Langue du téléphone (expo-localization) si elle est supportée, sinon français.
function deviceLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED as readonly string[]).includes(code)) return code as Lang;
  } catch {}
  return 'fr';
}

// Initialisation SYNCHRONE au chargement du module : les ressources de
// traduction sont disponibles dès le tout premier rendu. Sinon `t('clé')`
// renvoie la clé brute le temps que l'init asynchrone se termine — c'est ce qui
// affichait « splash.tagline » sur le SplashScreen. On démarre avec la langue
// du téléphone ; la préférence sauvegardée (AsyncStorage, asynchrone) est
// appliquée juste après par initI18n().
i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: deviceLang(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export async function initI18n() {
  // Applique la préférence de langue sauvegardée si elle diffère de la langue
  // du téléphone utilisée à l'initialisation synchrone ci-dessus.
  try {
    const saved = await AsyncStorage.getItem(LANG_KEY);
    if (saved && (SUPPORTED as readonly string[]).includes(saved) && saved !== i18n.language) {
      await i18n.changeLanguage(saved);
    }
  } catch {}
}

export async function setLanguage(lang: 'fr' | 'en') {
  await AsyncStorage.setItem(LANG_KEY, lang);
  await i18n.changeLanguage(lang);
}

export { i18n };
