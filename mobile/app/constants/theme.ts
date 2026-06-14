// CamWallet Design System — Dark Fintech Theme
// Based on UI/UX Pro Max guidelines for fintech mobile

export const Colors = {
  // Brand
  primary: '#00C896',
  primaryDark: '#008F6A',
  primaryLight: '#00C89620',
  primaryMid: '#00C89640',

  // Accent
  blue: '#3B82F6',
  yellow: '#F5C542',
  red: '#FF4D6D',
  purple: '#A78BFA',
  orange: '#F97316',

  // Backgrounds
  bg: '#0A0F1E',
  surface: '#111827',
  card: '#161D2F',
  cardHover: '#1C2540',

  // Borders
  border: '#1E2D45',
  borderLight: '#263350',

  // Text
  text: '#EEF2FF',
  textMuted: '#64748B',
  textSoft: '#94A3B8',

  // Semantic
  success: '#00C896',
  warning: '#F5C542',
  error: '#FF4D6D',
  info: '#3B82F6',

  // Status backgrounds
  successBg: '#00C89615',
  warningBg: '#F5C54215',
  errorBg: '#FF4D6D15',
  infoBg: '#3B82F615',

  // Operators
  mtn: '#FFCC00',
  mtnBg: '#FFCC0015',
  orange: '#FF6600',
  orangeBg: '#FF660015',

  // Misc
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
  overlay: 'rgba(0,0,0,0.75)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 999,
};

export const Typography = {
  // Font sizes
  xs: 10,
  sm: 12,
  base: 14,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  display: 30,
  hero: 36,

  // Font weights
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  black: '900' as const,

  // Line heights
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.7,
};

export const Shadows = {
  card: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
};

export const Animation = {
  fast: 150,
  normal: 250,
  slow: 350,
  spring: { damping: 18, stiffness: 200 },
};
