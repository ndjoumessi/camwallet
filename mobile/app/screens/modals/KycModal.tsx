import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { Button } from '../../components/ui';
import { kycApi } from '../../../src/lib/api';

type StepKey = 'idFront' | 'idBack' | 'selfie';
const STEPS: { key: StepKey; title: string; hint: string; facing: CameraType }[] = [
  { key: 'idFront', title: 'CNI — Recto', hint: 'Cadrez le recto de votre carte', facing: 'back' },
  { key: 'idBack', title: 'CNI — Verso', hint: 'Cadrez le verso de votre carte', facing: 'back' },
  { key: 'selfie', title: 'Selfie', hint: 'Placez votre visage dans le cadre', facing: 'front' },
];

interface KycModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function KycModal({ visible, onClose, onSubmitted }: KycModalProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [stepIndex, setStepIndex] = useState(0);
  const [shots, setShots] = useState<Partial<Record<StepKey, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const camRef = useRef<CameraView>(null);

  const step = STEPS[stepIndex];
  const allCaptured = STEPS.every((s) => shots[s.key]);

  const reset = () => { setStepIndex(0); setShots({}); setSubmitting(false); };
  const close = () => { reset(); onClose(); };

  const capture = async () => {
    const pic = await camRef.current?.takePictureAsync({ quality: 0.6 });
    if (!pic?.uri) return;
    setShots((prev) => ({ ...prev, [step.key]: pic.uri }));
    if (stepIndex < STEPS.length - 1) setStepIndex(stepIndex + 1);
  };

  const submit = async () => {
    if (!allCaptured) return;
    setSubmitting(true);
    try {
      await kycApi.submit({
        idFront: shots.idFront!,
        idBack: shots.idBack!,
        selfie: shots.selfie!,
      });
      Alert.alert('KYC envoyé', 'Vos documents ont été soumis et sont en cours de vérification.');
      reset();
      onSubmitted();
      onClose();
    } catch (e: any) {
      Alert.alert('Erreur', e?.response?.data?.message ?? "Échec de l'envoi du KYC");
    } finally {
      setSubmitting(false);
    }
  };

  const granted = permission?.granted ?? false;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Vérification d'identité</Text>
          <TouchableOpacity onPress={close} style={styles.closeBtn}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
        </View>

        {/* Progression */}
        <View style={styles.progress}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, { backgroundColor: shots[s.key] ? Colors.primary : i === stepIndex ? Colors.yellow : Colors.border }]} />
          ))}
        </View>

        <View style={styles.body}>
          <Text style={styles.stepTitle}>{step.title}</Text>
          <Text style={styles.hint}>{step.hint}</Text>

          {/* Caméra ou aperçu */}
          <View style={styles.cameraBox}>
            {!granted ? (
              <View style={styles.placeholder}>
                <Text style={{ fontSize: 36 }}>📷</Text>
                <Text style={styles.placeholderText}>Autorisation caméra requise</Text>
              </View>
            ) : shots[step.key] ? (
              <Image source={{ uri: shots[step.key] }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
            ) : (
              <CameraView ref={camRef} style={StyleSheet.absoluteFill} facing={step.facing} />
            )}
          </View>

          {!granted ? (
            <View style={{ width: '100%', paddingHorizontal: Spacing.xl }}>
              <Button label="Autoriser la caméra" onPress={requestPermission} />
            </View>
          ) : (
            <View style={{ width: '100%', paddingHorizontal: Spacing.xl, gap: Spacing.sm }}>
              {shots[step.key] ? (
                <TouchableOpacity style={styles.retake} onPress={() => setShots((p) => ({ ...p, [step.key]: undefined }))}>
                  <Text style={styles.retakeText}>↻ Reprendre cette photo</Text>
                </TouchableOpacity>
              ) : (
                <Button label="📸 Capturer" onPress={capture} />
              )}
            </View>
          )}

          {/* Vignettes */}
          <View style={styles.thumbs}>
            {STEPS.map((s, i) => (
              <TouchableOpacity key={s.key} onPress={() => setStepIndex(i)} style={styles.thumbWrap}>
                <View style={[styles.thumb, { borderColor: shots[s.key] ? Colors.primary : Colors.border }]}>
                  {shots[s.key] ? <Image source={{ uri: shots[s.key] }} style={styles.thumbImg} /> : <Text style={styles.thumbIdx}>{i + 1}</Text>}
                </View>
                <Text style={styles.thumbLabel}>{s.title.split(' ').pop()}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ width: '100%', paddingHorizontal: Spacing.xl, marginTop: Spacing.md }}>
            <Button
              label={submitting ? 'Envoi…' : 'Soumettre le KYC'}
              onPress={submit}
              disabled={!allCaptured || submitting}
            />
            {submitting && <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.sm }} />}
          </View>
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
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: Colors.textSoft, fontSize: Typography.base },
  progress: { flexDirection: 'row', gap: 8, justifyContent: 'center', paddingTop: Spacing.lg },
  dot: { width: 40, height: 4, borderRadius: 2 },
  body: { flex: 1, alignItems: 'center', paddingTop: Spacing.lg, gap: Spacing.sm },
  stepTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  hint: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: Spacing.sm },
  cameraBox: {
    width: 280, height: 200, borderRadius: BorderRadius.lg, backgroundColor: '#000',
    overflow: 'hidden', position: 'relative', marginBottom: Spacing.md,
  },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm } as any,
  placeholderText: { color: Colors.textMuted, fontSize: Typography.sm },
  retake: { alignItems: 'center', padding: Spacing.sm },
  retakeText: { color: Colors.yellow, fontSize: Typography.base, fontWeight: Typography.semibold },
  thumbs: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md },
  thumbWrap: { alignItems: 'center', gap: 4 },
  thumb: {
    width: 56, height: 56, borderRadius: BorderRadius.sm, borderWidth: 2,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbIdx: { color: Colors.textMuted, fontSize: Typography.lg, fontWeight: Typography.bold },
  thumbLabel: { color: Colors.textMuted, fontSize: Typography.xs },
});
