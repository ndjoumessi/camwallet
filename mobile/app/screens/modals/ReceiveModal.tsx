import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Share,
  ScrollView,
  Animated,
  TextInput,
  AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Button, IconButton } from '../../components/ui';
import { useStore } from '../../store/useStore';

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
}

const formatPhone = (phone: string) => (phone.startsWith('+') ? phone : `+237 ${phone}`);

export default function ReceiveModal({ visible, onClose }: ReceiveModalProps) {
  const { user } = useStore();
  const [activeTab, setActiveTab] = useState<'static' | 'dynamic'>('static');
  const [dynamicAmount, setDynamicAmount] = useState('');
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // Micro-animation d'entrée (translateY + opacité) déclenchée à l'ouverture.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        enter.setValue(1);
      } else {
        Animated.spring(enter, {
          toValue: 1,
          damping: Animation.spring.damping,
          stiffness: Animation.spring.stiffness,
          useNativeDriver: true,
        }).start();
      }
    } else {
      enter.setValue(0);
    }
  }, [visible, reduceMotion, enter]);
  const animStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  };

  const rawPhone = (user?.phone ?? '').replace(/\s/g, '');
  const displayPhone = formatPhone(user?.phone ?? '');
  const qrValue = `camwallet://pay?to=${rawPhone}&name=${encodeURIComponent(user?.name ?? '')}${dynamicAmount ? `&amount=${dynamicAmount}` : ''}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Payez-moi via CamWallet\n${displayPhone}\nRéférence: ${rawPhone}`,
        title: 'CamWallet — Mon QR de paiement',
      });
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="none" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <Animated.View style={[styles.flex, animStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Recevoir de l'argent</Text>
            <IconButton icon="close" onPress={onClose} accessibilityLabel="Fermer" />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
          {/* Tabs */}
          <View style={styles.tabBar}>
            {(['static', 'dynamic'] as const).map((tab) => {
              const active = activeTab === tab;
              const label = tab === 'static' ? 'QR Statique' : 'QR Dynamique';
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.7}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                >
                  <Ionicons
                    name={tab === 'static' ? 'lock-closed-outline' : 'flash'}
                    size={14}
                    color={active ? Colors.white : Colors.textMuted}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            <View style={styles.qrWrap}>
              <QRCode
                value={qrValue}
                size={200}
                color="#0A0F1E"
                backgroundColor="white"
                logo={undefined}
              />
              {/* Center badge */}
              <View style={styles.qrCenter}>
                <Text style={styles.qrCenterText}>₩</Text>
              </View>
            </View>
          </View>

          {/* User info */}
          <View style={styles.infoCard}>
            <Text style={styles.userName}>{user?.name ?? '—'}</Text>
            <Text style={styles.userPhone}>{displayPhone || '—'}</Text>
            {activeTab === 'static' && (
              <Text style={styles.infoNote}>Ce QR code est permanent. Partagez-le librement.</Text>
            )}
          </View>

          {/* Dynamic amount */}
          {activeTab === 'dynamic' && (
            <View style={styles.dynamicWrap}>
              <Text style={styles.dynamicLabel}>Montant spécifique (optionnel)</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.dynamicInput}
                  value={dynamicAmount}
                  onChangeText={(v) => setDynamicAmount(v.replace(/\D/g, ''))}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  autoCorrect={false}
                  accessibilityLabel="Montant à encoder dans le QR code"
                />
                <Text style={styles.currency}>FCFA</Text>
              </View>
              <Text style={styles.dynamicNote}>
                Le QR dynamique expire dans 15 minutes et inclut le montant exact.
              </Text>
            </View>
          )}

          {/* Quick amounts for dynamic */}
          {activeTab === 'dynamic' && (
            <View style={styles.quickAmounts}>
              {[500, 1000, 2000, 5000].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.quickBtn, dynamicAmount === q.toString() && styles.quickBtnActive]}
                  onPress={() => setDynamicAmount(q.toString())}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${q.toLocaleString('fr-FR')} FCFA`}
                >
                  <Text style={[styles.quickBtnText, dynamicAmount === q.toString() && styles.quickBtnTextActive]}>
                    {q < 1000 ? `${q}` : `${(q / 1000).toLocaleString('fr-FR')}k`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Actions */}
          <Button label="Partager mon QR Code" icon="share-outline" onPress={handleShare} variant="secondary" fullWidth style={{ marginBottom: Spacing.md }} />
          <Button label="Fermer" onPress={onClose} variant="ghost" fullWidth />
          </ScrollView>
        </Animated.View>
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
  body: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.xl },
  tabBar: {
    flexDirection: 'row', backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: 4, width: '100%',
  },
  tab: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: BorderRadius.sm, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.medium },
  tabTextActive: { color: Colors.white, fontWeight: Typography.bold },
  qrContainer: {
    alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xxl,
    backgroundColor: Colors.card, borderRadius: BorderRadius.xxl,
    borderWidth: 1, borderColor: Colors.border,
    width: '100%',
  },
  qrWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  qrCenter: {
    position: 'absolute',
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  qrCenterText: { color: Colors.white, fontSize: 18, fontWeight: Typography.bold },
  infoCard: { alignItems: 'center', gap: 4 },
  userName: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  userPhone: { color: Colors.textMuted, fontSize: Typography.base },
  infoNote: { color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center', marginTop: Spacing.sm },
  dynamicWrap: { width: '100%' },
  dynamicLabel: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: Spacing.sm },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md,
  },
  dynamicInput: {
    flex: 1,
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.text,
    textAlign: 'right',
    paddingVertical: 0,
  },
  currency: { color: Colors.textSoft, fontSize: Typography.base },
  dynamicNote: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: Spacing.sm },
  quickAmounts: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  quickBtn: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  quickBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm },
  quickBtnTextActive: { color: Colors.primary, fontWeight: Typography.semibold },
});
