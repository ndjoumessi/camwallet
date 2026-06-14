import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { IconButton } from '../components/ui';
import { useStore } from '../store/useStore';

type IoniconName = keyof typeof Ionicons.glyphMap;

const FILTERS = ['Tout', 'Envois', 'Reçus', 'Recharges', 'Retraits'];

export default function HistoryScreen() {
  const { transactions } = useStore();
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [search, setSearch] = useState('');

  const txColor = (type: string) =>
    type === 'received' || type === 'recharge'
      ? Colors.primary
      : type === 'withdrawal'
      ? Colors.orange
      : Colors.textSoft;

  const txBadge = (type: string) => {
    if (type === 'received' || type === 'recharge')
      return { bg: Colors.successBg, text: Colors.primary };
    if (type === 'withdrawal')
      return { bg: Colors.orangeBg, text: Colors.orange };
    return { bg: Colors.surface, text: Colors.textSoft };
  };

  const txIcon = (type: string): IoniconName =>
    type === 'received' ? 'arrow-down' : type === 'recharge' ? 'flash' : type === 'withdrawal' ? 'cash-outline' : 'arrow-up';

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

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={{ gap: Spacing.sm, paddingHorizontal: Spacing.lg }}
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

      {/* Transactions list */}
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Aucune transaction trouvée</Text>
          </View>
        ) : (
          filtered.map((tx) => (
            <Pressable
              key={tx.id}
              style={({ pressed }) => [styles.txRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${txTypeLabel(tx.type)} ${tx.name}, ${fmt(tx.amount)}`}
            >
              <View style={[styles.txIcon, { backgroundColor: txColor(tx.type) + '18' }]}>
                <Ionicons name={txIcon(tx.type)} size={20} color={txColor(tx.type)} />
              </View>
              <View style={styles.txInfo}>
                <Text style={styles.txName} numberOfLines={1}>{tx.name}</Text>
                <Text style={styles.txDate}>{tx.date}</Text>
              </View>
              <View style={styles.txRight}>
                <Text style={[styles.txAmount, { color: txColor(tx.type) }]}>
                  {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                </Text>
                <View style={[styles.txStatus, { backgroundColor: txBadge(tx.type).bg }]}>
                  <Text style={[styles.txStatusText, { color: txBadge(tx.type).text }]}>
                    {txTypeLabel(tx.type)}
                  </Text>
                </View>
              </View>
            </Pressable>
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
  searchInput: { flex: 1, color: Colors.text, fontSize: Typography.base, minHeight: 40 },
  pressed: { opacity: 0.7 },
  filterRow: { marginBottom: Spacing.sm },
  filterChip: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.full, height: 36, paddingHorizontal: Spacing.lg,
    alignItems: 'center', justifyContent: 'center',
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
  emptyText: { color: Colors.textMuted, fontSize: Typography.base },
});
