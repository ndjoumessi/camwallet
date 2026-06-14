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

export default function ReceiveModal({ visible, onClose }: ReceiveModalProps) {
  const { user } = useStore();
  const [activeTab, setActiveTab] = useState<'static' | 'dynamic'>('static');
  const [dynamicAmount, setDynamicAmount] = useState('');

  // Micro-animation d'entrée (translateY + opacité) déclenchée à l'ouverture.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.spring(enter, {
        toValue: 1,
        damping: Animation.spring.damping,
        stiffness: Animation.spring.stiffness,
        useNativeDriver: true,
      }).start();
    } else {
      enter.setValue(0);
    }
  }, [visible, enter]);
  const animStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  };

  const qrValue = `camwallet://pay?to=${user.phone.replace(/\s/g, '')}&name=${encodeURIComponent(user.name)}${dynamicAmount ? `&amount=${dynamicAmount}` : ''}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Payez-moi via CamWallet\n+237 ${user.phone}\nRéférence: ${user.phone.replace(/\s/g, '')}`,
        title: 'CamWallet — Mon QR de paiement',
      });
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
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
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userPhone}>+237 {user.phone}</Text>
            {activeTab === 'static' && (
              <Text style={styles.infoNote}>Ce QR code est permanent. Partagez-le librement.</Text>
            )}
          </View>

          {/* Dynamic amount */}
          {activeTab === 'dynamic' && (
            <View style={styles.dynamicWrap}>
              <Text style={styles.dynamicLabel}>Montant spécifique (optionnel)</Text>
              <View style={styles.inputRow}>
                <Text style={styles.currency}>FCFA</Text>
                <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
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
                  style={styles.quickBtn}
                  onPress={() => setDynamicAmount(q.toString())}
                >
                  <Text style={styles.quickBtnText}>{(q / 1000).toLocaleString('fr-FR')}k</Text>
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
  currency: { color: Colors.textSoft, fontSize: Typography.base },
  dynamicNote: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: Spacing.sm },
  quickAmounts: { flexDirection: 'row', gap: Spacing.sm, width: '100%' },
  quickBtn: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.sm, alignItems: 'center',
  },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm },
});
