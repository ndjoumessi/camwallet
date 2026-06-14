import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Button, IconButton } from '../../components/ui';

// Destinataire décodé depuis un QR Code CamWallet.
export interface ScannedRecipient {
  phone: string;
  name?: string;
  amount?: string;
}

interface ScanModalProps {
  visible: boolean;
  onClose: () => void;
  onDetected: (recipient: ScannedRecipient) => void;
}

// Décode le contenu d'un QR : URI camwallet://pay, JSON, ou numéro brut.
function parseQr(raw: string): ScannedRecipient | null {
  const value = raw.trim();
  try {
    if (value.startsWith('camwallet://')) {
      const qs = value.split('?')[1] ?? '';
      const params: Record<string, string> = {};
      qs.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      });
      const phone = params.to || params.phone;
      if (!phone) return null;
      return { phone, name: params.name || undefined, amount: params.amount || undefined };
    }
    if (value.startsWith('{')) {
      const obj = JSON.parse(value);
      const phone = obj.phone ?? obj.to;
      if (phone) return { phone: String(phone), name: obj.name, amount: obj.amount != null ? String(obj.amount) : undefined };
    }
    const digits = value.replace(/[^0-9+]/g, '');
    if (digits.length >= 8) return { phone: digits };
  } catch {
    /* payload illisible */
  }
  return null;
}

const initials = (name?: string, phone?: string) =>
  name
    ? name.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : (phone ?? '?').replace(/\D/g, '').slice(-2);

export default function ScanModal({ visible, onClose, onDetected }: ScanModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<ScannedRecipient | null>(null);
  const [error, setError] = useState(false);
  const scanLine = useState(new Animated.Value(0))[0];

  // Demande la permission caméra à la première ouverture.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission]);

  // Réinitialise + anime la ligne de scan tant qu'aucun QR n'est détecté.
  useEffect(() => {
    if (!visible) { setScanned(null); setError(false); return; }
    if (scanned) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [visible, scanned]);

  const handleBarcode = ({ data }: { data: string }) => {
    if (scanned) return; // évite les détections répétées
    const parsed = parseQr(data);
    if (parsed) {
      setError(false);
      setScanned(parsed);
    } else {
      setError(true);
    }
  };

  const scanLineTranslate = scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, 180] });
  const granted = permission?.granted ?? false;

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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <Animated.View style={[styles.flex, animStyle]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Scanner un QR Code</Text>
          <IconButton icon="close" onPress={onClose} accessibilityLabel="Fermer" />
        </View>

        <View style={styles.body}>
          <View style={styles.hintRow} accessibilityLiveRegion="polite">
            <Ionicons
              name={scanned ? 'checkmark-circle' : error ? 'warning-outline' : 'qr-code-outline'}
              size={16}
              color={scanned ? Colors.primary : error ? Colors.yellow : Colors.textSoft}
            />
            <Text style={styles.hint}>
              {scanned ? 'QR Code détecté !' : error ? 'QR Code non reconnu' : 'Pointez la caméra vers le QR Code'}
            </Text>
          </View>

          {/* Scanner viewfinder */}
          <View style={styles.scanBox}>
            {!granted ? (
              <View style={styles.cameraPlaceholder}>
                <Ionicons name="close-circle-outline" size={40} color={Colors.textMuted} style={styles.cameraIcon} />
                <Text style={styles.cameraText}>
                  {permission && !permission.canAskAgain
                    ? 'Accès caméra refusé.\nActivez-le dans les réglages.'
                    : 'Autorisation caméra requise'}
                </Text>
              </View>
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleBarcode}
              />
            )}

            {scanned && (
              <View style={styles.scannedOverlay}>
                <Ionicons name="checkmark-circle" size={64} color={Colors.primary} />
              </View>
            )}

            {/* Corner markers */}
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />

            {/* Scan line */}
            {granted && !scanned && (
              <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineTranslate }] }]} />
            )}
          </View>

          {/* Permission CTA */}
          {!granted && permission?.canAskAgain && (
            <View style={{ paddingHorizontal: Spacing.xxl, width: '100%' }}>
              <Button label="Autoriser la caméra" onPress={requestPermission} />
            </View>
          )}

          {/* Result card */}
          {scanned && (
            <View style={styles.resultCard}>
              <View style={styles.resultAvatar}>
                <Text style={styles.resultAvatarText}>{initials(scanned.name, scanned.phone)}</Text>
              </View>
              <View>
                <Text style={styles.resultName}>{scanned.name ?? 'Destinataire'}</Text>
                <Text style={styles.resultPhone}>+237 {scanned.phone}</Text>
                {scanned.amount && <Text style={styles.resultPhone}>Montant : {scanned.amount} FCFA</Text>}
              </View>
            </View>
          )}

          {granted && (
            <View style={{ paddingHorizontal: Spacing.xxl, width: '100%', marginTop: Spacing.xl }}>
              <Button
                label={scanned ? "Envoyer de l'argent" : 'Scan en cours...'}
                icon={scanned ? 'arrow-forward' : undefined}
                onPress={() => {
                  if (scanned) {
                    onDetected(scanned);
                    onClose();
                  }
                }}
                disabled={!scanned}
                fullWidth
              />
            </View>
          )}

          <TouchableOpacity
            onPress={onClose}
            style={styles.cancelBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Annuler"
          >
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
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
  body: { flex: 1, alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.xl },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { color: Colors.textSoft, fontSize: Typography.base },
  scanBox: {
    width: 240, height: 240, borderRadius: BorderRadius.lg,
    backgroundColor: '#000',
    position: 'relative', overflow: 'hidden',
  },
  cameraPlaceholder: {
    position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111', paddingHorizontal: Spacing.lg,
  } as any,
  cameraIcon: { fontSize: 40, marginBottom: Spacing.sm },
  cameraText: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center' },
  scannedOverlay: {
    position: 'absolute', inset: 0,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center', justifyContent: 'center',
  } as any,
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
