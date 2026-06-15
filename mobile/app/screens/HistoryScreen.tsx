import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { txMeta } from '../constants/txMeta';
import { Badge, IconButton } from '../components/ui';
import { useStore, Transaction } from '../store/useStore';

type IoniconName = keyof typeof Ionicons.glyphMap;

const FILTERS = ['Tout', 'Reçus', 'Envois', 'Recharges', 'Retraits'];

function buildPdfHtml(
  transactions: ReturnType<typeof useStore.getState>['transactions'],
  filter: string,
  search: string,
) {
  const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const total = transactions.reduce((s, tx) => s + tx.amount, 0);
  const rows = transactions
    .map(
      (tx) => `
    <tr>
      <td>${tx.date}</td>
      <td>${tx.name}</td>
      <td>${txMeta(tx.type).label}</td>
      <td style="color:${tx.amount >= 0 ? '#00C896' : '#FF4D6D'};font-weight:700">
        ${tx.amount >= 0 ? '+' : ''}${fmt(tx.amount)}
      </td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: Arial, sans-serif; margin: 32px; color: #1a1a2e; }
  .logo { font-size: 28px; font-weight: 900; color: #00C896; }
  .logo span { color: #1a1a2e; }
  .meta { margin: 16px 0 24px; color: #555; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #00C896; color: #fff; padding: 8px 12px; text-align: left; }
  td { padding: 8px 12px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #f9f9f9; }
  .total { text-align: right; margin-top: 20px; font-size: 15px; font-weight: 700; }
  .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center; }
</style>
</head>
<body>
  <div class="logo">Cam<span>Wallet</span></div>
  <div class="meta">
    <strong>Relevé de transactions</strong><br/>
    Filtre : ${filter}${search ? ` · Recherche : "${search}"` : ''}<br/>
    Généré le ${dateStr}
  </div>
  <table>
    <thead><tr><th>Date</th><th>Opération</th><th>Type</th><th>Montant</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">Total net : ${total >= 0 ? '+' : ''}${fmt(total)}</div>
  <div class="footer">CamWallet · Document généré automatiquement · Non contractuel</div>
</body>
</html>`;
}

export default function HistoryScreen() {
  const { transactions, historyHasMore, historyLoading, fetchHistoryPage, resetHistory } = useStore();
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  // Chargement initial : réinitialise la pagination et charge la première page.
  useEffect(() => {
    resetHistory();
    fetchHistoryPage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = transactions.filter((tx) => {
    const matchFilter =
      activeFilter === 'Tout' ||
      (activeFilter === 'Envois' && (tx.type === 'sent' || tx.type === 'qr_payment')) ||
      (activeFilter === 'Reçus' && (tx.type === 'received' || tx.type === 'refund')) ||
      (activeFilter === 'Recharges' && tx.type === 'recharge') ||
      (activeFilter === 'Retraits' && tx.type === 'withdrawal');
    const matchSearch = search === '' || tx.name.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const exportPdf = async () => {
    if (filtered.length === 0) {
      Alert.alert('Aucune transaction', 'Aucune transaction à exporter pour ce filtre.');
      return;
    }
    setExporting(true);
    try {
      const html = buildPdfHtml(filtered, activeFilter, search);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exporter le relevé CamWallet',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('PDF généré', `Fichier enregistré : ${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Impossible de générer le PDF');
    } finally {
      setExporting(false);
    }
  };

  const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

  const handleLoadMore = () => {
    const { historyPage, historyHasMore: hasMore, historyLoading: loading } = useStore.getState();
    if (!hasMore || loading) return;
    fetchHistoryPage(historyPage + 1);
  };

  const renderTx = ({ item: tx }: { item: Transaction }) => (
    <Pressable
      style={({ pressed }) => [styles.txRow, pressed && styles.pressed]}
      onPress={() => setSelectedTx(tx)}
      accessibilityRole="button"
      accessibilityLabel={`${txMeta(tx.type).label} ${tx.name}, ${fmt(tx.amount)}`}
    >
      <View style={[styles.txIcon, { backgroundColor: txMeta(tx.type).amountColor + '22' }]}>
        <Ionicons name={txMeta(tx.type).icon as IoniconName} size={20} color={txMeta(tx.type).amountColor} />
      </View>
      <View style={styles.txInfo}>
        <Text style={styles.txName} numberOfLines={1}>{tx.name}</Text>
        <Text style={styles.txDate}>{tx.date}</Text>
      </View>
      <View style={styles.txRight}>
        <Text style={[styles.txAmount, { color: txMeta(tx.type).amountColor }]}>
          {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
        </Text>
        <Badge
          label={txMeta(tx.type).label}
          color={txMeta(tx.type).badgeText}
          bg={txMeta(tx.type).badgeBg}
        />
      </View>
    </Pressable>
  );

  const ListEmpty = () => (
    <View style={styles.empty}>
      <Ionicons name="receipt-outline" size={48} color={Colors.textMuted} />
      <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
    </View>
  );

  const ListFooter = () => (
    <View style={styles.listFooter}>
      {historyLoading ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : !historyHasMore && transactions.length > 0 ? (
        <Text style={styles.listFooterText}>Toutes les transactions chargées</Text>
      ) : null}
      <View style={{ height: 80 }} />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Barre supérieure : recherche + export */}
      <View style={styles.topRow}>
        <View style={[styles.searchRow, { flex: 1 }]}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une transaction…"
          placeholderTextColor={Colors.textMuted}
        />
        {search !== '' && (
          <IconButton
            icon="close"
            onPress={() => setSearch('')}
            accessibilityLabel="Effacer la recherche"
            size={18}
            color={Colors.textMuted}
          />
        )}
        </View>
        <TouchableOpacity
          style={styles.exportBtn}
          onPress={exportPdf}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel="Exporter en PDF"
        >
          {exporting ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <Ionicons name="download-outline" size={18} color={Colors.primary} />
          )}
          <Text style={styles.exportBtnText}>{exporting ? '...' : 'PDF'}</Text>
        </TouchableOpacity>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            style={({ pressed }) => [
              styles.filterChip,
              activeFilter === f && styles.filterChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setActiveFilter(f)}
            accessibilityRole="button"
            accessibilityLabel={`Filtrer : ${f}`}
            accessibilityState={{ selected: activeFilter === f }}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Liste de transactions avec scroll infini */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderTx}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.2}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
      />

      {/* Modale de détail transaction */}
      <Modal
        visible={!!selectedTx}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedTx(null)}
      >
        {selectedTx && (
          <SafeAreaView style={styles.detailSheet} edges={['top']}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>Détail transaction</Text>
              <IconButton icon="close" onPress={() => setSelectedTx(null)} accessibilityLabel="Fermer" />
            </View>

            <ScrollView contentContainerStyle={styles.detailBody}>
              {/* Icône + montant */}
              <View style={styles.detailHero}>
                <View style={[styles.detailIcon, { backgroundColor: txMeta(selectedTx.type).amountColor + '22' }]}>
                  <Ionicons name={txMeta(selectedTx.type).icon as IoniconName} size={32} color={txMeta(selectedTx.type).amountColor} />
                </View>
                <Text style={[styles.detailAmount, { color: txMeta(selectedTx.type).amountColor }]}>
                  {selectedTx.amount > 0 ? '+' : ''}{fmt(selectedTx.amount)}
                </Text>
                <Badge
                  label={txMeta(selectedTx.type).label}
                  color={txMeta(selectedTx.type).badgeText}
                  bg={txMeta(selectedTx.type).badgeBg}
                />
              </View>

              {/* Lignes de détail */}
              {[
                { label: 'Référence', value: selectedTx.ref || '—' },
                { label: 'Opération', value: selectedTx.name },
                { label: 'Date', value: selectedTx.date },
                { label: 'Statut', value: selectedTx.status === 'success' ? 'Effectuée' : selectedTx.status === 'pending' ? 'En cours' : 'Échouée' },
                selectedTx.motif ? { label: 'Motif', value: selectedTx.motif } : null,
              ].filter(Boolean).map((row: any) => (
                <View key={row.label} style={styles.detailRow}>
                  <Text style={styles.detailRowLabel}>{row.label}</Text>
                  <Text style={styles.detailRowValue} selectable>{row.value}</Text>
                </View>
              ))}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginTop: Spacing.lg, marginBottom: 0,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: 44, marginBottom: Spacing.lg,
  },
  exportBtnText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.bold },
  searchInput: { flex: 1, color: Colors.text, fontSize: Typography.base, minHeight: 40 },
  pressed: { opacity: 0.7 },
  filterRow: { marginBottom: Spacing.sm },
  filterContent: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
  },
  filterChip: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 18, height: 36, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: '#64748B', fontSize: Typography.sm, fontWeight: Typography.medium },
  filterTextActive: { color: Colors.white, fontWeight: '700' as const },
  list: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  txIcon: {
    width: 44, height: 44, borderRadius: BorderRadius.md,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  txInfo: { flex: 1, minWidth: 0 },
  txName: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  txDate: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  txRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  txAmount: { fontSize: Typography.base, fontWeight: Typography.bold },
  empty: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base },
  listFooter: { alignItems: 'center', paddingVertical: Spacing.md },
  listFooterText: { color: Colors.textMuted, fontSize: Typography.sm },

  // Modale détail
  detailSheet: { flex: 1, backgroundColor: Colors.surface },
  detailHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  detailTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  detailBody: { padding: Spacing.xl, gap: Spacing.md },
  detailHero: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.md },
  detailIcon: {
    width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center',
  },
  detailAmount: { fontSize: 36, fontWeight: Typography.black },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  detailRowLabel: { color: Colors.textMuted, fontSize: Typography.sm, flex: 1 },
  detailRowValue: { color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.semibold, flex: 2, textAlign: 'right' },
});
