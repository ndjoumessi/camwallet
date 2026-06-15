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

const MAX_REASON = 60;

interface DisputeModalProps {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

// Modale de demande de remboursement (contestation) d'une transaction.
// Motif obligatoire, 60 caractères max, puis confirmation avant envoi.
export default function DisputeModal({ visible, transaction, onClose, onSuccess }: DisputeModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const markDisputed = useStore((s) => s.markDisputed);

  const reset = () => { setReason(''); setLoading(false); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert('Motif requis', 'Veuillez saisir le motif de votre demande de remboursement.');
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
      onSuccess?.('Demande de remboursement envoyée');
      Alert.alert(
        'Demande envoyée',
        'Votre demande de remboursement a été enregistrée. Nous reviendrons vers vous sous 48h.',
      );
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Erreur lors de la demande';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="return-up-back-outline" size={28} color={Colors.yellow} />
          </View>
          <Text style={styles.title}>Demande de remboursement</Text>
          <Text style={styles.desc}>
            Expliquez en quelques mots la raison de votre contestation. Notre équipe l'examinera sous 48h.
          </Text>

          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={(v) => setReason(v.slice(0, MAX_REASON))}
              placeholder="Ex : Paiement effectué par erreur…"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
              maxLength={MAX_REASON}
              autoFocus
              editable={!loading}
              accessibilityLabel="Motif du remboursement"
            />
            <Text style={styles.counter}>{reason.length}/{MAX_REASON}</Text>
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, (loading || !reason.trim()) && { opacity: 0.6 }]}
            onPress={submit}
            disabled={loading || !reason.trim()}
            accessibilityRole="button"
            accessibilityLabel="Envoyer la demande de remboursement"
          >
            <Text style={styles.submitText}>{loading ? 'Envoi…' : 'Envoyer la demande'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={close} disabled={loading} accessibilityRole="button" accessibilityLabel="Annuler">
            <Text style={styles.cancelText}>Annuler</Text>
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
  desc: { color: Colors.textSoft, fontSize: Typography.sm, textAlign: 'center', lineHeight: 20 },
  inputWrap: { width: '100%' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text,
    fontSize: Typography.base, textAlignVertical: 'top', minHeight: 80,
  },
  counter: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'right', marginTop: 4 },
  submitBtn: {
    backgroundColor: Colors.yellow, borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md, width: '100%', alignItems: 'center',
  },
  submitText: { color: '#000', fontWeight: Typography.bold, fontSize: Typography.base },
  cancelText: { color: Colors.textMuted, fontSize: Typography.base, padding: Spacing.sm },
});
