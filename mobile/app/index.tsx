import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  StatusBar,
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
import { useStore } from './store/useStore';
import { registerForPushNotifications } from '../src/lib/notifications';

type Phase = 'splash' | 'onboard' | 'login' | 'app';
type Tab = 'home' | 'history' | 'profile';

const NAV_TABS: { id: Tab; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { id: 'home', icon: 'home-outline', iconActive: 'home', label: 'Accueil' },
  { id: 'history', icon: 'time-outline', iconActive: 'time', label: 'Historique' },
  { id: 'profile', icon: 'person-outline', iconActive: 'person', label: 'Profil' },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>('splash');
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showMerchant, setShowMerchant] = useState(false);

  const restoreSession = useStore((s) => s.restoreSession);
  const logout = useStore((s) => s.logout);
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  const pushRegistered = useRef(false);

  // Une fois authentifié et dans l'app : enregistre le jeton push (une seule fois).
  useEffect(() => {
    if (phase === 'app' && isAuthenticated && !pushRegistered.current) {
      pushRegistered.current = true;
      registerForPushNotifications();
    }
    if (!isAuthenticated) pushRegistered.current = false; // ré-enregistrer au prochain login
  }, [phase, isAuthenticated]);

  // Au démarrage : tente de restaurer une session existante (tokens SecureStore).
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Si la session est restaurée pendant l'onboarding/login, on entre dans l'app.
  useEffect(() => {
    if (isAuthenticated && (phase === 'login' || phase === 'onboard')) {
      setPhase('app');
    }
  }, [isAuthenticated, phase]);

  if (phase === 'splash') {
    // À la fin du splash : direct dans l'app si déjà authentifié, sinon onboarding.
    return (
      <SplashScreen
        onFinish={() =>
          setPhase(useStore.getState().isAuthenticated ? 'app' : 'onboard')
        }
      />
    );
  }

  if (phase === 'onboard') {
    return <OnboardingScreen onComplete={() => setPhase('login')} />;
  }

  if (phase === 'login') {
    return <LoginScreen onSuccess={() => setPhase('app')} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

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

      {/* Screen content */}
      <View style={styles.content}>
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
