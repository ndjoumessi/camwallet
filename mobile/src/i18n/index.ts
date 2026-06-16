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

export async function initI18n() {
  // Priorité : préférence sauvegardée > langue du téléphone > français (fallback).
  let lang: Lang = deviceLang();
  try {
    const saved = await AsyncStorage.getItem(LANG_KEY);
    if (saved && (SUPPORTED as readonly string[]).includes(saved)) lang = saved as Lang;
  } catch {}

  await i18n.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: lang,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });
}

export async function setLanguage(lang: 'fr' | 'en') {
  await AsyncStorage.setItem(LANG_KEY, lang);
  await i18n.changeLanguage(lang);
}

export { i18n };
