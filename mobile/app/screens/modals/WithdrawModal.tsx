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

interface WithdrawModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const toCentimes = (fcfa: number) => Math.round(fcfa * 100);

export default function WithdrawModal({ visible, onClose, onSuccess }: WithdrawModalProps) {
  const { user, fetchBalance, dailyLimit } = useStore();
  const { t } = useTranslation();

  const OPERATORS = [
    { id: 'mtn', icon: 'phone-portrait-outline' as const, label: t('withdraw.operator.mtnLabel'), color: Colors.mtn, ussd: '*126#' },
    { id: 'orange', icon: 'ellipse' as const, label: t('withdraw.operator.orangeLabel'), color: Colors.orange, ussd: '*144#' },
  ];

  const [step, setStep] = useState<'operator' | 'amount' | 'pending'>('operator');
  const [operator, setOperator] = useState<typeof OPERATORS[0] | null>(null);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && user.phone) setPhone(user.phone);
  }, [visible, user.phone]);

  const reset = () => {
    setStep('operator');
    setOperator(null);
    setPhone(user.phone || '');
    setAmount('');
    setError(null);
  };
  const handleClose = () => { reset(); onClose(); };

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

  const handleWithdraw = async () => {
    const amt = parseInt(amount);
    if (!amt || !operator) return;
    const op: MobileOperator = operator.id === 'orange' ? 'ORANGE_MONEY' : 'MTN_MOMO';
    setLoading(true);
    setError(null);
    try {
      await walletApi.withdraw(toCentimes(amt), op, phone || undefined);
      await fetchBalance(); // le solde est débité immédiatement
      setStep('pending');
      onSuccess(t('withdraw.toastSuccess', { amount: amt.toLocaleString('fr-FR') }));
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('withdraw.errorFallback');
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
            <Text style={styles.headerTitle}>{t('withdraw.headerTitle')}</Text>
            <IconButton icon="close" onPress={handleClose} accessibilityLabel={t('withdraw.closeBtnA11y')} />
          </View>

          {step !== 'operator' && step !== 'pending' && (
            <View style={styles.backRow}>
              <IconButton
                icon="arrow-back"
                onPress={() => setStep('operator')}
                accessibilityLabel={t('withdraw.backA11y')}
                size={20}
              />
              <Text style={styles.backLabel}>{t('withdraw.backLabel')}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {step === 'operator' && (
              <>
                <Text style={styles.sectionLabel}>{t('withdraw.operator.sectionLabel')}</Text>
                {OPERATORS.map((op) => (
                  <TouchableOpacity
                    key={op.id}
                    style={styles.opCard}
                    onPress={() => { setOperator(op); setStep('amount'); }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={op.label}
                  >
                    <View style={[styles.opIconWrap, { backgroundColor: op.color + '18', borderColor: op.color + '40' }]}>
                      <Ionicons name={op.icon} size={24} color={op.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.opLabel}>{op.label}</Text>
                      <Text style={styles.opUssd}>{op.ussd}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}

                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color={Colors.blue} style={{ marginTop: 1 }} />
                  <Text style={styles.infoText}>{t('withdraw.infoBox')}</Text>
                </View>
              </>
            )}

            {step === 'amount' && operator && (
              <>
                <View style={[styles.selectedOp, { backgroundColor: operator.color + '12', borderColor: operator.color + '30' }]}>
                  <Ionicons name={operator.icon} size={24} color={operator.color} />
                  <Text style={[styles.opLabel, { color: operator.color }]}>{operator.label}</Text>
                </View>

                {/* Numéro de réception */}
                <View style={styles.phoneRow}>
                  <Text style={styles.phoneLabel}>{t('withdraw.amount.phoneLabel')}</Text>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('withdraw.amount.phonePlaceholder')}
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                    autoCorrect={false}
                    autoCapitalize="none"
                    accessibilityLabel={`${t('withdraw.amount.phoneLabel')} ${operator?.label ?? ''}`}
                  />
                </View>

                {/* Montant */}
                <View style={styles.amountWrap}>
                  <Text style={styles.amountLabel}>{t('withdraw.amount.amountLabel')}</Text>
                  <TextInput
                    style={[styles.amountInput, { color: operator.color }]}
                    value={amount}
                    onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
                    placeholder="0"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    autoFocus
                    accessibilityLabel={t('withdraw.amount.amountA11y')}
                  />
                  <Text style={styles.amountCurrency}>{t('common.currency')}</Text>
                </View>

                {/* Montants rapides */}
                <View style={styles.quickGrid}>
                  {[5000, 10000, 25000, 50000].map((q) => (
                    <TouchableOpacity
                      key={q}
                      style={[styles.quickBtn, parseInt(amount) === q && { borderColor: operator.color, backgroundColor: operator.color + '12' }]}
                      onPress={() => setAmount(q.toString())}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${q.toLocaleString('fr-FR')} FCFA`}
                    >
                      <Text style={[styles.quickBtnText, parseInt(amount) === q && { color: operator.color }]}>
                        {(q / 1000).toLocaleString('fr-FR')}k
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>


                <View style={styles.limitNote}>
                  <Text style={styles.limitText}>{t('withdraw.limitNote')}</Text>
                  {dailyLimit > 0 && (
                    <Text style={styles.limitText}>
                      {t('withdraw.dailyLimit', { amount: dailyLimit.toLocaleString('fr-FR') })}
                    </Text>
                  )}
                </View>

                {error && <Text style={styles.errorText}>{error}</Text>}

                <Button
                  label={amt ? t('withdraw.btnWithdrawWithAmount', { amount: amt.toLocaleString('fr-FR') }) : t('withdraw.btnWithdraw')}
                  onPress={handleWithdraw}
                  loading={loading}
                  disabled={loading || amt < 500}
                  fullWidth
                />
              </>
            )}

            {step === 'pending' && (
              <View style={styles.pendingContainer}>
                <View style={styles.pendingIcon}>
                  <Ionicons name="checkmark-circle-outline" size={40} color={Colors.primary} />
                </View>
                <Text style={styles.pendingTitle}>{t('withdraw.pending.title')}</Text>
                <Text style={styles.pendingText}>
                  {t('withdraw.pending.text', { operator: operator?.label ?? '' })}
                </Text>
                <Button label={t('withdraw.pending.btnClose')} onPress={handleClose} fullWidth style={{ marginTop: Spacing.xl }} />
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
  opCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
  },
  opIconWrap: {
    width: 50, height: 50, borderRadius: BorderRadius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  opLabel: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  opUssd: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  selectedOp: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  phoneRow: {},
  phoneLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginBottom: 6 },
  phoneInput: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
    color: Colors.text, fontSize: Typography.base,
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
  errorText: { color: Colors.red, fontSize: Typography.sm, textAlign: 'center' },
  infoBox: {
    flexDirection: 'row', gap: Spacing.sm,
    backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.blue + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm,
  },
  infoText: { flex: 1, color: Colors.textSoft, fontSize: Typography.xs, lineHeight: 18 },
  pendingContainer: { alignItems: 'center', padding: Spacing.xl, paddingTop: Spacing.xxl },
  pendingIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.successBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  pendingTitle: { color: Colors.text, fontSize: Typography.xl, fontWeight: Typography.bold, marginBottom: Spacing.md },
  pendingText: { color: Colors.textMuted, fontSize: Typography.base, textAlign: 'center', lineHeight: 22 },
});
