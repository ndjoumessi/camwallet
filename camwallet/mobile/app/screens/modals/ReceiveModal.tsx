import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Share,
  ScrollView,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { Button } from '../../components/ui';
import { useStore } from '../../store/useStore';

interface ReceiveModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function ReceiveModal({ visible, onClose }: ReceiveModalProps) {
  const { user } = useStore();
  const [activeTab, setActiveTab] = useState<'static' | 'dynamic'>('static');
  const [dynamicAmount, setDynamicAmount] = useState('');

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
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Recevoir de l'argent</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {/* Tabs */}
          <View style={styles.tabBar}>
            {(['static', 'dynamic'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab === 'static' ? '🔒 QR Statique' : '⚡ QR Dynamique'}
                </Text>
              </TouchableOpacity>
            ))}
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
          <Button label="📤 Partager mon QR Code" onPress={handleShare} variant="secondary" style={{ marginBottom: Spacing.md }} />
          <Button label="Fermer" onPress={onClose} variant="ghost" />
        </ScrollView>
      </View>
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
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: Colors.textSoft, fontSize: Typography.base },
  body: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.xl },
  tabBar: {
    flexDirection: 'row', backgroundColor: Colors.card, borderRadius: BorderRadius.md,
    padding: 4, width: '100%',
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: BorderRadius.sm, alignItems: 'center' },
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
