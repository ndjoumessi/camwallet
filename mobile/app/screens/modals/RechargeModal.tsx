import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Button, IconButton } from '../../components/ui';
import { useStore } from '../../store/useStore';
import { walletApi, MobileOperator } from '../../../src/lib/api';
import { useTranslation } from 'react-i18next';

interface RechargeModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const toCentimes = (fcfa: number) => Math.round(fcfa * 100);

const IS_SANDBOX = process.env.EXPO_PUBLIC_ENV === 'development';
const QUICK_AMOUNTS = IS_SANDBOX ? [5, 10, 15, 25] : [5000, 10000, 25000, 50000];

export default function RechargeModal({ visible, onClose, onSuccess }: RechargeModalProps) {
  const { user, fetchBalance } = useStore();
  const { t } = useTranslation();
  const fetchBalanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const METHODS = [
    { id: 'mtn', icon: 'phone-portrait-outline' as const, label: t('recharge.method.mtnLabel'), desc: t('recharge.method.mtnDesc'), color: Colors.mtn, ussd: '*126#' },
    { id: 'orange', icon: 'ellipse' as const, label: t('recharge.method.orangeLabel'), desc: t('recharge.method.orangeDesc'), color: Colors.orange, ussd: '*144#' },
    { id: 'agent', icon: 'storefront-outline' as const, label: t('recharge.method.agentLabel'), desc: t('recharge.method.agentDesc'), color: Colors.blue, ussd: null },
  ];

  useEffect(() => {
    return () => {
      if (fetchBalanceTimerRef.current) clearTimeout(fetchBalanceTimerRef.current);
    };
  }, []);
  const [step, setStep] = useState<'method' | 'amount' | 'pending'>('method');
  const [method, setMethod] = useState<typeof METHODS[0] | null>(null);
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pré-remplir le numéro avec le téléphone de l'utilisateur à l'ouverture
  useEffect(() => {
    if (visible && user.phone) setPhone(user.phone);
  }, [visible, user.phone]);

  const reset = () => { setStep('method'); setMethod(null); setAmount(''); setPhone(user.phone || ''); setError(null); };
  const handleClose = () => { reset(); onClose(); };

  // Micro-animation d'entrée (translateY + opacité) déclenchée à l'ouverture.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.spring(enter, {
        toValue: 1,
        damping: Animation.spring.damping,
        stiffness: Animation.spring.stiffness,
        useNativeDriver: true,
      }).start();
    } else {
      enter.setValue(0);
    }
  }, [visible, enter]);
  const animStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  };

  const handleRecharge = async () => {
    const amt = parseInt(amount);
    if (!amt || !method) return;
    const operator: MobileOperator = method.id === 'orange' ? 'ORANGE_MONEY' : 'MTN_MOMO';
    setLoading(true);
    setError(null);
    try {
      await walletApi.recharge(toCentimes(amt), operator, phone || undefined);
      setStep('pending');
      // Le crédit arrivera via webhook — on rafraîchit le solde dans quelques secondes
      fetchBalanceTimerRef.current = setTimeout(() => fetchBalance(), 5000);
      onSuccess(t('recharge.toastSuccess', { amount: amt.toLocaleString('fr-FR') }));
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('recharge.errorFallback');
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  };

  const amt = parseInt(amount) || 0;

  return (
    <Modal visible={visible} animationType="none" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <Animated.View style={[styles.flex, animStyle]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('recharge.headerTitle')}</Text>
            <IconButton icon="close" onPress={handleClose} accessibilityLabel={t('recharge.closeBtnA11y')} />
          </View>

          {step === 'amount' && (
            <View style={styles.backRow}>
              <IconButton
                icon="arrow-back"
                onPress={() => setStep('method')}
                accessibilityLabel={t('recharge.backA11y')}
                size={20}
              />
              <Text style={styles.backLabel}>{t('recharge.backLabel')}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === 'method' && (
            <>
              <Text style={styles.sectionLabel}>{t('recharge.method.sectionLabel')}</Text>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.methodCard}
                  onPress={() => { setMethod(m); setStep('amount'); }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                >
                  <View style={[styles.methodIconWrap, { backgroundColor: m.color + '18', borderColor: m.color + '40' }]}>
                    <Ionicons name={m.icon} size={24} color={m.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    <Text style={styles.methodDesc}>{m.desc}</Text>
                    {m.ussd && <Text style={{ color: m.color, fontSize: Typography.xs, marginTop: 2 }}>{m.ussd}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}

              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.blue} style={{ marginTop: 1 }} />
                <Text style={styles.infoText}>{t('recharge.infoBox')}</Text>
              </View>
            </>
          )}

          {step === 'amount' && method && (
            <>
              <View style={[styles.selectedMethod, { backgroundColor: method.color + '12', borderColor: method.color + '30' }]}>
                <Ionicons name={method.icon} size={24} color={method.color} />
                <Text style={[styles.methodLabel, { color: method.color }]}>{method.label}</Text>
              </View>

              {/* Numéro MoMo */}
              {method.id !== 'agent' && (
                <View style={styles.phoneRow}>
                  <Text style={styles.phoneLabel}>Numéro {method.label.split(' ')[0]}</Text>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('recharge.amount.phonePlaceholder')}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    autoCapitalize="none"
                    accessibilityLabel={`Numéro ${method?.label?.split(' ')[0] ?? ''}`}
                  />
                </View>
              )}

              <View style={styles.amountWrap}>
                <Text style={styles.amountLabel}>{t('recharge.amount.amountLabel')}</Text>
                <TextInput
                  style={[styles.amountInput, { color: method.color }]}
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  autoFocus
                />
                <Text style={styles.amountCurrency}>{t('common.currency')}</Text>
              </View>

              {IS_SANDBOX && (
                <View style={styles.sandboxBanner}>
                  <Ionicons name="flask-outline" size={14} color={Colors.yellow} />
                  <Text style={styles.sandboxText}>{t('recharge.sandbox.banner')}</Text>
                </View>
              )}

              <View style={styles.quickGrid}>
                {QUICK_AMOUNTS.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[styles.quickBtn, parseInt(amount) === q && { borderColor: method.color, backgroundColor: method.color + '12' }]}
                    onPress={() => setAmount(q.toString())}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={IS_SANDBOX ? `${q} FCFA` : `${q.toLocaleString('fr-FR')} FCFA`}
                  >
                    <Text style={[styles.quickBtnText, parseInt(amount) === q && { color: method.color }]}>
                      {IS_SANDBOX ? q.toString() : `${(q / 1000).toLocaleString('fr-FR')}k`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.limitNote}>
                <Text style={styles.limitText}>
                  {IS_SANDBOX ? t('recharge.limitNote.sandbox') : t('recharge.limitNote.prod')}
                </Text>
              </View>

              {error && <Text style={styles.errorText}>{error}</Text>}

              <Button
                label={amt ? t('recharge.btnRechargeWithAmount', { amount: amt.toLocaleString('fr-FR') }) : t('recharge.btnRecharge')}
                onPress={handleRecharge}
                loading={loading}
                disabled={loading || (IS_SANDBOX ? (amt < 1 || amt > 25) : (amt < 500))}
                fullWidth
              />
            </>
          )}

          {step === 'pending' && (
            <View style={styles.pendingContainer}>
              <View style={styles.pendingIcon}>
                <Ionicons name="hourglass-outline" size={40} color={Colors.yellow} />
              </View>
              <Text style={styles.pendingTitle}>{t('recharge.pending.title')}</Text>
              <Text style={styles.pendingText}>
                {t('recharge.pending.text', { operator: method?.label ?? '' })}
              </Text>
              <Button label={t('recharge.pending.btnClose')} onPress={handleClose} fullWidth style={{ marginTop: Spacing.xl }} />
            </View>
          )}
          </ScrollView>
        </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backLabel: { color: Colors.textMuted, fontSize: Typography.base },
  body: { padding: Spacing.xl, gap: Spacing.md },
  sectionLabel: {
    color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.semibold,
    marginBottom: Spacing.sm,
  },
  methodCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
  },
  methodIconWrap: {
    width: 50, height: 50, borderRadius: BorderRadius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  methodLabel: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  methodDesc: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  selectedMethod: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  amountWrap: { alignItems: 'center', paddingVertical: Spacing.xl },
  amountLabel: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: Spacing.sm },
  amountInput: {
    fontSize: 52, fontWeight: Typography.black,
    textAlign: 'center', minWidth: 200,
  },
  amountCurrency: { color: Colors.textMuted, fontSize: Typography.base, marginTop: 4 },
  quickGrid: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  quickBtn: {
    flex: 1, minWidth: '22%', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm, fontWeight: Typography.medium },
  limitNote: { alignItems: 'center' },
  limitText: { color: Colors.textMuted, fontSize: Typography.xs },
  sandboxBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.yellow + '18', borderWidth: 1, borderColor: Colors.yellow + '50',
    borderRadius: BorderRadius.sm, paddingVertical: 6, paddingHorizontal: Spacing.sm,
  },
  sandboxText: { color: Colors.yellow, fontSize: Typography.xs, fontWeight: Typography.medium },
  phoneRow: { marginBottom: Spacing.md },
  phoneLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginBottom: 6 },
  phoneInput: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
    color: Colors.text, fontSize: Typography.base,
  },
  errorText: { color: Colors.red, fontSize: Typography.sm, textAlign: 'center', marginBottom: Spacing.sm },
  pendingContainer: { alignItems: 'center', padding: Spacing.xl, paddingTop: Spacing.xxl },
  pendingIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.yellow + '20', alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  pendingTitle: { color: Colors.text, fontSize: Typography.xl, fontWeight: Typography.bold, marginBottom: Spacing.md },
  pendingText: { color: Colors.textMuted, fontSize: Typography.base, textAlign: 'center', lineHeight: 22 },
  infoBox: {
    flexDirection: 'row', gap: Spacing.sm,
    backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.blue + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm,
  },
  infoText: { flex: 1, color: Colors.textSoft, fontSize: Typography.xs, lineHeight: 18 },
});
