import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_KEY = 'cw_theme';

export type ThemeMode = 'dark' | 'light';

// Palettes dark (valeurs par défaut de l'app) et light.
export const DarkColors = {
  primary: '#00C896',
  primaryDark: '#008F6A',
  primaryLight: '#00C89620',
  primaryMid: '#00C89640',
  blue: '#3B82F6',
  yellow: '#F5C542',
  red: '#FF4D6D',
  purple: '#A78BFA',
  bg: '#0A0F1E',
  surface: '#111827',
  card: '#161D2F',
  cardHover: '#1C2540',
  border: '#1E2D45',
  borderLight: '#263350',
  text: '#EEF2FF',
  textMuted: '#64748B',
  textSoft: '#94A3B8',
  success: '#00C896',
  warning: '#F5C542',
  error: '#FF4D6D',
  info: '#3B82F6',
  successBg: '#00C89615',
  warningBg: '#F5C54215',
  errorBg: '#FF4D6D15',
  infoBg: '#3B82F615',
  mtn: '#FFCC00',
  mtnBg: '#FFCC0015',
  orange: '#FF6600',
  orangeBg: '#FF660015',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: 'rgba(0,0,0,0.75)',
};

export const LightColors: typeof DarkColors = {
  primary: '#009870',
  primaryDark: '#006A4E',
  primaryLight: '#00987015',
  primaryMid: '#00987030',
  blue: '#2563EB',
  yellow: '#D97706',
  red: '#DC2626',
  purple: '#7C3AED',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  cardHover: '#F1F5F9',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',
  text: '#0F172A',
  textMuted: '#94A3B8',
  textSoft: '#64748B',
  success: '#009870',
  warning: '#D97706',
  error: '#DC2626',
  info: '#2563EB',
  successBg: '#00987010',
  warningBg: '#D9770610',
  errorBg: '#DC262610',
  infoBg: '#2563EB10',
  mtn: '#B45309',
  mtnBg: '#FEF3C7',
  orange: '#C2410C',
  orangeBg: '#FFF7ED',
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: 'rgba(0,0,0,0.4)',
};

interface ThemeContextValue {
  mode: ThemeMode;
  colors: typeof DarkColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: DarkColors,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then((v) => {
      if (v === 'light' || v === 'dark') setMode(v);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, colors: mode === 'dark' ? DarkColors : LightColors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
