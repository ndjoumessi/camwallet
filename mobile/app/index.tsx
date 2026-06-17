import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
  AppState,
  AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { IconButton } from './components/ui';
import { Colors, Typography, Spacing } from './constants/theme';
import SplashScreen from './screens/SplashScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import HistoryScreen from './screens/HistoryScreen';
import ProfileScreen from './screens/ProfileScreen';
import MerchantScreen from './screens/MerchantScreen';
import TransactionDetailScreen from './screens/TransactionDetailScreen';
import { useStore } from './store/useStore';
import { registerForPushNotifications, addNotificationTapHandler } from '../src/lib/notifications';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { initSentry } from '../src/lib/sentry';
import { initI18n } from '../src/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Phase = 'splash' | 'onboard' | 'login' | 'app';
type Tab = 'home' | 'history' | 'profile';

// Marqueur « intro vue » posé par l'OnboardingScreen — décide, sans session
// valide, entre onboarding (jamais vu) et LoginScreen (déjà inscrit).
const ONBOARDING_SEEN_KEY = 'cw_has_seen_onboarding';

const NAV_TABS: { id: Tab; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { id: 'home', icon: 'home-outline', iconActive: 'home', label: 'Accueil' },
  { id: 'history', icon: 'time-outline', iconActive: 'time', label: 'Historique' },
  { id: 'profile', icon: 'person-outline', iconActive: 'person', label: 'Profil' },
];

