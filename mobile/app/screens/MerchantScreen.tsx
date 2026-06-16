import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Pressable,
  Share,
  Animated,
  Easing,
  AccessibilityInfo,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRLib from 'qrcode';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Skeleton } from '../components/ui';
import { merchantApi, MerchantStatsResponse, MerchantTransaction } from '../../src/lib/api';

const BAR_DAYS_COUNT = 7;
const BAR_FACTORS = [0.6, 0.8, 0.7, 1.0, 0.9, 1.2, 0.5];
const BAR_MAX_H = 60;

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
    <Text style={[styles.statValue, { color }]} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
    {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
  </View>
);

export default function MerchantScreen({ onBack }: MerchantScreenProps) {
  const { t } = useTranslation();
  const BAR_DAYS = t('merchant.chart.days').split(',');
  const [stats, setStats] = useState<MerchantStatsResponse | null>(null);
  const [txs, setTxs] = useState<MerchantTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrAmount, setQrAmount] = useState('');
  const [qrValue, setQrValue] = useState<string | null>(null);

  // Barres du graphique — ratio 0→1, nativeDriver:true (scaleY+translateY, pas height)
  const barAnims = useRef(Array.from({ length: BAR_DAYS_COUNT }, () => new Animated.Value(0))).current;
  const reduceMotionRef = useRef(false);

  React.useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => { reduceMotionRef.current = rm; })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!stats) return;
    const base = stats.week.amount / 7;
    const values = BAR_FACTORS.map((f) => Math.round(base * f));
    const maxVal = Math.max(...values, 1);
    // Ratio minimum 0.067 ≈ 4px visible à BAR_MAX_H=60
    const ratios = values.map((v) => Math.max(0.067, v / maxVal));
    if (reduceMotionRef.current) {
      barAnims.forEach((anim, i) => anim.setValue(ratios[i]));
      return;
    }
    Animated.stagger(50, barAnims.map((anim, i) =>
      Animated.timing(anim, {
        toValue: ratios[i],
        duration: 350,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    )).start();
  }, [stats]);

  // QR code — fondu à chaque nouvelle génération
  const qrAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!qrValue) return;
    if (reduceMotionRef.current) { qrAnim.setValue(1); return; }
    qrAnim.setValue(0);
    Animated.timing(qrAnim, {
      toValue: 1, duration: 220,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, [qrValue]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([merchantApi.getStats(), merchantApi.getTransactions(1, 10)])
      .then(([s, txRes]) => {
        setStats(s);
        setTxs(txRes.data);
        setError(null);
      })
      .catch((e) => setError(e?.response?.data?.message ?? t('common.error')))
      .finally(() => setLoading(false));
  }, []);

  // Chargement au montage
  React.useEffect(() => { load(); }, [load]);

  const generateQr = () => {
    const amount = parseInt(qrAmount.replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      Alert.alert(t('merchant.alertInvalidAmountTitle'), t('merchant.alertInvalidAmountMsg'));
      return;
    }
    // Encode: type:MERCHANT_QR, amount en centimes
    setQrValue(JSON.stringify({ type: 'MERCHANT_QR', amountCentimes: amount * 100 }));
  };

  const handleShareQr = async () => {
    if (!qrValue) {
      Alert.alert(t('merchant.alertNoQrTitle'), t('merchant.alertNoQrMsg'));
      return;
    }
    try {
      await Share.share({
        message: t('merchant.shareMessage') + ' ' + qrValue,
        title: t('merchant.shareTitle'),
      });
    } catch (e: any) {
      if (e?.message !== 'User did not share') {
        Alert.alert(t('merchant.alertShareError'), e?.message ?? '');
      }
    }
  };

  const handlePrintQr = async () => {
    if (!qrValue) return;
    const amountFcfa = parseInt(qrAmount, 10) || 0;
    try {
      // QR généré localement en SVG — aucune donnée ne quitte l'appareil.
      const svg = await QRLib.toString(qrValue, { type: 'svg', width: 220, margin: 2 });
      const svgB64 = btoa(unescape(encodeURIComponent(svg)));
      const qrDataUri = `data:image/svg+xml;base64,${svgB64}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><style>
          body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; padding: 40px; }
          h1 { color: #00C896; font-size: 24px; margin-bottom: 8px; }
          .amount { font-size: 32px; font-weight: bold; color: #0F172A; margin: 16px 0; }
          .qr-container { border: 3px solid #00C896; border-radius: 16px; padding: 20px; margin: 20px 0; }
          img { width: 220px; height: 220px; }
          .footer { color: #64748B; font-size: 12px; margin-top: 24px; text-align: center; }
        </style></head>
        <body>
          <h1>${t('merchant.pdf.title')}</h1>
          <div class="amount">${amountFcfa.toLocaleString('fr-FR')} FCFA</div>
          <div class="qr-container">
            <img src="${qrDataUri}" />
          </div>
          <p class="footer">${t('merchant.pdf.footer')}</p>
        </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('merchant.pdf.dialogTitle') });
      } else {
        await Print.printAsync({ uri });
      }
    } catch (e) {
      Alert.alert(t('merchant.alertShareError'), t('merchant.alertPdfError') ?? '');
    }
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('merchant.a11yBack')}>
          <Ionicons name="arrow-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('merchant.headerTitle')}</Text>
        <TouchableOpacity onPress={load} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('merchant.a11yRefresh')}>
          <Ionicons name="refresh-outline" size={20} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {error && (
          <View style={styles.errorWrap}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn} accessibilityRole="button" accessibilityLabel={t('merchant.a11yRetry')}>
              <Ionicons name="refresh-outline" size={14} color={Colors.red} />
              <Text style={styles.retryText}>{t('merchant.retryText')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading && !stats ? (
          <View style={styles.skeletonWrap}>
            <Skeleton height={120} radius={BorderRadius.xl} style={{ marginHorizontal: Spacing.lg, marginBottom: Spacing.xl }} />
            <View style={{ flexDirection: 'row', marginHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.xl }}>
              <Skeleton height={80} radius={BorderRadius.lg} style={{ flex: 1 }} />
              <Skeleton height={80} radius={BorderRadius.lg} style={{ flex: 1 }} />
              <Skeleton height={80} radius={BorderRadius.lg} style={{ flex: 1 }} />
            </View>
            <Skeleton height={120} radius={BorderRadius.lg} style={{ marginHorizontal: Spacing.lg }} />
          </View>
        ) : (
          <>
            {/* Solde marchand */}
            <View style={styles.balanceCard}>
              <View style={styles.balanceBadge}>
                <Ionicons name="storefront-outline" size={14} color={Colors.primary} />
                <Text style={styles.balanceBadgeText}>{t('merchant.balance_badge')}</Text>
              </View>
              <Text style={styles.balanceLabel}>{t('merchant.balance_label')}</Text>
              <Text style={styles.balanceValue}>
                {stats ? fcfa(stats.balance) : '—'} <Text style={styles.balanceCurrency}>FCFA</Text>
              </Text>
            </View>

            {/* Stats */}
            <Text style={styles.sectionTitle}>{t('merchant.stats.title')}</Text>
            <View style={styles.statsGrid}>
              <StatCard
                label={t('merchant.stats.today')}
                value={stats ? `${fcfa(stats.day.amount)} FCFA` : '—'}
                sub={stats ? `${stats.day.count} ${stats.day.count !== 1 ? t('merchant.stats.operationPlural') : t('merchant.stats.operationSingular')}` : undefined}
              />
              <StatCard
                label={t('merchant.stats.week')}
                value={stats ? `${fcfa(stats.week.amount)} FCFA` : '—'}
                sub={stats ? `${stats.week.count} ${t('merchant.stats.operationPlural')}` : undefined}
                color={Colors.blue}
              />
              <StatCard
                label={t('merchant.stats.month')}
                value={stats ? `${fcfa(stats.month.amount)} FCFA` : '—'}
                sub={stats ? `${stats.month.count} ${t('merchant.stats.operationPlural')}` : undefined}
                color={Colors.yellow}
              />
            </View>

            {/* Alerte solde bas */}
            {stats && stats.balance < 1000000 && stats.balance > 0 && (
              <View style={styles.lowBalanceAlert}>
                <Ionicons name="warning-outline" size={18} color={Colors.yellow} />
                <Text style={styles.lowBalanceText}>
                  {t('merchant.lowBalance', { amount: `${fcfa(stats.balance)} FCFA` })}
                </Text>
              </View>
            )}

            {/* Graphique tendance 7 jours (mini-barres) */}
            {stats && (
              <>
                <Text style={styles.sectionTitle}>{t('merchant.chart.title')}</Text>
                <View style={styles.chartCard} accessibilityLabel={t('merchant.chart.a11y')} accessibilityRole="none">
                  <View style={styles.chartBars}>
                    {BAR_DAYS.map((day, i) => (
                      <View key={i} style={styles.chartBarWrap}>
                        <Animated.View
                          style={[
                            styles.chartBar,
                            {
                              backgroundColor: i === (new Date().getDay() + 6) % 7 ? Colors.primary : Colors.primary + '50',
                              transform: [
                                {
                                  translateY: barAnims[i].interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [BAR_MAX_H / 2, 0],
                                  }),
                                },
                                { scaleY: barAnims[i] },
                              ],
                            },
                          ]}
                        />
                        <Text style={styles.chartDay}>{day}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.chartNote}>{t('merchant.chart.note')}</Text>
                </View>
              </>
            )}

            {/* QR dynamique */}
            <Text style={styles.sectionTitle}>{t('merchant.qr.title')}</Text>
            <View style={styles.qrCard}>
              <Text style={styles.qrHint}>{t('merchant.qr.hint')}</Text>
              <View style={styles.qrRow}>
                <TextInput
                  style={styles.qrInput}
                  value={qrAmount}
                  onChangeText={(v) => {
                    setQrAmount(v.replace(/\D/g, ''));
                    setQrValue(null);
                  }}
                  placeholder={t('merchant.qr.placeholder')}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  accessibilityLabel={t('merchant.qr.placeholder')}
                />
                <TouchableOpacity style={styles.qrGenBtn} onPress={generateQr} accessibilityRole="button" accessibilityLabel={t('merchant.qr.btnGenerate')}>
                  <Ionicons name="qr-code-outline" size={18} color="#fff" />
                  <Text style={styles.qrGenBtnText}>{t('merchant.qr.btnGenerate')}</Text>
                </TouchableOpacity>
              </View>
              {qrValue && (
                <Animated.View style={[styles.qrDisplay, { opacity: qrAnim }]}>
                  <View style={styles.qrBg}>
                    <QRCode value={qrValue} size={180} backgroundColor="#fff" color="#000" />
                  </View>
                  <Text style={styles.qrAmountLabel}>
                    {parseInt(qrAmount, 10).toLocaleString('fr-FR')} FCFA
                  </Text>
                  <Text style={styles.qrSub}>{t('merchant.qr.sub')}</Text>
                  <TouchableOpacity
                    style={styles.shareQrBtn}
                    onPress={handleShareQr}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('merchant.qr.btnShare')}
                  >
                    <Ionicons name="share-outline" size={18} color={Colors.blue} />
                    <Text style={styles.shareQrBtnText}>{t('merchant.qr.btnShare')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.printQrBtn}
                    onPress={handlePrintQr}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={t('merchant.qr.btnPrint')}
                  >
                    <Ionicons name="print-outline" size={18} color={Colors.primary} />
                    <Text style={styles.printQrBtnText}>{t('merchant.qr.btnPrint')}</Text>
                  </TouchableOpacity>
                </Animated.View>
              )}
            </View>

            {/* Dernières transactions */}
            <Text style={styles.sectionTitle}>{t('merchant.txList.title')}</Text>
            {txs.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="receipt-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>{t('merchant.txList.empty')}</Text>
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
                        <Text style={styles.txParty} numberOfLines={1}>{tx.sender.fullName ?? tx.sender.phone}</Text>
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
                        {tx.status === 'COMPLETED' ? t('merchant.txStatus.completed') : t('merchant.txStatus.pending')}
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
    width: 44, height: 44, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  skeletonWrap: { paddingTop: Spacing.lg },
  errorWrap: { margin: Spacing.lg, alignItems: 'center', gap: Spacing.sm },
  errorText: {
    color: Colors.red, textAlign: 'center', width: '100%',
    backgroundColor: Colors.errorBg, padding: Spacing.md, borderRadius: BorderRadius.sm,
  },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  retryText: { color: Colors.red, fontSize: Typography.sm, fontWeight: Typography.semibold },
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
    color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.semibold,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm, marginTop: Spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row', marginHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.xl,
  },
  statCard: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center', gap: 2,
  },
  statValue: { fontSize: Typography.base, fontWeight: Typography.bold, textAlign: 'center' },
  statLabel: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center' },
  statSub: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center' },
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
  qrGenBtnText: { color: Colors.white, fontWeight: Typography.bold, fontSize: Typography.sm },
  qrDisplay: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.sm },
  qrBg: { backgroundColor: Colors.white, padding: 16, borderRadius: BorderRadius.lg },
  qrAmountLabel: { color: Colors.text, fontSize: Typography.xl, fontWeight: Typography.black },
  qrSub: { color: Colors.textMuted, fontSize: Typography.sm },
  txList: { marginHorizontal: Spacing.lg, gap: Spacing.sm, marginBottom: Spacing.md },
  txItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
  },
  txIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
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
  lowBalanceAlert: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.yellow + '15', borderWidth: 1, borderColor: Colors.yellow + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  lowBalanceText: { flex: 1, color: Colors.yellow, fontSize: Typography.sm, lineHeight: 18 },
  chartCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg, gap: Spacing.sm,
  },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 80 },
  chartBarWrap: { flex: 1, alignItems: 'center', gap: 4, justifyContent: 'flex-end' },
  chartBar: { width: '60%', borderRadius: 3, height: BAR_MAX_H },
  chartDay: { color: Colors.textMuted, fontSize: Typography.xs },
  chartNote: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center' },
  shareQrBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.blue + '40',
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
  },
  shareQrBtnText: { color: Colors.blue, fontSize: Typography.sm, fontWeight: Typography.semibold },
  printQrBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  printQrBtnText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
});
