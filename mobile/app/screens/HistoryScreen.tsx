import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { txMeta } from '../constants/txMeta';
import { Badge, IconButton } from '../components/ui';
import { useStore, Transaction } from '../store/useStore';

type IoniconName = keyof typeof Ionicons.glyphMap;

const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

type PdfStrings = {
  statementTitle: string; filterLabel: string; generatedOn: string;
  colDate: string; colOperation: string; colType: string; colAmount: string;
  noName: string; netTotal: string; footer: string;
};

function buildPdfHtml(
  transactions: ReturnType<typeof useStore.getState>['transactions'],
  filterLabel: string,
  search: string,
  tr: PdfStrings,
) {
  const total = transactions.reduce((s, tx) => s + tx.amount, 0);
  const rows = transactions
    .map(
      (tx) => `
    <tr>
      <td>${tx.date}</td>
      <td>${tx.name ?? tr.noName}</td>
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
    <strong>${tr.statementTitle}</strong><br/>
    ${tr.filterLabel} ${filterLabel}${search ? ` · "${search}"` : ''}<br/>
    ${tr.generatedOn}
  </div>
  <table>
    <thead><tr><th>${tr.colDate}</th><th>${tr.colOperation}</th><th>${tr.colType}</th><th>${tr.colAmount}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">${tr.netTotal} ${total >= 0 ? '+' : ''}${fmt(total)}</div>
  <div class="footer">${tr.footer}</div>
</body>
</html>`;
}

const ListEmpty = () => {
  const { t } = useTranslation();
  return (
    <View style={styles.empty}>
      <Ionicons name="receipt-outline" size={48} color={Colors.textMuted} />
      <Text style={styles.emptyText}>{t('history.emptyText')}</Text>
    </View>
  );
};

interface ListFooterProps { loading: boolean; hasMore: boolean; total: number; }
const ListFooter = React.memo(({ loading, hasMore, total }: ListFooterProps) => {
  const { t } = useTranslation();
  return (
    <View style={styles.listFooter}>
      {loading ? (
        <ActivityIndicator size="small" color={Colors.primary} />
      ) : !hasMore && total > 0 ? (
        <Text style={styles.listFooterText}>{t('history.footerAllLoaded')}</Text>
      ) : null}
      <View style={{ height: 80 }} />
    </View>
  );
});

export default function HistoryScreen() {
  const { t } = useTranslation();
  const { transactions, historyHasMore, historyLoading, fetchHistoryPage, resetHistory, openTransaction } = useStore();

  const FILTERS = [
    { key: 'all', label: t('history.filters.all') },
    { key: 'received', label: t('history.filters.received') },
    { key: 'sent', label: t('history.filters.sent') },
    { key: 'recharge', label: t('history.filters.recharge') },
    { key: 'withdrawal', label: t('history.filters.withdrawals') },
  ];

  const [activeFilter, setActiveFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    resetHistory();
    fetchHistoryPage(1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => transactions.filter((tx) => {
    const matchFilter =
      activeFilter === 'all' ||
      (activeFilter === 'sent' && (tx.type === 'sent' || tx.type === 'qr_payment')) ||
      (activeFilter === 'received' && (tx.type === 'received' || tx.type === 'refund')) ||
      (activeFilter === 'recharge' && tx.type === 'recharge') ||
      (activeFilter === 'withdrawal' && tx.type === 'withdrawal');
    const matchSearch = search === '' || (tx.name ?? '').toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  }), [transactions, activeFilter, search]);

  const exportPdf = async () => {
    if (filtered.length === 0) {
      Alert.alert(t('history.alertNoTxTitle'), t('history.alertNoTxMsg'));
      return;
    }
    setExporting(true);
    try {
      const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      const activeLabel = FILTERS.find((f) => f.key === activeFilter)?.label ?? activeFilter;
      const tr: PdfStrings = {
        statementTitle: t('history.pdf.statementTitle'),
        filterLabel: t('history.pdf.filterLabel'),
        generatedOn: t('history.pdf.generatedOn', { date: dateStr }),
        colDate: t('history.pdf.colDate'),
        colOperation: t('history.pdf.colOperation'),
        colType: t('history.pdf.colType'),
        colAmount: t('history.pdf.colAmount'),
        noName: t('history.pdf.noName'),
        netTotal: t('history.pdf.netTotal'),
        footer: t('history.pdf.footer'),
      };
      const html = buildPdfHtml(filtered, activeLabel, search, tr);
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: t('history.pdf.dialogTitle'),
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert(t('history.alertPdfTitle'), t('history.alertPdfMsg', { uri }));
      }
    } catch (e: any) {
      Alert.alert(t('history.alertErrorTitle'), e?.message ?? t('history.alertErrorMsg'));
    } finally {
      setExporting(false);
    }
  };

  const handleLoadMore = useCallback(() => {
    const { historyPage, historyHasMore: hasMore, historyLoading: loading } = useStore.getState();
    if (!hasMore || loading) return;
    fetchHistoryPage(historyPage + 1);
  }, [fetchHistoryPage]);

  const keyExtractor = useCallback((item: Transaction) => item.id, []);

  const renderTx = useCallback(({ item: tx }: { item: Transaction }) => (
    <Pressable
      style={({ pressed }) => [styles.txRow, pressed && styles.pressed]}
      onPress={() => openTransaction(tx)}
      accessibilityRole="button"
      accessibilityLabel={`${txMeta(tx.type).label} ${tx.name ?? t('common.unnamed')}, ${fmt(tx.amount)}`}
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
  ), [openTransaction]);

  const listFooter = useMemo(() => (
    <ListFooter loading={historyLoading} hasMore={historyHasMore} total={transactions.length} />
  ), [historyLoading, historyHasMore, transactions.length]);

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
          placeholder={t('history.search.placeholder')}
          placeholderTextColor={Colors.textMuted}
          accessibilityLabel={t('history.search.a11yLabel')}
          autoCorrect={false}
        />
        {search !== '' && (
          <IconButton
            icon="close"
            onPress={() => setSearch('')}
            accessibilityLabel={t('history.search.a11yClear')}
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
          accessibilityLabel={t('history.export.a11y')}
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
      <View style={styles.filterWrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={({ pressed }) => [
              styles.filterChip,
              activeFilter === f.key && styles.filterChipActive,
              pressed && styles.pressed,
            ]}
            onPress={() => setActiveFilter(f.key)}
            accessibilityRole="button"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: activeFilter === f.key }}
          >
            <Text style={[styles.filterText, activeFilter === f.key && styles.filterTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      </View>

      {/* Liste de transactions avec scroll infini */}
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderTx}
        style={styles.flatList}
        contentContainerStyle={filtered.length === 0 ? styles.listEmpty : styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.2}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={() => listFooter}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={10}
        removeClippedSubviews
      />
      {/* Le détail transaction est rendu globalement (app/index.tsx) via le store. */}
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
  filterWrapper: { overflow: 'visible', minHeight: 52, marginBottom: Spacing.sm },
  filterRow: { overflow: 'visible' },
  filterContent: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  filterChip: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 18, minHeight: 44, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.medium },
  filterTextActive: { color: Colors.white, fontWeight: Typography.bold },
  flatList: { flex: 1 },
  list: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  listEmpty: { flexGrow: 1, paddingHorizontal: Spacing.lg },
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: Spacing.xxl, gap: Spacing.md },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base },
  listFooter: { alignItems: 'center', paddingVertical: Spacing.md },
  listFooterText: { color: Colors.textMuted, fontSize: Typography.sm },
});
