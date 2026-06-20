import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  Animated,
  Easing,
  Dimensions,
  ScrollView,
  AccessibilityInfo,
  PanResponder,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const SCAN_BOX_SIZE = Math.min(Math.max(SCREEN_W - 96, 240), 300);
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Button, IconButton } from '../../components/ui';
import { useTranslation } from 'react-i18next';

// Destinataire décodé depuis un QR Code CamWallet.
export interface ScannedRecipient {
  phone: string;
  name?: string;
  amount?: string;
}

// Type de QR détecté (paiement CamWallet, lien web, ou texte brut non payable).
type QrKind = 'camwallet' | 'url' | 'text';

interface ScanModalProps {
  visible: boolean;
  onClose: () => void;
  onDetected: (recipient: ScannedRecipient) => void;
}

const HISTORY_KEY = 'cw_scan_history';
const HISTORY_MAX = 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Détecte le type d'un QR sans le décoder entièrement.
function detectQrKind(raw: string): QrKind {
  const v = raw.trim();
  if (v.startsWith('camwallet://') || v.startsWith('{')) return 'camwallet';
  if (/^https?:\/\//i.test(v)) return 'url';
  const digits = v.replace(/[^0-9+]/g, '');
  if (/^\+?\d{8,15}$/.test(digits)) return 'camwallet';
  return 'text';
}

// Décode le contenu d'un QR CamWallet : URI camwallet://pay, JSON, ou numéro brut.
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
      // Format CamWallet standard : on exige le type pour éviter les faux positifs.
      if (obj.type === 'camwallet_payment' && obj.phone) {
        return { phone: String(obj.phone), name: obj.name, amount: obj.amount != null ? String(obj.amount) : undefined };
      }
      return null;
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
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<ScannedRecipient | null>(null);
  const [error, setError] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [history, setHistory] = useState<ScannedRecipient[]>([]);
  const scanLine = useState(new Animated.Value(0))[0];
  const checkScale = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(false);

  // Zoom : suivi de l'écart entre deux doigts (pinch-to-zoom maison, cross-platform).
  const zoomRef = useRef(0);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
      onPanResponderMove: (e) => {
        const ts = e.nativeEvent.touches;
        if (ts.length !== 2) return;
        const dist = Math.hypot(ts[0].pageX - ts[1].pageX, ts[0].pageY - ts[1].pageY);
        if (!pinchStart.current) { pinchStart.current = { dist, zoom: zoomRef.current }; return; }
        const delta = (dist - pinchStart.current.dist) / 220; // sensibilité
        setZoom(clamp(pinchStart.current.zoom + delta, 0, 1));
      },
      onPanResponderRelease: () => { pinchStart.current = null; },
      onPanResponderTerminate: () => { pinchStart.current = null; },
    }),
  ).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => { reduceMotionRef.current = rm; })
      .catch(() => {});
  }, []);

  // Charge l'historique des derniers QR scannés à l'ouverture.
  useEffect(() => {
    if (!visible) return;
    AsyncStorage.getItem(HISTORY_KEY)
      .then((raw) => { if (raw) setHistory(JSON.parse(raw)); })
      .catch(() => {});
  }, [visible]);

  const pushHistory = useCallback((rec: ScannedRecipient) => {
    setHistory((prev) => {
      const next = [rec, ...prev.filter((r) => r.phone !== rec.phone)].slice(0, HISTORY_MAX);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  // Demande la permission caméra à la première ouverture.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission]);

  // Réinitialise + anime la ligne de scan tant qu'aucun QR n'est détecté.
  useEffect(() => {
    if (!visible) { setScanned(null); setError(false); setTorch(false); setZoom(0); return; }
    if (scanned) return;
    if (reduceMotionRef.current) {
      scanLine.setValue(0.5);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(scanLine, { toValue: 0, duration: 1500, easing: Easing.linear, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [visible, scanned]);

  // Animation du checkmark à la détection (spring) + haptique.
  useEffect(() => {
    if (scanned) {
      checkScale.setValue(0);
      Animated.spring(checkScale, { toValue: 1, damping: 8, stiffness: 180, useNativeDriver: true }).start();
    }
  }, [scanned, checkScale]);

  // Anti-doublon : ignore un même QR rescanné dans les 2 s (évite le spam haptique/erreur image par image).
  const lastScanRef = useRef<{ data: string; t: number }>({ data: '', t: 0 });

  const handleBarcode = ({ data }: { data: string }) => {
    if (scanned) return; // évite les détections répétées
    const now = Date.now();
    if (data === lastScanRef.current.data && now - lastScanRef.current.t < 2000) return;
    lastScanRef.current = { data, t: now };
    const kind = detectQrKind(data);
    const parsed = kind === 'camwallet' ? parseQr(data) : null;
    if (parsed) {
      setError(false);
      setScanned(parsed);
      pushHistory(parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setError(true);
      // Message spécifique selon le type non payable détecté.
      setErrorKind(kind);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  };
  const [errorKind, setErrorKind] = useState<QrKind>('text');

  const scanLineTranslate = scanLine.interpolate({ inputRange: [0, 1], outputRange: [0, SCAN_BOX_SIZE - 60] });
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

  const errorMsg = errorKind === 'url'
    ? t('scan.hintUrl', { defaultValue: 'Lien web détecté (non payable)' })
    : errorKind === 'text'
      ? t('scan.hintText', { defaultValue: 'Texte détecté (non payable)' })
      : t('scan.invalid_qr', { defaultValue: 'QR code non reconnu — utilisez un QR CamWallet' });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <Animated.View style={[styles.flex, animStyle]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('scan.headerTitle')}</Text>
          <IconButton icon="close" onPress={onClose} accessibilityLabel={t('scan.closeBtnA11y')} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.hintRow} accessibilityLiveRegion="polite">
            <Ionicons
              name={scanned ? 'checkmark-circle' : error ? 'warning-outline' : 'qr-code-outline'}
              size={16}
              color={scanned ? Colors.primary : error ? Colors.yellow : Colors.textSoft}
            />
            <Text style={styles.hint}>
              {scanned ? t('scan.hintDetected') : error ? errorMsg : t('scan.aim_guide', { defaultValue: 'Placez le QR code dans le cadre' })}
            </Text>
          </View>

          {/* Scanner viewfinder (pinch-to-zoom via PanResponder) */}
          <View style={styles.scanBox} {...panResponder.panHandlers}>
            {!granted ? (
              <View style={styles.cameraPlaceholder}>
                <Ionicons name="close-circle-outline" size={40} color={Colors.textMuted} style={styles.cameraIcon} />
                <Text style={styles.cameraText}>
                  {permission && !permission.canAskAgain
                    ? t('scan.cameraPermissionDenied')
                    : t('scan.cameraPermissionRequired')}
                </Text>
              </View>
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                zoom={zoom}
                enableTorch={torch}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanned ? undefined : handleBarcode}
              />
            )}

            {/* Torche (en haut à droite du viewfinder) */}
            {granted && !scanned && (
              <Pressable
                onPress={() => setTorch((v) => !v)}
                style={styles.torchBtn}
                accessibilityRole="button"
                accessibilityLabel={t('scan.torchA11y', { defaultValue: 'Lampe torche' })}
                accessibilityState={{ selected: torch }}
              >
                <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={20} color={torch ? Colors.yellow : '#fff'} />
              </Pressable>
            )}

            {scanned && (
              <Animated.View style={[styles.scannedOverlay, { transform: [{ scale: checkScale }] }]}>
                <Ionicons name="checkmark-circle" size={72} color={Colors.primary} />
              </Animated.View>
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

            {/* Indicateur de zoom */}
            {granted && !scanned && zoom > 0.02 && (
              <View style={styles.zoomBadge}><Text style={styles.zoomText}>{Math.round(zoom * 100)}%</Text></View>
            )}
          </View>

          {/* Permission CTA */}
          {!granted && permission?.canAskAgain && (
            <View style={{ paddingHorizontal: Spacing.xxl, width: '100%' }}>
              <Button label={t('scan.btnAllowCamera')} onPress={requestPermission} />
            </View>
          )}

          {/* Aperçu marchand avant paiement */}
          {scanned && (
            <View style={styles.resultCard}>
              <View style={styles.resultAvatar}>
                <Text style={styles.resultAvatarText}>{initials(scanned.name, scanned.phone)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.resultName}>{scanned.name ?? t('scan.resultDefaultName')}</Text>
                <Text style={styles.resultPhone}>+237 {scanned.phone.replace(/^\+?237/, '')}</Text>
                {scanned.amount && <Text style={styles.resultAmount}>{t('scan.resultAmount', { amount: scanned.amount })}</Text>}
              </View>
            </View>
          )}

          {/* Historique des derniers QR scannés */}
          {granted && !scanned && history.length > 0 && (
            <View style={styles.historyWrap}>
              <Text style={styles.historyTitle}>{t('scan.recentTitle', { defaultValue: 'Derniers scans' })}</Text>
              {history.map((h, i) => (
                <Pressable
                  key={`${h.phone}-${i}`}
                  onPress={() => { setScanned(h); setError(false); Haptics.selectionAsync().catch(() => {}); }}
                  style={styles.historyRow}
                  accessibilityRole="button"
                  accessibilityLabel={h.name ?? h.phone}
                >
                  <View style={styles.historyAvatar}><Text style={styles.historyAvatarText}>{initials(h.name, h.phone)}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyName} numberOfLines={1}>{h.name ?? t('scan.resultDefaultName')}</Text>
                    <Text style={styles.historyPhone}>+237 {h.phone.replace(/^\+?237/, '')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </Pressable>
              ))}
            </View>
          )}

          {granted && (
            <View style={{ paddingHorizontal: Spacing.xxl, width: '100%', marginTop: Spacing.xl }}>
              <Button
                label={scanned ? t('scan.btnSend') : t('scan.btnScanning')}
                icon={scanned ? 'arrow-forward' : undefined}
                onPress={() => {
                  // onDetected fait basculer le parent vers SendModal (activeModal='send'),
                  // ce qui ferme ce modal via sa prop `visible`. Surtout NE PAS appeler
                  // onClose() ici : il remettrait activeModal à null dans le même handler
                  // et annulerait la navigation (le bouton « ne ferait rien »).
                  if (scanned) onDetected(scanned);
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
            accessibilityLabel={t('scan.btnCancelA11y')}
          >
            <Text style={styles.cancelText}>{t('scan.btnCancel')}</Text>
          </TouchableOpacity>
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
  body: { flexGrow: 1, alignItems: 'center', paddingTop: Spacing.xxl, paddingBottom: Spacing.xl, gap: Spacing.xl },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { color: Colors.textSoft, fontSize: Typography.base },
  scanBox: {
    width: SCAN_BOX_SIZE, height: SCAN_BOX_SIZE, borderRadius: BorderRadius.lg,
    backgroundColor: '#000',
    position: 'relative', overflow: 'hidden',
  },
  cameraPlaceholder: {
    position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111', paddingHorizontal: Spacing.lg,
  } as any,
  cameraIcon: { fontSize: 40, marginBottom: Spacing.sm },
  cameraText: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center' },
  torchBtn: {
    position: 'absolute', top: 10, right: 10, zIndex: 5,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  zoomBadge: {
    position: 'absolute', bottom: 10, alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2,
  },
  zoomText: { color: '#fff', fontSize: Typography.xs, fontWeight: Typography.bold },
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
  resultAmount: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.bold, marginTop: 3 },
  historyWrap: { width: '85%', gap: Spacing.sm },
  historyTitle: { color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.sm,
  },
  historyAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center',
  },
  historyAvatarText: { color: Colors.primary, fontWeight: Typography.bold, fontSize: Typography.xs },
  historyName: { color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.semibold },
  historyPhone: { color: Colors.textMuted, fontSize: Typography.xs },
  cancelBtn: { padding: Spacing.md, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: Colors.textMuted, fontSize: Typography.base },
});
