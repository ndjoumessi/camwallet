import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import fr from './fr.json';
import en from './en.json';

const LANG_KEY = 'cw_language';

export async function initI18n() {
  let savedLang = 'fr';
  try { savedLang = (await AsyncStorage.getItem(LANG_KEY)) ?? 'fr'; } catch {}

  await i18n.use(initReactI18next).init({
    resources: { fr: { translation: fr }, en: { translation: en } },
    lng: savedLang,
    fallbackLng: 'fr',
    interpolation: { escapeValue: false },
  });
}

export async function setLanguage(lang: 'fr' | 'en') {
  await AsyncStorage.setItem(LANG_KEY, lang);
  await i18n.changeLanguage(lang);
}

export { i18n };
