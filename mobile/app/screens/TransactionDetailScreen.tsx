import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { txMeta } from '../constants/txMeta';
import { Badge, IconButton } from '../components/ui';
import { useStore, Transaction } from '../store/useStore';
import DisputeModal from './modals/DisputeModal';

type IoniconName = keyof typeof Ionicons.glyphMap;

const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';


interface TransactionDetailScreenProps {
  transaction: Transaction | null;
  onClose: () => void;
}

// Écran de détail d'une transaction, ouvert depuis l'Accueil, l'Historique ou
// un deep-link de notification. Affiche une timeline, les informations
// complètes, et propose un remboursement pour un P2P complété de moins de 24h.
export default function TransactionDetailScreen({ transaction, onClose }: TransactionDetailScreenProps) {
  const { t } = useTranslation();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const disputedTxIds = useStore((s) => s.disputedTxIds);

  const STATUS_LABEL: Record<Transaction['status'], string> = {
    success: t('txDetail.statusLabel.success'),
    pending: t('txDetail.statusLabel.pending'),
    failed: t('txDetail.statusLabel.failed'),
  };

  const getTimelineSteps = (status: Transaction['status']) => {
    if (status === 'failed') {
      return [
        { label: t('txDetail.timeline.created'), state: 'done' as const },
        { label: t('txDetail.timeline.processing'), state: 'done' as const },
        { label: t('txDetail.timeline.failed'), state: 'failed' as const },
      ];
    }
    if (status === 'pending') {
      return [
        { label: t('txDetail.timeline.created'), state: 'done' as const },
        { label: t('txDetail.timeline.inProgress'), state: 'active' as const },
        { label: t('txDetail.timeline.completed'), state: 'future' as const },
      ];
    }
    return [
      { label: t('txDetail.timeline.created'), state: 'done' as const },
      { label: t('txDetail.timeline.processing'), state: 'done' as const },
      { label: t('txDetail.timeline.completed'), state: 'done' as const },
    ];
  };

  const getParties = (tx: Transaction): { from: string; to: string } => {
    const operator = t('txDetail.party.operator');
    const me = t('txDetail.party.me');
    const other = tx.counterpartyName || tx.counterpartyPhone || '—';
    if (tx.rawType === 'RECHARGE') return { from: operator, to: me };
    if (tx.rawType === 'WITHDRAWAL') return { from: me, to: operator };
    return tx.direction === 'out' ? { from: me, to: other } : { from: other, to: me };
  };

  const tx = transaction;
  const meta = tx ? txMeta(tx.type) : null;

  const alreadyDisputed = tx ? disputedTxIds.includes(tx.id) : false;
  const refundEligible =
    !!tx &&
    tx.rawType === 'P2P' &&
    tx.status === 'success' &&
    Date.now() - new Date(tx.createdAt).getTime() < REFUND_WINDOW_MS;

  const party = tx ? getParties(tx) : { from: '—', to: '—' };

  const rows = tx
    ? [
        { label: t('txDetail.infoRow.reference'), value: tx.ref || '—' },
        { label: t('txDetail.infoRow.amount'), value: `${tx.amount > 0 ? '+' : ''}${fmt(tx.amount)}` },
        ...(tx.fee > 0 ? [{ label: t('txDetail.infoRow.fees'), value: fmt(tx.fee) }] : []),
        { label: t('txDetail.infoRow.sender'), value: party.from },
        { label: t('txDetail.infoRow.recipient'), value: party.to },
        { label: t('txDetail.infoRow.date'), value: tx.date },
        { label: t('txDetail.infoRow.status'), value: STATUS_LABEL[tx.status] },
      ]
    : [];

  return (
    <Modal
      visible={!!tx}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {tx && meta && (
        <SafeAreaView style={styles.sheet} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t('txDetail.headerTitle')}</Text>
            <IconButton icon="close" onPress={onClose} accessibilityLabel={t('txDetail.closeBtnA11y')} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* Hero : icône + montant + badge */}
            <View style={styles.hero}>
              <View style={[styles.heroIcon, { backgroundColor: meta.amountColor + '22' }]}>
                <Ionicons name={meta.icon as IoniconName} size={32} color={meta.amountColor} />
              </View>
              <Text style={[styles.heroAmount, { color: meta.amountColor }]}>
                {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
              </Text>
              <Badge label={meta.label} color={meta.badgeText} bg={meta.badgeBg} />
            </View>

            {/* Timeline */}
            <View style={styles.timeline}>
              <Text style={styles.sectionTitle}>{t('txDetail.timelineTitle')}</Text>
              {getTimelineSteps(tx.status).map((step, i, arr) => {
                const color =
                  step.state === 'failed' ? Colors.red
                  : step.state === 'future' ? Colors.textMuted
                  : step.state === 'active' ? Colors.yellow
                  : Colors.primary;
                const icon: IoniconName =
                  step.state === 'failed' ? 'close-circle'
                  : step.state === 'future' ? 'ellipse-outline'
                  : step.state === 'active' ? 'time' : 'checkmark-circle';
                return (
                  <View key={step.label} style={styles.tlRow}>
                    <View style={styles.tlGutter}>
                      <Ionicons name={icon} size={20} color={color} />
                      {i < arr.length - 1 && (
                        <View style={[styles.tlLine, { backgroundColor: step.state === 'done' ? Colors.primary : Colors.border }]} />
                      )}
                    </View>
                    <Text style={[styles.tlLabel, { color: step.state === 'future' ? Colors.textMuted : Colors.text }]}>
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Lignes d'information */}
            <View style={{ gap: Spacing.sm }}>
              {rows.map((row) => (
                <View key={row.label} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{row.label}</Text>
                  <Text style={styles.infoValue} selectable>{row.value}</Text>
                </View>
              ))}
            </View>

            {/* Motif éventuel */}
            {tx.motif ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('txDetail.infoRow.reason')}</Text>
                <Text style={styles.infoValue} selectable>{tx.motif}</Text>
              </View>
            ) : null}

            {/* Remboursement : P2P complété de moins de 24h */}
            {alreadyDisputed ? (
              <View style={styles.disputedNote}>
                <Ionicons name="hourglass-outline" size={16} color={Colors.yellow} />
                <Text style={styles.disputedNoteText}>{t('txDetail.disputedNote')}</Text>
              </View>
            ) : refundEligible ? (
              <TouchableOpacity
                style={styles.refundBtn}
                onPress={() => setDisputeOpen(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('txDetail.btnRefundA11y')}
              >
                <Ionicons name="return-up-back-outline" size={18} color={Colors.yellow} />
                <Text style={styles.refundBtnText}>{t('txDetail.btnRefund')}</Text>
              </TouchableOpacity>
            ) : null}

            <View style={{ height: 24 }} />
          </ScrollView>

          <DisputeModal
            visible={disputeOpen}
            transaction={tx}
            onClose={() => setDisputeOpen(false)}
          />
        </SafeAreaView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  body: { padding: Spacing.xl, gap: Spacing.lg },
  hero: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.md },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroAmount: { fontSize: 36, fontWeight: Typography.black },
  sectionTitle: {
    color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.semibold,
    marginBottom: Spacing.md,
  },
  timeline: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg,
  },
  tlRow: { flexDirection: 'row', gap: Spacing.md },
  tlGutter: { alignItems: 'center', width: 20 },
  tlLine: { width: 2, flex: 1, marginVertical: 2, minHeight: 16 },
  tlLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, paddingBottom: Spacing.md },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  infoLabel: { color: Colors.textMuted, fontSize: Typography.sm, flex: 1 },
  infoValue: { color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.semibold, flex: 2, textAlign: 'right' },
  refundBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center',
    backgroundColor: Colors.yellow + '15', borderWidth: 1, borderColor: Colors.yellow + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  refundBtnText: { color: Colors.yellow, fontSize: Typography.base, fontWeight: Typography.bold },
  disputedNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'center',
    backgroundColor: Colors.yellow + '12', borderWidth: 1, borderColor: Colors.yellow + '30',
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  disputedNoteText: { color: Colors.yellow, fontSize: Typography.sm, fontWeight: Typography.semibold },
});
