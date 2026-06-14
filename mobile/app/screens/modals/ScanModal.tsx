import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { Button } from '../../components/ui';

interface ScanModalProps {
  visible: boolean;
  onClose: () => void;
  onDetected: (data: string) => void;
}

export default function ScanModal({ visible, onClose, onDetected }: ScanModalProps) {
  const [scanned, setScanned] = useState(false);
  const [scanData, setScanData] = useState<{ name: string; phone: string } | null>(null);
  const scanLine = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!visible) { setScanned(false); setScanData(null); return; }

    // Animate scan line
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    anim.start();

    // Simulate scan after 2s
    const timer = setTimeout(() => {
      setScanned(true);
      setScanData({ name: 'Marie Ngono', phone: '670 112 233' });
      anim.stop();
    }, 2000);

    return () => { clearTimeout(timer); anim.stop(); };
  }, [visible]);

  const scanLineTranslate = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 180],
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Scanner un QR Code</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.hint}>
            {scanned ? '✅ QR Code détecté !' : 'Pointez la caméra vers le QR Code'}
          </Text>

          {/* Scanner viewfinder */}
          <View style={styles.scanBox}>
            {/* Camera simulation */}
            {!scanned && (
              <View style={styles.cameraPlaceholder}>
                <Text style={styles.cameraIcon}>📷</Text>
                <Text style={styles.cameraText}>Caméra active</Text>
              </View>
            )}

            {/* Scanned QR preview */}
            {scanned && (
              <View style={styles.scannedOverlay}>
                <Text style={styles.scannedCheck}>✓</Text>
              </View>
            )}

            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />

            {/* Scan line */}
            {!scanned && (
              <Animated.View
                style={[
                  styles.scanLine,
                  { transform: [{ translateY: scanLineTranslate }] },
                ]}
              />
            )}
          </View>

          {/* Result card */}
          {scanned && scanData && (
            <View style={styles.resultCard}>
              <View style={styles.resultAvatar}>
                <Text style={styles.resultAvatarText}>MN</Text>
              </View>
              <View>
                <Text style={styles.resultName}>{scanData.name}</Text>
                <Text style={styles.resultPhone}>+237 {scanData.phone}</Text>
              </View>
            </View>
          )}

          <View style={{ paddingHorizontal: Spacing.xxl, width: '100%', marginTop: Spacing.xl }}>
            <Button
              label={scanned ? "Envoyer de l'argent →" : "Scan en cours..."}
              onPress={() => {
                if (scanned) {
                  onDetected(`camwallet://pay?to=${scanData?.phone}`);
                  onClose();
                }
              }}
              disabled={!scanned}
            />
          </View>

          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
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
  body: { flex: 1, alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.xl },
  hint: { color: Colors.textSoft, fontSize: Typography.base },
  scanBox: {
    width: 240, height: 240, borderRadius: BorderRadius.lg,
    backgroundColor: '#000',
    position: 'relative', overflow: 'hidden',
  },
  cameraPlaceholder: {
    position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111',
  } as any,
  cameraIcon: { fontSize: 40, marginBottom: Spacing.sm },
  cameraText: { color: Colors.textMuted, fontSize: Typography.sm },
  scannedOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center', justifyContent: 'center',
  } as any,
  scannedCheck: { fontSize: 60, color: Colors.primary },
  corner: { position: 'absolute', width: 24, height: 24 },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderColor: Colors.primary },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderColor: Colors.primary },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: Colors.primary },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderColor: Colors.primary },
  scanLine: {
    position: 'absolute', left: 0, right: 0, height: 2,
    backgroundColor: Colors.primary,
    opacity: 0.8,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  resultCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.lg, padding: Spacing.md,
    width: '80%',
  },
  resultAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.yellow + '20', borderWidth: 2, borderColor: Colors.yellow + '55',
    alignItems: 'center', justifyContent: 'center',
  },
  resultAvatarText: { color: Colors.yellow, fontWeight: Typography.black, fontSize: Typography.sm },
  resultName: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  resultPhone: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  cancelBtn: { padding: Spacing.md },
  cancelText: { color: Colors.textMuted, fontSize: Typography.base },
});
