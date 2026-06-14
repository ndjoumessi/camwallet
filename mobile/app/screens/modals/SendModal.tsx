import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated,
  Linking,
} from 'react-native';
import { Colors, Typography, Spacing, BorderRadius } from '../../constants/theme';
import { Avatar, Button } from '../../components/ui';
import { useStore } from '../../store/useStore';

interface SendModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  initialContact?: number;
}

const FRAIS = 10;

export default function SendModal({ visible, onClose, onSuccess, initialContact }: SendModalProps) {
  const { contacts, balance, setBalance, addTransaction } = useStore();
  const [step, setStep] = useState<'contact' | 'amount' | 'pin' | 'done'>('contact');
  const [selectedContact, setSelectedContact] = useState(
    initialContact ? contacts.find(c => c.id === initialContact) : null
  );
  const [amount, setAmount] = useState('');
  const [motif, setMotif] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const ref = `TX_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const dateStr = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const reset = () => {
    setStep('contact');
    setSelectedContact(null);
    setAmount('');
    setMotif('');
    setPin('');
    setPinError(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handlePin = (digit: string) => {
    if (pin.length >= 6) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 6) {
      if (next === '123456') {
        const amt = parseInt(amount);
        setTimeout(() => {
          setBalance(balance - amt - FRAIS);
          addTransaction({
            id: ref,
            type: 'sent',
            name: selectedContact!.name,
            amount: -(amt + FRAIS),
            date: dateStr,
            status: 'success',
            ref,
            motif,
          });
          setStep('done');
        }, 300);
      } else {
        setTimeout(() => {
          setPinError(true);
          setPin('');
          triggerShake();
          setTimeout(() => setPinError(false), 800);
        }, 300);
      }
    }
  };

  const amt = parseInt(amount) || 0;
  const canSend = amt >= 100 && amt <= balance - FRAIS;

  const waText = encodeURIComponent(
    `🧾 *REÇU CAMWALLET*\n━━━━━━━━━━━━━━━━━━\n✅ *Transfert réussi*\n\n` +
    `💰 *Montant :* ${amt.toLocaleString('fr-FR')} FCFA\n` +
    `💳 *Frais :* ${FRAIS} FCFA\n` +
    `💵 *Total débité :* ${(amt + FRAIS).toLocaleString('fr-FR')} FCFA\n` +
    `${motif ? `📝 *Motif :* ${motif}\n` : ''}` +
    `🔖 *Réf :* ${ref}\n📅 *Date :* ${dateStr}\n━━━━━━━━━━━━━━━━━━\n_CamWallet 🇨🇲_`
  );

  const renderStep = () => {
    switch (step) {
      case 'contact':
        return (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.sectionLabel}>Choisir un destinataire</Text>
            {contacts.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={styles.contactRow}
                onPress={() => { setSelectedContact(c); setStep('amount'); }}
                activeOpacity={0.7}
              >
                <Avatar initials={c.avatar} size={44} color={c.color} bg={c.color + '20'} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.contactName}>{c.name}</Text>
                  <Text style={styles.contactPhone}>+237 {c.phone}</Text>
                </View>
                <Text style={{ color: Colors.textMuted }}>›</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        );

      case 'amount':
        return (
          <ScrollView contentContainerStyle={styles.body}>
            {/* Recipient */}
            {selectedContact && (
              <View style={styles.recipientCard}>
                <Avatar initials={selectedContact.avatar} size={40} color={selectedContact.color} bg={selectedContact.color + '20'} />
                <View>
                  <Text style={styles.contactName}>{selectedContact.name}</Text>
                  <Text style={styles.contactPhone}>+237 {selectedContact.phone}</Text>
                </View>
              </View>
            )}

            {/* Amount */}
            <View style={styles.amountWrap}>
              <Text style={styles.amountLabel}>Montant</Text>
              <TextInput
                style={styles.amountInput}
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
            <View style={styles.quickAmounts}>
              {[1000, 2000, 5000, 10000].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={styles.quickBtn}
                  onPress={() => setAmount(q.toString())}
                >
                  <Text style={styles.quickBtnText}>{(q / 1000).toLocaleString('fr-FR')}k</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Motif */}
            <View style={styles.motifRow}>
              <TextInput
                style={styles.motifInput}
                value={motif}
                onChangeText={(v) => setMotif(v.slice(0, 60))}
                placeholder="Motif (optionnel)"
                placeholderTextColor={Colors.textMuted}
                maxLength={60}
              />
              <Text style={styles.motifCount}>{motif.length}/60</Text>
            </View>

            {/* Fees */}
            {amt > 0 && (
              <View style={styles.feeBox}>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Montant</Text>
                  <Text style={styles.feeVal}>{amt.toLocaleString('fr-FR')} FCFA</Text>
                </View>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>Frais</Text>
                  <Text style={styles.feeVal}>{FRAIS} FCFA</Text>
                </View>
                <View style={[styles.feeRow, { borderTopWidth: 1, borderTopColor: Colors.yellow + '30', marginTop: 4, paddingTop: 8 }]}>
                  <Text style={[styles.feeLabel, { color: Colors.text }]}>Total débité</Text>
                  <Text style={[styles.feeVal, { color: Colors.yellow, fontWeight: Typography.bold }]}>
                    {(amt + FRAIS).toLocaleString('fr-FR')} FCFA
                  </Text>
                </View>
              </View>
            )}

            <Button label="Continuer" onPress={() => setStep('pin')} disabled={!canSend} />
          </ScrollView>
        );

      case 'pin':
        return (
          <View style={styles.pinContainer}>
            <Text style={styles.pinTitle}>Entrez votre PIN</Text>
            <Text style={styles.pinSubtitle}>
              Envoi de {amt.toLocaleString('fr-FR')} FCFA à {selectedContact?.name}
            </Text>

            {pinError && (
              <Text style={styles.pinErrorText}>PIN incorrect</Text>
            )}

            <Animated.View style={[styles.pinDots, { transform: [{ translateX: shake }] }]}>
              {Array(6).fill(0).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    pin.length > i
                      ? [styles.pinDotFilled, pinError && { backgroundColor: Colors.red }]
                      : styles.pinDotEmpty,
                  ]}
                />
              ))}
            </Animated.View>

            <Text style={styles.pinHint}>
              PIN de démo : <Text style={{ color: Colors.primary }}>123456</Text>
            </Text>

            <View style={styles.pinGrid}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.pinKey, k === '' && styles.pinKeyEmpty]}
                  onPress={() => {
                    if (k === '') return;
                    if (k === '⌫') setPin(p => p.slice(0, -1));
                    else handlePin(k);
                  }}
                  disabled={k === ''}
                  activeOpacity={0.7}
                >
                  {k !== '' && <Text style={styles.pinKeyText}>{k}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 'done':
        return (
          <View style={styles.doneContainer}>
            <View style={styles.successIcon}>
              <Text style={{ fontSize: 40 }}>✅</Text>
            </View>
            <Text style={styles.doneTitle}>Transfert réussi !</Text>
            <Text style={styles.doneSubtitle}>
              {amt.toLocaleString('fr-FR')} FCFA envoyés à {selectedContact?.name}
            </Text>

            {/* Receipt */}
            <View style={styles.receipt}>
              {[
                ['De', 'Jean-Paul Mbarga'],
                ['À', selectedContact?.name ?? ''],
                ['Montant', `${amt.toLocaleString('fr-FR')} FCFA`],
                ['Frais', `${FRAIS} FCFA`],
                ['Total débité', `${(amt + FRAIS).toLocaleString('fr-FR')} FCFA`],
                ...(motif ? [['Motif', motif]] : []),
                ['Référence', ref],
                ['Date', dateStr],
              ].map(([label, value], i) => (
                <View key={i} style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>{label}</Text>
                  <Text style={[styles.receiptValue, label === 'Total débité' && { color: Colors.yellow }]}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.waBtn}
              onPress={() => Linking.openURL(`https://wa.me/?text=${waText}`)}
            >
              <Text style={styles.waBtnText}>📱 Partager via WhatsApp</Text>
            </TouchableOpacity>

            <Button label="Terminer" onPress={() => { onSuccess(`✓ ${amt.toLocaleString('fr-FR')} FCFA envoyés !`); handleClose(); }} style={{ marginTop: Spacing.md }} />
          </View>
        );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.sheet}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {step === 'contact' ? 'Envoyer de l\'argent'
              : step === 'amount' ? 'Montant'
              : step === 'pin' ? 'Confirmer'
              : 'Succès'}
          </Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Back button */}
        {(step === 'amount' || step === 'pin') && (
          <TouchableOpacity
            onPress={() => step === 'amount' ? setStep('contact') : setStep('amount')}
            style={styles.backBtn}
          >
            <Text style={styles.backBtnText}>← Retour</Text>
          </TouchableOpacity>
        )}

        {renderStep()}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { color: Colors.textSoft, fontSize: Typography.base },
  backBtn: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm },
  backBtnText: { color: Colors.textMuted, fontSize: Typography.base },
  body: { padding: Spacing.xl, gap: Spacing.md },
  sectionLabel: {
    color: Colors.textMuted, fontSize: Typography.xs,
    fontWeight: Typography.bold, letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: Spacing.sm,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  contactName: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  contactPhone: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  recipientCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.primary + '40',
    borderRadius: BorderRadius.md, padding: Spacing.md,
  },
  amountWrap: { alignItems: 'center', paddingVertical: Spacing.xl },
  amountLabel: { color: Colors.textMuted, fontSize: Typography.sm, marginBottom: Spacing.sm },
  amountInput: {
    color: Colors.primary, fontSize: 52, fontWeight: Typography.black,
    textAlign: 'center', minWidth: 200,
  },
  amountCurrency: { color: Colors.textMuted, fontSize: Typography.base, marginTop: 4 },
  quickAmounts: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  quickBtn: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.sm, alignItems: 'center',
  },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm },
  motifRow: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  motifInput: { color: Colors.text, fontSize: Typography.base },
  motifCount: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 4, textAlign: 'right' },
  feeBox: {
    backgroundColor: Colors.yellow + '08', borderWidth: 1, borderColor: Colors.yellow + '30',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.xl,
  },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  feeLabel: { color: Colors.textSoft, fontSize: Typography.sm },
  feeVal: { color: Colors.text, fontSize: Typography.sm },

  // PIN
  pinContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  pinTitle: { color: Colors.text, fontSize: Typography.xl, fontWeight: Typography.bold, marginBottom: Spacing.sm },
  pinSubtitle: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center', marginBottom: Spacing.xxl },
  pinErrorText: { color: Colors.red, fontSize: Typography.sm, marginBottom: Spacing.md },
  pinDots: { flexDirection: 'row', gap: 14, marginBottom: Spacing.md },
  pinDot: { width: 16, height: 16, borderRadius: 8 },
  pinDotFilled: { backgroundColor: Colors.primary },
  pinDotEmpty: { backgroundColor: Colors.border },
  pinHint: { color: Colors.textMuted, fontSize: Typography.xs, marginBottom: Spacing.xxl },
  pinGrid: { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12, justifyContent: 'center' },
  pinKey: {
    width: 80, height: 60, borderRadius: BorderRadius.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pinKeyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  pinKeyText: { fontSize: Typography.xl, fontWeight: Typography.semibold, color: Colors.text },

  // Done
  doneContainer: { flex: 1, padding: Spacing.xl, alignItems: 'center' },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.successBg, alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.xl, marginTop: Spacing.xxl,
  },
  doneTitle: { color: Colors.text, fontSize: Typography.xxl, fontWeight: Typography.black, marginBottom: Spacing.sm },
  doneSubtitle: { color: Colors.textMuted, fontSize: Typography.base, marginBottom: Spacing.xxl },
  receipt: { width: '100%', backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  receiptLabel: { color: Colors.textMuted, fontSize: Typography.sm },
  receiptValue: { color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.semibold, maxWidth: '60%', textAlign: 'right' },
  waBtn: {
    backgroundColor: '#25D366' + '20', borderWidth: 1, borderColor: '#25D366' + '50',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.xl,
    width: '100%', alignItems: 'center',
  },
  waBtnText: { color: '#25D366', fontWeight: Typography.bold },
});
