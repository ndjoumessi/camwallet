import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Badge } from '../components/ui';
import { useStore } from '../store/useStore';

const MENU_ITEMS = [
  {
    icon: '🔒',
    label: 'Sécurité & PIN',
    desc: 'Modifier votre PIN, biométrie',
    group: 'Compte',
  },
  { icon: '🔔', label: 'Notifications', desc: 'Alertes SMS et push', group: 'Compte' },
  { icon: '📋', label: 'KYC & Identité', desc: 'Vérification compte', group: 'Compte' },
  { icon: '💳', label: 'Limites & Plafonds', desc: 'Gérer vos plafonds', group: 'Compte' },
  { icon: '📊', label: 'Mes statistiques', desc: 'Dépenses, économies', group: 'Activité' },
  { icon: '🎁', label: 'Cashback & Promos', desc: 'Offres en cours', group: 'Activité' },
  { icon: '❓', label: 'Aide & Support', desc: 'Centre d\'aide, contact', group: 'Support' },
  { icon: '📜', label: 'Conditions d\'utilisation', desc: '', group: 'Support' },
  { icon: '🔐', label: 'Confidentialité', desc: 'Données personnelles', group: 'Support' },
];

const GROUPS = ['Compte', 'Activité', 'Support'];

interface ProfileScreenProps {
  onLogout: () => void;
}

export default function ProfileScreen({ onLogout }: ProfileScreenProps) {
  const { user, balance } = useStore();

  const handleLogout = () => {
    Alert.alert(
      'Se déconnecter',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Se déconnecter', style: 'destructive', onPress: onLogout },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile card */}
      <LinearGradient
        colors={['#0d2a1f', '#0a1628']}
        style={styles.profileCard}
      >
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{user.avatar}</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profilePhone}>+237 {user.phone}</Text>
          <View style={styles.profileBadges}>
            <Badge label="✓ Vérifié" color={Colors.primary} bg={Colors.primaryLight} />
            <Badge label="🇨🇲 XAF" color={Colors.blue} bg={Colors.infoBg} />
          </View>
        </View>
      </LinearGradient>

      {/* Balance summary */}
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{balance.toLocaleString('fr-FR')}</Text>
          <Text style={styles.statLabel}>Solde FCFA</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>127</Text>
          <Text style={styles.statLabel}>Transactions</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>Pro</Text>
          <Text style={styles.statLabel}>Compte</Text>
        </View>
      </View>

      {/* Menu groups */}
      {GROUPS.map((group) => (
        <View key={group} style={styles.menuGroup}>
          <Text style={styles.groupLabel}>{group}</Text>
          {MENU_ITEMS.filter((m) => m.group === group).map((item) => (
            <TouchableOpacity
              key={item.label}
              style={styles.menuItem}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <View style={styles.menuItemIcon}>
                <Text style={{ fontSize: 20 }}>{item.icon}</Text>
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{item.label}</Text>
                {item.desc ? <Text style={styles.menuItemDesc}>{item.desc}</Text> : null}
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>🚪 Se déconnecter</Text>
      </TouchableOpacity>

      <Text style={styles.version}>CamWallet v1.0.0 · Marché Cameroun 🇨🇲</Text>
      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  profileCard: {
    margin: Spacing.lg, borderRadius: BorderRadius.xxl,
    padding: Spacing.xl, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  profileAvatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '30', borderWidth: 2, borderColor: Colors.primary + '60',
    alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarText: { color: Colors.primary, fontWeight: Typography.black, fontSize: Typography.xl },
  profileInfo: { flex: 1, gap: 4 },
  profileName: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black },
  profilePhone: { color: Colors.textMuted, fontSize: Typography.sm },
  profileBadges: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  statsRow: {
    flexDirection: 'row', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl, padding: Spacing.lg,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black },
  statLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  menuGroup: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.xl },
  groupLabel: {
    color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: Spacing.sm,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  menuItemIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  menuItemInfo: { flex: 1 },
  menuItemLabel: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  menuItemDesc: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  chevron: { color: Colors.textMuted, fontSize: 20 },
  logoutBtn: {
    margin: Spacing.lg, marginTop: 0,
    backgroundColor: Colors.errorBg, borderWidth: 1, borderColor: Colors.red + '40',
    borderRadius: BorderRadius.lg, padding: Spacing.lg, alignItems: 'center',
  },
  logoutText: { color: Colors.red, fontSize: Typography.base, fontWeight: Typography.bold },
  version: {
    color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center',
    marginBottom: Spacing.md,
  },
});
