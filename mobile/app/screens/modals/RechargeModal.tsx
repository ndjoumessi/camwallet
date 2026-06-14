import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Button, IconButton } from '../../components/ui';
import { useStore } from '../../store/useStore';

interface RechargeModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const METHODS = [
  {
    id: 'mtn',
    icon: 'phone-portrait-outline' as const,
    label: 'MTN Mobile Money',
    desc: 'Recharge via MoMo',
    color: Colors.mtn,
    ussd: '*126#',
  },
  {
    id: 'orange',
    icon: 'ellipse' as const,
    label: 'Orange Money',
    desc: 'Recharge via OM',
    color: Colors.orange,
    ussd: '*144#',
  },
  {
    id: 'agent',
    icon: 'storefront-outline' as const,
    label: 'Agent partenaire',
    desc: 'Près de chez vous',
    color: Colors.blue,
    ussd: null,
  },
];

export default function RechargeModal({ visible, onClose, onSuccess }: RechargeModalProps) {
  const { balance, setBalance, addTransaction } = useStore();
  const [step, setStep] = useState<'method' | 'amount' | 'confirm'>('method');
  const [method, setMethod] = useState<typeof METHODS[0] | null>(null);
  const [amount, setAmount] = useState('');

  const reset = () => { setStep('method'); setMethod(null); setAmount(''); };
  const handleClose = () => { reset(); onClose(); };

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

  const handleRecharge = () => {
    const amt = parseInt(amount);
    if (!amt) return;
    setBalance(balance + amt);
    addTransaction({
      id: `TX_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      type: 'recharge',
      name: method!.label,
      amount: amt,
      date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      status: 'success',
      ref: `TX_${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    });
    onSuccess(`Compte rechargé de ${amt.toLocaleString('fr-FR')} FCFA !`);
    handleClose();
  };

  const amt = parseInt(amount) || 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <Animated.View style={[styles.flex, animStyle]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Recharger mon compte</Text>
            <IconButton icon="close" onPress={handleClose} accessibilityLabel="Fermer" />
          </View>

          {step !== 'method' && (
            <View style={styles.backRow}>
              <IconButton
                icon="arrow-back"
                onPress={() => setStep('method')}
                accessibilityLabel="Retour"
                size={20}
              />
              <Text style={styles.backLabel}>Retour</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.body}>
          {step === 'method' && (
            <>
              <Text style={styles.sectionLabel}>Choisir la méthode</Text>
              {METHODS.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.methodCard}
                  onPress={() => { setMethod(m); setStep('amount'); }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={m.label}
                >
                  <View style={[styles.methodIconWrap, { backgroundColor: m.color + '18', borderColor: m.color + '40' }]}>
                    <Ionicons name={m.icon} size={24} color={m.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    <Text style={styles.methodDesc}>{m.desc}</Text>
                    {m.ussd && <Text style={{ color: m.color, fontSize: Typography.xs, marginTop: 2 }}>{m.ussd}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              ))}

              <View style={styles.infoBox}>
                <Ionicons name="information-circle-outline" size={16} color={Colors.blue} style={{ marginTop: 1 }} />
                <Text style={styles.infoText}>
                  Votre argent reste chez l'opérateur. CamWallet crédite votre solde QR instantanément après confirmation.
                </Text>
              </View>
            </>
          )}

          {step === 'amount' && method && (
            <>
              {/* Method badge */}
              <View style={[styles.selectedMethod, { backgroundColor: method.color + '12', borderColor: method.color + '30' }]}>
                <Ionicons name={method.icon} size={24} color={method.color} />
                <Text style={[styles.methodLabel, { color: method.color }]}>{method.label}</Text>
              </View>

              {/* Amount input */}
              <View style={styles.amountWrap}>
                <Text style={styles.amountLabel}>Montant à recharger</Text>
                <TextInput
                  style={[styles.amountInput, { color: method.color }]}
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  autoFocus
                />
                <Text style={styles.amountCurrency}>FCFA</Text>
              </View>

              {/* Quick amounts */}
              <View style={styles.quickGrid}>
                {[5000, 10000, 25000, 50000].map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[styles.quickBtn, parseInt(amount) === q && { borderColor: method.color, backgroundColor: method.color + '12' }]}
                    onPress={() => setAmount(q.toString())}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${q.toLocaleString('fr-FR')} FCFA`}
                  >
                    <Text style={[styles.quickBtnText, parseInt(amount) === q && { color: method.color }]}>
                      {(q / 1000).toLocaleString('fr-FR')}k
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.limitNote}>
                <Text style={styles.limitText}>Min: 500 FCFA · Max: 500 000 FCFA</Text>
              </View>

              <Button
                label={`Recharger${amt ? ' ' + amt.toLocaleString('fr-FR') + ' FCFA' : ''}`}
                onPress={handleRecharge}
                disabled={amt < 500}
                fullWidth
              />
            </>
          )}
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
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backLabel: { color: Colors.textMuted, fontSize: Typography.base },
  body: { padding: Spacing.xl, gap: Spacing.md },
  sectionLabel: {
    color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: Spacing.sm,
  },
  methodCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
  },
  methodIconWrap: {
    width: 50, height: 50, borderRadius: BorderRadius.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  methodLabel: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  methodDesc: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  selectedMethod: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    borderWidth: 1, borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  amountWrap: { alignItems: 'center', paddingVertical: Spacing.xl },
  amountLabel: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: Spacing.sm },
  amountInput: {
    fontSize: 52, fontWeight: Typography.black,
    textAlign: 'center', minWidth: 200,
  },
  amountCurrency: { color: Colors.textMuted, fontSize: Typography.base, marginTop: 4 },
  quickGrid: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  quickBtn: {
    flex: 1, minWidth: '22%', backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.sm, alignItems: 'center',
  },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm, fontWeight: Typography.medium },
  limitNote: { alignItems: 'center' },
  limitText: { color: Colors.textMuted, fontSize: Typography.xs },
  infoBox: {
    flexDirection: 'row', gap: Spacing.sm,
    backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.blue + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm,
  },
  infoText: { flex: 1, color: Colors.textSoft, fontSize: Typography.xs, lineHeight: 18 },
});
