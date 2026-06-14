import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { useStore } from '../store/useStore';

const FILTERS = ['Tout', 'Envois', 'Reçus', 'Recharges', 'Retraits'];

export default function HistoryScreen() {
  const { transactions } = useStore();
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [search, setSearch] = useState('');

  const txColor = (type: string) =>
    type === 'received' || type === 'recharge' ? Colors.primary : Colors.red;

  const txIcon = (type: string) =>
    type === 'received' ? '↓' : type === 'recharge' ? '⚡' : type === 'withdrawal' ? '🏧' : '↑';

  const txTypeLabel = (type: string) =>
    ({ received: 'Reçu', sent: 'Envoyé', recharge: 'Recharge', withdrawal: 'Retrait' }[type] ?? type);

  const filtered = transactions.filter((tx) => {
    const matchFilter =
      activeFilter === 'Tout' ||
      (activeFilter === 'Envois' && tx.type === 'sent') ||
      (activeFilter === 'Reçus' && tx.type === 'received') ||
      (activeFilter === 'Recharges' && tx.type === 'recharge') ||
      (activeFilter === 'Retraits' && tx.type === 'withdrawal');
    const matchSearch = search === '' || tx.name.toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const fmt = (n: number) => Math.abs(n).toLocaleString('fr-FR') + ' FCFA';

  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher une transaction…"
          placeholderTextColor={Colors.textMuted}
        />
        {search !== '' && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Text style={{ color: Colors.textMuted }}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={{ gap: Spacing.sm, paddingHorizontal: Spacing.lg }}
      >
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
            onPress={() => setActiveFilter(f)}
          >
            <Text style={[styles.filterText, activeFilter === f && styles.filterTextActive]}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Transactions list */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
          </View>
        ) : (
          filtered.map((tx) => (
            <TouchableOpacity key={tx.id} style={styles.txRow} activeOpacity={0.7}>
              <View style={[styles.txIcon, { backgroundColor: txColor(tx.type) + '18' }]}>
                <Text style={[styles.txIconText, { color: txColor(tx.type) }]}>{txIcon(tx.type)}</Text>
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txName} numberOfLines={1}>{tx.name}</Text>
                <Text style={styles.txDate}>{tx.date}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: txColor(tx.type) }]}>
                  {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                </Text>
                <View style={[styles.txStatus, { backgroundColor: Colors.successBg }]}>
                  <Text style={[styles.txStatusText, { color: Colors.primary }]}>
                    {txTypeLabel(tx.type)}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, margin: Spacing.lg,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, color: Colors.text, fontSize: Typography.base, minHeight: 40 },
  filterRow: { marginBottom: Spacing.sm },
  filterChip: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.full, paddingVertical: 6, paddingHorizontal: Spacing.lg,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { color: Colors.textSoft, fontSize: Typography.sm, fontWeight: Typography.medium },
  filterTextActive: { color: Colors.white, fontWeight: Typography.bold },
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
  txIconText: { fontSize: 20, fontWeight: Typography.bold },
  txInfo: { flex: 1, minWidth: 0 },
  txName: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  txDate: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  txRight: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  txAmount: { fontSize: Typography.base, fontWeight: Typography.bold },
  txStatus: {
    borderRadius: BorderRadius.full, paddingHorizontal: 8, paddingVertical: 2,
  },
  txStatusText: { fontSize: Typography.xs, fontWeight: Typography.medium },
  empty: { alignItems: 'center', paddingTop: 80, gap: Spacing.md },
  emptyIcon: { fontSize: 48 },
  emptyText: { color: Colors.textMuted, fontSize: Typography.base },
});
