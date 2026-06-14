import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { Colors, Typography, Spacing } from './constants/theme';
import SplashScreen from './screens/SplashScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import HistoryScreen from './screens/HistoryScreen';
import ProfileScreen from './screens/ProfileScreen';
import { useStore } from './store/useStore';

type Phase = 'splash' | 'onboard' | 'login' | 'app';
type Tab = 'home' | 'history' | 'profile';

const NAV_TABS = [
  { id: 'home' as Tab, icon: '⊞', label: 'Accueil' },
  { id: 'history' as Tab, icon: '≡', label: 'Historique' },
  { id: 'profile' as Tab, icon: '◉', label: 'Profil' },
];

export default function App() {
  const [phase, setPhase] = useState<Phase>('splash');
  const [activeTab, setActiveTab] = useState<Tab>('home');

  const restoreSession = useStore((s) => s.restoreSession);
  const logout = useStore((s) => s.logout);
  const isAuthenticated = useStore((s) => s.isAuthenticated);

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
    <SafeAreaView style={styles.safe}>
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
          <TouchableOpacity style={styles.notifBtn}>
            <Text style={styles.notifIcon}>🔔</Text>
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Screen content */}
      <View style={styles.content}>
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'profile' && (
          <ProfileScreen
            onLogout={() => {
              logout();
              setActiveTab('home');
              setPhase('login');
            }}
          />
        )}
      </View>

      {/* Bottom navigation */}
      <View style={styles.bottomNav}>
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TouchableOpacity
              key={tab.id}
              style={styles.navBtn}
              onPress={() => setActiveTab(tab.id)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.navIcon, isActive && styles.navIconActive]}>
                {tab.icon}
              </Text>
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                {tab.label}
              </Text>
              {isActive && <View style={styles.navDot} />}
            </TouchableOpacity>
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
  notifBtn: { position: 'relative', padding: 4 },
  notifIcon: { fontSize: 22 },
  notifDot: {
    position: 'absolute', top: 4, right: 4,
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
    paddingVertical: Spacing.xs,
  },
  navIcon: { fontSize: 22, color: Colors.textMuted },
  navIconActive: { color: Colors.primary },
  navLabel: { fontSize: Typography.xs, color: Colors.textMuted, fontWeight: Typography.medium },
  navLabelActive: { color: Colors.primary, fontWeight: Typography.bold },
  navDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: Colors.primary, marginTop: 1,
  },
});
