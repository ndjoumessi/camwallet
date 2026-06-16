import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, BALANCE_GRADIENT } from '../constants/theme';
import { txMeta } from '../constants/txMeta';
import { Avatar, Badge, SectionTitle, IconButton, Toast } from '../components/ui';
import { useStore } from '../store/useStore';
import { loyaltyApi } from '../../src/lib/api';
import SendModal from './modals/SendModal';
import { useTranslation } from 'react-i18next';
import ReceiveModal from './modals/ReceiveModal';
import RechargeModal from './modals/RechargeModal';
import WithdrawModal from './modals/WithdrawModal';
import ScanModal, { ScannedRecipient } from './modals/ScanModal';

type ModalType = 'send' | 'receive' | 'recharge' | 'withdraw' | 'scan' | null;

export default function HomeScreen() {
  const { user, balance, showBalance, toggleShowBalance, recentContacts, transactions, fetchBalance, fetchHistory, openTransaction } = useStore();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [scannedRecipient, setScannedRecipient] = useState<ScannedRecipient | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [loyalty, setLoyalty] = useState<{ points: number; nextReward: number } | null>(null);

  // Animation d'entrée — balance card + stagger des boutons d'action
  const cardEnter = useRef(new Animated.Value(0)).current;
  const actionAnims = useRef(Array.from({ length: 5 }, () => new Animated.Value(0))).current;

  useEffect(() => {
    const runEntrance = () => {
      Animated.parallel([
        Animated.timing(cardEnter, {
          toValue: 1, duration: 350, delay: 50,
          easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.stagger(60, actionAnims.map((a) =>
          Animated.timing(a, {
            toValue: 1, duration: 220, delay: 200,
            easing: Easing.out(Easing.quad), useNativeDriver: true,
          })
        )),
      ]).start();
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (rm) {
          cardEnter.setValue(1);
          actionAnims.forEach((a) => a.setValue(1));
        } else {
          runEntrance();
        }
      })
      .catch(runEntrance);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loyaltyApi.getPoints()
      .then((pts) => { if (!cancelled) setLoyalty(pts); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Chargement des données réelles au montage (et à chaque retour sur l'écran)
  useEffect(() => {
    fetchBalance();
    fetchHistory();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, []);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

  const { t } = useTranslation();

  const ACTION_BTNS: { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; modal: ModalType }[] = [
    { icon: 'arrow-up', label: t('home.actions.send'), color: Colors.blue, modal: 'send' },
    { icon: 'arrow-down', label: t('home.actions.receive'), color: Colors.primary, modal: 'receive' },
    { icon: 'flash', label: t('home.actions.recharge'), color: Colors.yellow, modal: 'recharge' },
    { icon: 'arrow-undo', label: t('home.actions.withdraw'), color: Colors.orange, modal: 'withdraw' },
    { icon: 'scan-outline', label: t('home.actions.scan'), color: Colors.purple, modal: 'scan' },
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
            <Text style={styles.greeting}>{t('home.greeting')}</Text>
            <Text style={styles.userName}>{user.name.split(' ')[0]}</Text>
          </View>
          <View style={styles.avatarGradient} accessibilityElementsHidden>
            <Text style={styles.avatarText}>{user.avatar}</Text>
          </View>
        </View>

        {/* Balance Card */}
        <Animated.View style={{
          marginBottom: Spacing.xl,
          opacity: cardEnter,
          transform: [{ translateY: cardEnter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        }}>
        <LinearGradient
          colors={BALANCE_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          {/* Decorative orbs */}
          <View style={styles.orbTop} />
          <View style={styles.orbBottom} />

          <View style={styles.balanceRow}>
            <View style={styles.balanceInfo}>
              <Text style={styles.balanceLabel}>{t('home.availableBalance')}</Text>
              <Text
                style={[styles.balanceAmount, !showBalance && styles.balanceHidden]}
                adjustsFontSizeToFit
                numberOfLines={1}
                minimumFontScale={0.72}
              >
                {showBalance ? fmt(balance) : '•••••• FCFA'}
              </Text>
            </View>
            <IconButton
              icon={showBalance ? 'eye-off-outline' : 'eye-outline'}
              onPress={toggleShowBalance}
              accessibilityLabel={showBalance ? t('home.a11yHideBalance') : t('home.a11yShowBalance')}
              size={18}
              color={Colors.primary}
              bg={Colors.primaryLight}
              style={styles.eyeBtn}
            />
          </View>

          <View style={styles.balanceBadges}>
            <Badge label={t('home.balanceBadgeVerified')} icon="checkmark-circle" color={Colors.primary} bg={Colors.primaryLight} />
            <Badge label="XAF" color={Colors.blue} bg={Colors.infoBg} />
          </View>
        </LinearGradient>
        </Animated.View>

        {/* Bannière fidélité */}
        {loyalty !== null && (
          <View style={styles.loyaltyBanner}>
            <Text style={styles.loyaltyText}>
              {t('home.loyaltyBanner', { points: loyalty.points.toLocaleString('fr-FR'), nextReward: loyalty.nextReward.toLocaleString('fr-FR') })}
            </Text>
          </View>
        )}

        {/* Quick actions */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionScroll}
          contentContainerStyle={styles.actionGrid}
        >
          {ACTION_BTNS.map((a, idx) => (
            <Animated.View
              key={a.modal}
              style={{
                opacity: actionAnims[idx],
                transform: [{ translateY: actionAnims[idx].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
              }}
            >
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => setActiveModal(a.modal)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <View style={[styles.actionIcon, { backgroundColor: a.color + '20', borderColor: a.color + '40' }]}>
                  <Ionicons name={a.icon} size={20} color={a.color} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </ScrollView>

        {/* Contacts récents (dérivés de l'historique API) */}
        {recentContacts.length > 0 && (
          <>
            <SectionTitle label={t('home.recentContacts')} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.contactsScroll}
              contentContainerStyle={styles.contactsContent}
            >
              {recentContacts.map((c) => (
                <TouchableOpacity
                  key={c.phone}
                  style={styles.contactItem}
                  onPress={() => setActiveModal('send')}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.a11yContactSend', { name: c.name })}
                >
                  <Avatar initials={c.initials} size={52} color={c.color} bg={c.color + '20'} />
                  <Text style={styles.contactName}>{c.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}

        {/* Transactions récentes */}
        <SectionTitle label={t('home.recentTransactions')} />
        {transactions.slice(0, 5).map((tx) => {
          const meta = txMeta(tx.type);
          return (
            <TouchableOpacity
              key={tx.id}
              style={styles.txRow}
              onPress={() => openTransaction(tx)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('home.a11yTxDetail', { type: meta.label, name: tx.name, amount: fmt(tx.amount) })}
            >
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
            </TouchableOpacity>
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
      <WithdrawModal visible={activeModal === 'withdraw'} onClose={() => setActiveModal(null)} onSuccess={(msg) => showToast(msg)} />
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
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontWeight: Typography.black, fontSize: Typography.sm },

  // Balance
  balanceCard: {
    borderRadius: BorderRadius.xxl,
    padding: Spacing.xxl,
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
  balanceInfo: { flex: 1, marginRight: Spacing.sm },
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
  actionScroll: { marginBottom: Spacing.xxl },
  actionGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingVertical: 4,
  },
  actionBtn: {
    width: 80,
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
    width: 44,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { color: Colors.textSoft, fontSize: Typography.xs, fontWeight: Typography.semibold },

  // Contacts
  contactsScroll: { marginBottom: Spacing.xxl },
  contactsContent: { gap: Spacing.lg, paddingVertical: Spacing.sm },
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
    width: 44,
    height: 44,
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

  // Fidélité
  loyaltyBanner: {
    backgroundColor: Colors.primary + '18',
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.xl,
    alignItems: 'center',
  },
  loyaltyText: {
    color: Colors.primary,
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
  },
});
