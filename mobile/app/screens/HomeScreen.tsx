import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, Shadows } from '../constants/theme';
import { txMeta } from '../constants/txMeta';
import { Avatar, Badge, SectionTitle, IconButton, Toast } from '../components/ui';
import { useStore } from '../store/useStore';
import SendModal from './modals/SendModal';
import ReceiveModal from './modals/ReceiveModal';
import RechargeModal from './modals/RechargeModal';
import ScanModal, { ScannedRecipient } from './modals/ScanModal';

const { width } = Dimensions.get('window');

type ModalType = 'send' | 'receive' | 'recharge' | 'scan' | null;

const QUICK_AMOUNTS = [5000, 10000, 25000];

export default function HomeScreen() {
  const { user, balance, showBalance, toggleShowBalance, contacts, transactions } = useStore();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [scannedRecipient, setScannedRecipient] = useState<ScannedRecipient | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

  const ACTION_BTNS: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; modal: ModalType }[] = [
    { icon: 'arrow-up', label: 'Envoyer', color: Colors.blue, modal: 'send' },
    { icon: 'arrow-down', label: 'Recevoir', color: Colors.primary, modal: 'receive' },
    { icon: 'flash', label: 'Recharger', color: Colors.yellow, modal: 'recharge' },
    { icon: 'scan-outline', label: 'Scanner', color: Colors.purple, modal: 'scan' },
  ];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Bonjour 👋</Text>
            <Text style={styles.userName}>{user.name.split(' ')[0]}</Text>
          </View>
          <TouchableOpacity onPress={() => {}}>
            <LinearGradient
              colors={[Colors.primary, Colors.blue]}
              style={styles.avatarGradient}
            >
              <Text style={styles.avatarText}>{user.avatar}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Balance Card */}
        <LinearGradient
          colors={['#0d2a1f', '#0a1628']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          {/* Decorative orbs */}
          <View style={styles.orbTop} />
          <View style={styles.orbBottom} />

          <View style={styles.balanceRow}>
            <View>
              <Text style={styles.balanceLabel}>Solde disponible</Text>
              <Text style={[styles.balanceAmount, !showBalance && styles.balanceHidden]}>
                {showBalance ? fmt(balance) : '•••••• FCFA'}
              </Text>
            </View>
            <IconButton
              icon={showBalance ? 'eye-off-outline' : 'eye-outline'}
              onPress={toggleShowBalance}
              accessibilityLabel={showBalance ? 'Masquer le solde' : 'Afficher le solde'}
              size={18}
              color={Colors.primary}
              bg={Colors.primaryLight}
              style={styles.eyeBtn}
            />
          </View>

          <View style={styles.balanceBadges}>
            <Badge label="Compte vérifié" icon="checkmark-circle" color={Colors.primary} bg={Colors.primaryLight} />
            <Badge label="XAF" color={Colors.blue} bg={Colors.infoBg} />
          </View>
        </LinearGradient>

        {/* Quick actions */}
        <View style={styles.actionGrid}>
          {ACTION_BTNS.map((a) => (
            <TouchableOpacity
              key={a.modal}
              style={styles.actionBtn}
              onPress={() => setActiveModal(a.modal)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <LinearGradient
                colors={[a.color + '30', a.color + '15']}
                style={[styles.actionIcon, { borderColor: a.color + '50' }]}
              >
                <Ionicons name={a.icon} size={20} color={a.color} />
              </LinearGradient>
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Contacts récents */}
        <SectionTitle label="Contacts récents" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.contactsScroll}
          contentContainerStyle={styles.contactsContent}
        >
          {contacts.slice(0, 5).map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.contactItem}
              onPress={() => setActiveModal('send')}
              accessibilityRole="button"
              accessibilityLabel={`Envoyer à ${c.name}`}
            >
              <Avatar initials={c.avatar} size={52} color={c.color} bg={c.color + '20'} />
              <Text style={styles.contactName}>{c.name.split(' ')[0]}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Transactions récentes */}
        <SectionTitle label="Transactions récentes" />
        {transactions.slice(0, 5).map((tx) => {
          const meta = txMeta(tx.type);
          return (
            <View key={tx.id} style={styles.txRow}>
              <View style={[styles.txIcon, { backgroundColor: meta.amountColor + '22' }]}>
                <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={18} color={meta.amountColor} />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txName} numberOfLines={1}>{tx.name}</Text>
                <Text style={styles.txDate}>{tx.date}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: meta.amountColor }]}>
                  {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                </Text>
                <Badge label={meta.label} color={meta.badgeText} bg={meta.badgeBg} />
              </View>
            </View>
          );
        })}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} />}

      {/* Modals */}
      <SendModal
        visible={activeModal === 'send'}
        onClose={() => { setActiveModal(null); setScannedRecipient(null); }}
        onSuccess={(msg) => showToast(msg)}
        initialRecipient={scannedRecipient}
      />
      <ReceiveModal visible={activeModal === 'receive'} onClose={() => setActiveModal(null)} />
      <RechargeModal visible={activeModal === 'recharge'} onClose={() => setActiveModal(null)} onSuccess={(msg) => showToast(msg)} />
      <ScanModal
        visible={activeModal === 'scan'}
        onClose={() => setActiveModal(null)}
        onDetected={(recipient) => { setScannedRecipient(recipient); setActiveModal('send'); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: 80 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  greeting: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: 2 },
  userName: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  avatarGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontWeight: Typography.black, fontSize: Typography.sm },

  // Balance
  balanceCard: {
    borderRadius: BorderRadius.xxl,
    padding: Spacing.xxl,
    marginBottom: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    overflow: 'hidden',
  },
  orbTop: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary + '08',
  },
  orbBottom: {
    position: 'absolute',
    bottom: -20,
    left: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.blue + '08',
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  balanceLabel: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: 6 },
  balanceAmount: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: Typography.black,
    letterSpacing: -1,
  },
  balanceHidden: { fontSize: Typography.xl },
  eyeBtn: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.sm,
  },
  balanceBadges: { flexDirection: 'row', gap: Spacing.sm },

  // Actions
  actionGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  actionIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { color: Colors.textSoft, fontSize: Typography.xs, fontWeight: Typography.semibold },

  // Contacts
  contactsScroll: { marginBottom: Spacing.xxl },
  contactsContent: { gap: Spacing.lg, paddingBottom: 4 },
  contactItem: { alignItems: 'center', gap: 6 },
  contactName: { color: Colors.textSoft, fontSize: Typography.xs },

  // Transactions
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  txIcon: {
    width: 42,
    height: 42,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  txInfo: { flex: 1, minWidth: 0 },
  txName: {
    color: Colors.text,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  txDate: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  txRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  txAmount: { fontSize: Typography.base, fontWeight: Typography.bold },
});
