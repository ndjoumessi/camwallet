import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { merchantApi, MerchantStatsResponse, MerchantTransaction } from '../../src/lib/api';

interface MerchantScreenProps {
  onBack: () => void;
}

const fcfa = (centimes: number) => Math.round(centimes / 100).toLocaleString('fr-FR');

const StatCard = ({
  label,
  value,
  sub,
  color = Colors.primary,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) => (
  <View style={styles.statCard}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
    {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
  </View>
);

export default function MerchantScreen({ onBack }: MerchantScreenProps) {
  const [stats, setStats] = useState<MerchantStatsResponse | null>(null);
  const [txs, setTxs] = useState<MerchantTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrAmount, setQrAmount] = useState('');
  const [qrValue, setQrValue] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([merchantApi.getStats(), merchantApi.getTransactions(1, 10)])
      .then(([s, t]) => {
        setStats(s);
        setTxs(t.data);
        setError(null);
      })
      .catch((e) => setError(e?.response?.data?.message ?? 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  // Chargement au montage
  React.useEffect(() => { load(); }, [load]);

  const generateQr = () => {
    const amount = parseInt(qrAmount.replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      Alert.alert('Montant invalide', 'Saisissez un montant en FCFA supérieur à 0.');
      return;
    }
    // Encode: type:MERCHANT_QR, amount en centimes
    setQrValue(JSON.stringify({ type: 'MERCHANT_QR', amountCentimes: amount * 100 }));
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Retour">
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Tableau de bord marchand</Text>
        <TouchableOpacity onPress={load} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Actualiser">
          <Ionicons name="refresh-outline" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {error && <Text style={styles.errorText}>{error}</Text>}

        {loading && !stats ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={styles.loadingText}>Chargement...</Text>
          </View>
        ) : (
          <>
            {/* Solde marchand */}
            <View style={styles.balanceCard}>
              <View style={styles.balanceBadge}>
                <Ionicons name="storefront-outline" size={14} color={Colors.primary} />
                <Text style={styles.balanceBadgeText}>Marchand</Text>
              </View>
              <Text style={styles.balanceLabel}>Solde du compte marchand</Text>
              <Text style={styles.balanceValue}>
                {stats ? fcfa(stats.balance) : '—'} <Text style={styles.balanceCurrency}>FCFA</Text>
              </Text>
            </View>

            {/* Stats */}
            <Text style={styles.sectionTitle}>Chiffre d'affaires</Text>
            <View style={styles.statsGrid}>
              <StatCard
                label="Aujourd'hui"
                value={stats ? `${fcfa(stats.day.amount)} FCFA` : '—'}
                sub={stats ? `${stats.day.count} opération${stats.day.count !== 1 ? 's' : ''}` : undefined}
              />
              <StatCard
                label="Cette semaine"
                value={stats ? `${fcfa(stats.week.amount)} FCFA` : '—'}
                sub={stats ? `${stats.week.count} opérations` : undefined}
                color={Colors.blue}
              />
              <StatCard
                label="Ce mois"
                value={stats ? `${fcfa(stats.month.amount)} FCFA` : '—'}
                sub={stats ? `${stats.month.count} opérations` : undefined}
                color={Colors.yellow}
              />
            </View>

            {/* QR dynamique */}
            <Text style={styles.sectionTitle}>QR code par montant</Text>
            <View style={styles.qrCard}>
              <Text style={styles.qrHint}>Générez un QR pré-rempli avec le montant exact de la transaction.</Text>
              <View style={styles.qrRow}>
                <TextInput
                  style={styles.qrInput}
                  value={qrAmount}
                  onChangeText={(v) => {
                    setQrAmount(v.replace(/\D/g, ''));
                    setQrValue(null);
                  }}
                  placeholder="Montant en FCFA"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  accessibilityLabel="Montant en FCFA pour le QR"
                />
                <TouchableOpacity style={styles.qrGenBtn} onPress={generateQr} accessibilityRole="button" accessibilityLabel="Générer le QR">
                  <Ionicons name="qr-code-outline" size={18} color="#fff" />
                  <Text style={styles.qrGenBtnText}>Générer</Text>
                </TouchableOpacity>
              </View>
              {qrValue && (
                <View style={styles.qrDisplay}>
                  <View style={styles.qrBg}>
                    <QRCode value={qrValue} size={180} backgroundColor="#fff" color="#000" />
                  </View>
                  <Text style={styles.qrAmountLabel}>
                    {parseInt(qrAmount, 10).toLocaleString('fr-FR')} FCFA
                  </Text>
                  <Text style={styles.qrSub}>Faites scanner par le client</Text>
                </View>
              )}
            </View>

            {/* Dernières transactions */}
            <Text style={styles.sectionTitle}>Dernières transactions reçues</Text>
            {txs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="receipt-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>Aucune transaction pour l'instant</Text>
              </View>
            ) : (
              <View style={styles.txList}>
                {txs.map((tx) => (
                  <View key={tx.id} style={styles.txItem}>
                    <View style={[styles.txIcon, { backgroundColor: Colors.primaryLight }]}>
                      <Ionicons name="arrow-down-circle-outline" size={20} color={Colors.primary} />
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txAmount}>+{fcfa(tx.amount)} FCFA</Text>
                      {tx.sender && (
                        <Text style={styles.txParty}>{tx.sender.fullName ?? tx.sender.phone}</Text>
                      )}
                      <Text style={styles.txDate}>
                        {new Date(tx.createdAt).toLocaleDateString('fr-FR', {
                          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                        })}
                      </Text>
                    </View>
                    <View style={[styles.txStatus, tx.status === 'COMPLETED'
                      ? styles.txStatusOk : styles.txStatusPending]}>
                      <Text style={[styles.txStatusText, tx.status === 'COMPLETED'
                        ? styles.txStatusTextOk : styles.txStatusTextPending]}>
                        {tx.status === 'COMPLETED' ? 'Reçu' : 'En attente'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  loadingWrap: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  loadingText: { color: Colors.textMuted, fontSize: Typography.base },
  errorText: {
    color: Colors.red, textAlign: 'center', margin: Spacing.lg,
    backgroundColor: Colors.errorBg, padding: Spacing.md, borderRadius: BorderRadius.sm,
  },
  balanceCard: {
    margin: Spacing.lg, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.primary + '30',
    borderRadius: BorderRadius.xl, padding: Spacing.xl, alignItems: 'center', gap: Spacing.sm,
  },
  balanceBadge: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: Colors.primaryLight, paddingHorizontal: Spacing.md, paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  balanceBadgeText: { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.bold },
  balanceLabel: { color: Colors.textMuted, fontSize: Typography.sm },
  balanceValue: { color: Colors.text, fontSize: Typography.display, fontWeight: Typography.black },
  balanceCurrency: { color: Colors.textMuted, fontSize: Typography.xl, fontWeight: Typography.regular },
  sectionTitle: {
    color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold,
    letterSpacing: 1, textTransform: 'uppercase',
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, marginTop: Spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row', marginHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.xl,
  },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: Typography.sm, fontWeight: Typography.black, textAlign: 'center' },
  statLabel: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center' },
  statSub: { color: Colors.textMuted, fontSize: 9, textAlign: 'center' },
  qrCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg, gap: Spacing.md,
  },
  qrHint: { color: Colors.textSoft, fontSize: Typography.sm },
  qrRow: { flexDirection: 'row', gap: Spacing.sm },
  qrInput: {
    flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text, fontSize: Typography.base,
  },
  qrGenBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: Colors.primary, borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  qrGenBtnText: { color: '#fff', fontWeight: Typography.bold, fontSize: Typography.sm },
  qrDisplay: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  qrBg: { backgroundColor: '#fff', padding: 16, borderRadius: BorderRadius.lg },
  qrAmountLabel: { color: Colors.text, fontSize: Typography.xl, fontWeight: Typography.black },
  qrSub: { color: Colors.textMuted, fontSize: Typography.sm },
  txList: { marginHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.md },
  txItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
  },
  txIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1, gap: 2 },
  txAmount: { color: Colors.primary, fontSize: Typography.base, fontWeight: Typography.bold },
  txParty: { color: Colors.textSoft, fontSize: Typography.sm },
  txDate: { color: Colors.textMuted, fontSize: Typography.xs },
  txStatus: { paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  txStatusOk: { backgroundColor: Colors.successBg },
  txStatusPending: { backgroundColor: Colors.warningBg },
  txStatusText: { fontSize: Typography.xs, fontWeight: Typography.semibold },
  txStatusTextOk: { color: Colors.success },
  txStatusTextPending: { color: Colors.yellow },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base },
});
