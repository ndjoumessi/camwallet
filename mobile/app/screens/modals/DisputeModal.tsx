import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { disputeApi } from '../../../src/lib/api';
import { useStore, Transaction } from '../../store/useStore';
import { useTranslation } from 'react-i18next';

const MAX_REASON = 60;
const MIN_REASON = 5;

const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

interface DisputeModalProps {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

export default function DisputeModal({ visible, transaction, onClose, onSuccess }: DisputeModalProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const markDisputed = useStore((s) => s.markDisputed);

  const reset = () => { setReason(''); setLoading(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length < MIN_REASON) {
      Alert.alert(t('dispute.alertTooShortTitle'), t('dispute.alertTooShortMsg', { min: MIN_REASON }));
      return;
    }
    if (!transaction) return;
    setLoading(true);
    try {
      await disputeApi.open(transaction.id, trimmed);
      markDisputed(transaction.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onClose();
      onSuccess?.(t('dispute.toastSuccess'));
      Alert.alert(t('dispute.alertSentTitle'), t('dispute.alertSentMsg'));
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('dispute.alertErrorFallback');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('dispute.alertErrorTitle'), Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  };

  const trimmedLen = reason.trim().length;
  const canSubmit = !loading && !!transaction && trimmedLen >= MIN_REASON;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="return-up-back-outline" size={28} color={Colors.yellow} />
          </View>
          <Text style={styles.title}>{t('dispute.title')}</Text>

          {transaction ? (
            <View style={styles.txContext}>
              <Text style={styles.txContextName} numberOfLines={1}>{transaction.name}</Text>
              <Text style={styles.txContextAmount}>{fmt(transaction.amount)}</Text>
            </View>
          ) : null}

          <Text style={styles.desc}>{t('dispute.desc')}</Text>

          {transaction ? (
            <>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={reason}
                  onChangeText={(v) => setReason(v.slice(0, MAX_REASON))}
                  placeholder={t('dispute.inputPlaceholder')}
                  placeholderTextColor={Colors.textMuted}
                  multiline
                  numberOfLines={3}
                  maxLength={MAX_REASON}
                  autoFocus
                  editable={!loading}
                  accessibilityLabel={t('dispute.inputA11y')}
                  accessibilityHint={t('dispute.inputA11yHint', { min: MIN_REASON })}
                />
                <View style={styles.counterRow}>
                  {trimmedLen > 0 && trimmedLen < MIN_REASON && (
                    <Text style={styles.counterHint}>{t('dispute.counterHint', { min: MIN_REASON })}</Text>
                  )}
                  <Text style={[styles.counter, trimmedLen === MAX_REASON && { color: Colors.red }]}>
                    {reason.length}/{MAX_REASON}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && { opacity: 0.5 }]}
                onPress={submit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={t('dispute.btnSubmitA11y')}
              >
                <Text style={styles.submitText}>{loading ? t('dispute.btnSubmitting') : t('dispute.btnSubmit')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.noTxText}>{t('dispute.noTx')}</Text>
          )}

          <TouchableOpacity onPress={close} disabled={loading} accessibilityRole="button" accessibilityLabel={t('dispute.btnCancelA11y')}>
            <Text style={styles.cancelText}>{t('dispute.btnCancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: Colors.overlay,
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.yellow + '40',
    borderRadius: BorderRadius.xl, padding: Spacing.xl, width: '100%', alignItems: 'center', gap: Spacing.md,
  },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.yellow + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black, textAlign: 'center' },
  txContext: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    gap: Spacing.sm,
  },
  txContextName: {
    color: Colors.textSoft, fontSize: Typography.sm, fontWeight: Typography.medium, flex: 1,
  },
  txContextAmount: {
    color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.bold, flexShrink: 0,
  },
  desc: { color: Colors.textSoft, fontSize: Typography.sm, textAlign: 'center', lineHeight: 20 },
  inputWrap: { width: '100%' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text,
    fontSize: Typography.base, textAlignVertical: 'top', minHeight: 80,
  },
  counterRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4,
  },
  counterHint: { color: Colors.yellow, fontSize: Typography.xs, flex: 1 },
  counter: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'right' },
  submitBtn: {
    backgroundColor: Colors.yellow, borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md, width: '100%', alignItems: 'center',
  },
  submitText: { color: Colors.bg, fontWeight: Typography.bold, fontSize: Typography.base },
  cancelText: { color: Colors.textMuted, fontSize: Typography.base, padding: Spacing.sm },
  noTxText: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center' },
});
