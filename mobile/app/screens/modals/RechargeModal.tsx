import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { Button } from '../../components/ui';
import { useStore } from '../../store/useStore';

interface RechargeModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const METHODS = [
  {
    id: 'mtn',
    icon: '📲',
    label: 'MTN Mobile Money',
    desc: 'Recharge via MoMo',
    color: Colors.yellow,
    ussd: '*126#',
  },
  {
    id: 'orange',
    icon: '🟠',
    label: 'Orange Money',
    desc: 'Recharge via OM',
    color: '#FF6600',
    ussd: '*144#',
  },
  {
    id: 'agent',
    icon: '🏪',
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
    onSuccess(`⚡ Compte rechargé de ${amt.toLocaleString('fr-FR')} FCFA !`);
    handleClose();
  };

  const amt = parseInt(amount) || 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Recharger mon compte</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {step !== 'method' && (
          <TouchableOpacity onPress={() => setStep('method')} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Retour</Text>
          </TouchableOpacity>
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
                >
                  <View style={[styles.methodIconWrap, { backgroundColor: m.color + '18', borderColor: m.color + '40' }]}>
                    <Text style={styles.methodIcon}>{m.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodLabel}>{m.label}</Text>
                    <Text style={styles.methodDesc}>{m.desc}</Text>
                    {m.ussd && <Text style={{ color: m.color, fontSize: Typography.xs, marginTop: 2 }}>{m.ussd}</Text>}
                  </View>
                  <Text style={{ color: Colors.textMuted }}>›</Text>
                </TouchableOpacity>
              ))}

              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  ℹ️ Votre argent reste chez l'opérateur. CamWallet crédite votre solde QR instantanément après confirmation.
                </Text>
              </View>
            </>
          )}

          {step === 'amount' && method && (
            <>
              {/* Method badge */}
              <View style={[styles.selectedMethod, { backgroundColor: method.color + '12', borderColor: method.color + '30' }]}>
                <Text style={styles.methodIcon}>{method.icon}</Text>
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
              />
            </>
          )}
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
  backBtn: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm },
  backBtnText: { color: Colors.textMuted, fontSize: Typography.base },
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
  methodIcon: { fontSize: 24 },
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
    backgroundColor: Colors.infoBg, borderWidth: 1, borderColor: Colors.blue + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm,
  },
  infoText: { color: Colors.textSoft, fontSize: Typography.xs, lineHeight: 18 },
});