function AppContent() {
  const [phase, setPhase] = useState<Phase>('splash');
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const hasSeenOnboardingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showMerchant, setShowMerchant] = useState(false);
  const { colors: TC } = useTheme();

  const restoreSession = useStore((s) => s.restoreSession);
  const logout = useStore((s) => s.logout);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const selectedTransaction = useStore((s) => s.selectedTransaction);
  const closeTransaction = useStore((s) => s.closeTransaction);
  const openTransactionById = useStore((s) => s.openTransactionById);
  const pushRegistered = useRef(false);

  // Initialisation au démarrage : Sentry + i18n
  useEffect(() => {
    initSentry();
    initI18n();
  }, []);

  // ── Timer d'inactivité (AU-09 CDC) — déconnexion après 15 min sans interaction
  const INACTIVITY_MS = 15 * 60 * 1000;
  const lastActivityRef = useRef<number>(Date.now());
  const backgroundedAtRef = useRef<number>(0);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const doLogout = useCallback(() => {
    logout();
    setPhase('login');
    setActiveTab('home');
  }, [logout]);

  // Vérification périodique de l'inactivité en foreground (toutes les 60 s)
  useEffect(() => {
    if (phase !== 'app') return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_MS) doLogout();
    }, 60_000);
    return () => clearInterval(timer);
  }, [phase, doLogout]);

  // Déconnexion si l'app revient au premier plan après > 15 min en arrière-plan
  useEffect(() => {
    if (phase !== 'app') return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        backgroundedAtRef.current = Date.now();
      } else if (state === 'active') {
        if (backgroundedAtRef.current && Date.now() - backgroundedAtRef.current > INACTIVITY_MS) {
          doLogout();
        }
        backgroundedAtRef.current = 0;
        lastActivityRef.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [phase, doLogout]);

  // Une fois authentifié et dans l'app : enregistre le jeton push (une seule fois).
  useEffect(() => {
    if (phase === 'app' && isAuthenticated && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications();
    }
    if (!isAuthenticated) pushRegistered.current = false; // ré-enregistrer au prochain login
  }, [phase, isAuthenticated]);

  // Deep link : un tap sur une notification ouvre la transaction concernée
  // (data.transactionId), sinon bascule simplement sur l'onglet Historique.
  useEffect(() => {
    if (phase !== 'app') return;
    const handler = addNotificationTapHandler((data) => {
      setActiveTab('history');
      const txId = data?.transactionId;
      if (typeof txId === 'string' && txId) {
        void openTransactionById(txId);
      }
    });
    return () => handler.remove();
  }, [phase, openTransactionById]);

  // Au démarrage : tente de restaurer une session existante (tokens SecureStore).
  // On attend la fin de cette vérification avant de router (cf. effet du splash)
  // pour ne jamais afficher l'onboarding alors qu'un token valide existe.
  useEffect(() => {
    let cancelled = false;
    restoreSession()
      .then((ok) => {
        console.log('[restoreSession] token valide =', ok, '| authentifié =', useStore.getState().isAuthenticated);
      })
      .catch((e) => {
        console.log('[restoreSession] échec', e);
      })
      .finally(() => {
        if (!cancelled) setRestoreChecked(true);
      });
    return () => { cancelled = true; };
  }, [restoreSession]);

  // Au démarrage : lit le marqueur d'onboarding. En l'absence de session valide,
  // il décide entre l'onboarding (jamais vu) et le LoginScreen (déjà inscrit).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((v) => { if (!cancelled) hasSeenOnboardingRef.current = v === 'true'; })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOnboardingChecked(true); });
    return () => { cancelled = true; };
  }, []);

  // Si la session est restaurée pendant l'onboarding/login, on entre dans l'app.
  useEffect(() => {
    if (isAuthenticated && (phase === 'login' || phase === 'onboard')) {
      setPhase('app');
    }
  }, [isAuthenticated, phase]);

  // Tout utilisateur authentifié (login, inscription ou session restaurée) est par
  // définition « inscrit » : on marque l'onboarding comme vu pour qu'une éventuelle
  // déconnexion le ramène au LoginScreen, jamais à l'onboarding. Couvre aussi les
  // installations antérieures à l'introduction du flag.
  useEffect(() => {
    if (isAuthenticated) {
      hasSeenOnboardingRef.current = true;
      void AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
    }
  }, [isAuthenticated]);

  // Routage de fin de splash : on attend que l'animation ET la restauration de
  // session soient terminées, puis on entre directement dans l'app si un token
  // valide existe, sinon onboarding. Évite tout flash d'onboarding au démarrage.
  useEffect(() => {
    if (phase === 'splash' && splashDone && restoreChecked && onboardingChecked) {
      const authed = useStore.getState().isAuthenticated;
      // Session valide → app ; sinon déjà inscrit (intro vue) → login ; sinon onboarding.
      const next: Phase = authed ? 'app' : hasSeenOnboardingRef.current ? 'login' : 'onboard';
      console.log('[boot] routage splash →', next);
      setPhase(next);
    }
  }, [phase, splashDone, restoreChecked, onboardingChecked]);

  if (phase === 'splash') {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
  }

  if (phase === 'onboard') {
    return <OnboardingScreen onComplete={() => setPhase('login')} />;
  }

  if (phase === 'login') {
    return (
      <LoginScreen
        onSuccess={() => setPhase('app')}
        onRegister={() => setPhase('onboard')}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: TC.bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={TC.bg === '#F8FAFC' ? 'dark-content' : 'light-content'} backgroundColor={TC.bg} />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarBrand}>
          <View style={styles.topBarLogo}>
            <Text style={styles.topBarLogoText}>₩</Text>
          </View>
          <Text style={styles.topBarTitle}>
            Cam<Text style={styles.topBarTitleGreen}>Wallet</Text>
          </Text>
        </View>
        <View style={styles.topBarRight}>
          <View>
            <IconButton
              icon="notifications-outline"
              onPress={() => {}}
              accessibilityLabel="Notifications"
              color={Colors.textSoft}
            />
            <View style={styles.notifDot} pointerEvents="none" />
          </View>
        </View>
      </View>

      {/* Screen content — onTouchStart réinitialise le timer d'inactivité */}
      <View style={styles.content} onTouchStart={resetActivity}>
        {showMerchant ? (
          <MerchantScreen onBack={() => setShowMerchant(false)} />
        ) : (
          <>
            {activeTab === 'home' && <HomeScreen />}
            {activeTab === 'history' && <HistoryScreen />}
            {activeTab === 'profile' && (
              <ProfileScreen
                onLogout={() => {
                  logout();
                  setActiveTab('home');
                  setPhase('login');
                }}
                onMerchant={() => setShowMerchant(true)}
              />
            )}
          </>
        )}
      </View>

      {/* Détail transaction — partagé (Accueil / Historique / deep-link notif) */}
      <TransactionDetailScreen transaction={selectedTransaction} onClose={closeTransaction} />

      {/* Bottom navigation */}
      <View style={styles.bottomNav}>
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Pressable
              key={tab.id}
              style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.6 }]}
              onPress={() => setActiveTab(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
            >
              <Ionicons
                name={isActive ? tab.iconActive : tab.icon}
                size={22}
                color={isActive ? Colors.primary : Colors.textMuted}
              />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.navDot} />}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },

  // Top bar
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  topBarBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topBarLogo: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  topBarLogoText: { color: Colors.white, fontWeight: Typography.black, fontSize: Typography.base },
  topBarTitle: { fontSize: Typography.lg, fontWeight: Typography.black, color: Colors.text },
  topBarTitleGreen: { color: Colors.primary },
  topBarRight: { flexDirection: 'row', gap: Spacing.md },
  notifDot: {
    position: 'absolute', top: 9, right: 9,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.red, borderWidth: 1.5, borderColor: Colors.bg,
  },

  // Content
  content: { flex: 1 },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingVertical: Spacing.sm, paddingBottom: Spacing.md,
  },
  navBtn: {
    flex: 1, alignItems: 'center', gap: 4,
    paddingVertical: Spacing.sm,
    minHeight: 48,
  },
  navLabel: { fontSize: Typography.xs, color: Colors.textMuted, fontWeight: Typography.medium },
  navLabelActive: { color: Colors.primary, fontWeight: Typography.bold },
  navDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: Colors.primary, marginTop: 1,
  },
});
