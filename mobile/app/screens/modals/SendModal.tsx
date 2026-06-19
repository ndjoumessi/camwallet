import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
  ActivityIndicator,
  Dimensions,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius, Animation } from '../../constants/theme';
import { Avatar, Button, IconButton } from '../../components/ui';
import { useStore } from '../../store/useStore';
import { authApi } from '../../../src/lib/api';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

interface SendModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  initialContact?: number;
  initialRecipient?: { name?: string; phone: string; amount?: string } | null;
}

const FRAIS = 0; // Les frais P2P sont calculés côté backend
const WHATSAPP_GREEN = '#25D366';

const normalizePhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('237') && digits.length >= 12) return '+' + digits;
  if (digits.length === 9) return '+237' + digits;
  return phone;
};

const fmtPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('237')) return `+237 ${digits.slice(3)}`;
  return `+237 ${digits}`;
};

// Groupe les chiffres locaux par 3 : "677000001" → "677 000 001".
const groupLocal = (digits: string): string => digits.replace(/(\d{3})(?=\d)/g, '$1 ');
// Numéro local (9 chiffres, sans +237) extrait d'un numéro complet.
const localDigits = (phone: string): string => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('237') ? d.slice(3) : d;
};
// Normalisation pour recherche : minuscule + sans accents.
const searchNorm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export default function SendModal({ visible, onClose, onSuccess, initialContact, initialRecipient }: SendModalProps) {
  const { user, balance, recentContacts, sendMoney } = useStore();
  const { t } = useTranslation();
  const [step, setStep] = useState<'contact' | 'amount' | 'pin' | 'done'>('contact');
  const [selectedContact, setSelectedContact] = useState<{ id: number; name: string; phone: string; avatar: string; color: string } | null>(null);
  const [manualPhone, setManualPhone] = useState(''); // chiffres locaux uniquement (sans +237)
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [motif, setMotif] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinErrMsg, setPinErrMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txRef, setTxRef] = useState('');
  const [txDate, setTxDate] = useState('');
  const shake = useRef(new Animated.Value(0)).current;
  const pinErrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendErrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pré-remplit le destinataire depuis un QR scanné et saute à l'étape montant.
  useEffect(() => {
    if (!visible || !initialRecipient) return;
    const phone = initialRecipient.phone.replace(/^\+?237/, '').trim();
    const name = initialRecipient.name ?? `+237 ${phone}`;
    const avatar = (initialRecipient.name
      ? initialRecipient.name.split(/\s+/).map((n) => n[0]).join('')
      : phone
    ).slice(0, 2).toUpperCase();
    setSelectedContact({ id: -1, name, phone, avatar, color: Colors.primary } as any);
    if (initialRecipient.amount) setAmount(initialRecipient.amount.replace(/\D/g, ''));
    setStep('amount');
  }, [visible, initialRecipient]);


  const reset = () => {
    setStep('contact');
    setSelectedContact(null);
    setManualPhone('');
    setAmount('');
    setMotif('');
    setPin('');
    setPinError(false);
    setPinErrMsg('');
    setSending(false);
    setSendError(null);
    setTxRef('');
    setTxDate('');
  };

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

  useEffect(() => {
    return () => {
      if (pinErrTimer.current) clearTimeout(pinErrTimer.current);
      if (sendErrTimer.current) clearTimeout(sendErrTimer.current);
    };
  }, []);

  const animStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  };

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shake]);

  const handlePin = async (digit: string) => {
    if (pin.length >= 6 || sending) return;
    const next = pin + digit;
    setPin(next);
    if (next.length < 6) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSending(true);
    try {
      // Vérification du PIN côté serveur (implémente le lockout après 3 échecs)
      await authApi.login(user.phone, next);
    } catch (e: any) {
      setSending(false);
      const msg: string =
        e?.response?.data?.message ?? e?.message ?? t('send.pin.defaultError');
      setPinErrMsg(msg.length < 60 ? msg : t('send.pin.defaultError'));
      setPinError(true);
      setPin('');
      triggerShake();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      pinErrTimer.current = setTimeout(() => { setPinError(false); setPinErrMsg(''); }, 2000);
      return;
    }

    try {
      // PIN validé — envoi de la transaction
      const recipientPhone = normalizePhone(selectedContact!.phone);
      await sendMoney(recipientPhone, amt, motif || undefined);
      setTxRef(`TX_${Math.random().toString(36).slice(2, 10).toUpperCase()}`);
      setTxDate(new Date().toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }));
      setStep('done');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      const msg: string =
        e?.response?.data?.message ?? e?.message ?? t('send.errorSend');
      setSendError(Array.isArray(msg) ? (msg as string[]).join(', ') : msg);
      setPin('');
      triggerShake();
      sendErrTimer.current = setTimeout(() => setSendError(null), 3000);
    } finally {
      setSending(false);
    }
  };

  const amt = parseInt(amount) || 0;
  const canSend = amt >= 100 && amt <= balance - FRAIS;

  const waText = useMemo(() => encodeURIComponent(
    `🧾 *${t('send.done.waReceipt.title')}*\n━━━━━━━━━━━━━━━━━━\n✅ *${t('send.done.waReceipt.success')}*\n\n` +
    `💰 *${t('send.done.waReceipt.amount')}* ${amt.toLocaleString('fr-FR')} FCFA\n` +
    `💳 *${t('send.done.waReceipt.fees')}* ${FRAIS} FCFA\n` +
    `💵 *${t('send.done.waReceipt.total')}* ${(amt + FRAIS).toLocaleString('fr-FR')} FCFA\n` +
    `${motif ? `📝 *${t('send.done.waReceipt.reason')}* ${motif}\n` : ''}` +
    `🔖 *${t('send.done.waReceipt.ref')}* ${txRef}\n📅 *${t('send.done.waReceipt.date')}* ${txDate}\n━━━━━━━━━━━━━━━━━━\n_${t('send.done.waReceipt.footer')}_`
  ), [amt, motif, txRef, txDate, t]);

  const renderStep = () => {
    switch (step) {
      case 'contact': {
        const canUseManual = manualPhone.length === 9;
        const q = searchNorm(search.trim());
        const qDigits = search.replace(/\D/g, '');
        const filteredContacts = q
          ? recentContacts.filter(
              (c) => searchNorm(c.name).includes(q) || (qDigits.length > 0 && c.phone.replace(/\D/g, '').includes(qDigits)),
            )
          : recentContacts;
        return (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Saisie manuelle d'un numéro — préfixe +237 fixe + formatage temps réel */}
            <Text style={styles.sectionLabel}>{t('send.contact.sectionLabel')}</Text>
            <View style={styles.phoneInputRow}>
              <View style={styles.phoneField}>
                <Text style={styles.phonePrefix}>+237</Text>
                <View style={styles.phoneSeparator} />
                <TextInput
                  style={styles.phoneLocalInput}
                  value={groupLocal(manualPhone)}
                  onChangeText={(v) => setManualPhone(v.replace(/\D/g, '').slice(0, 9))}
                  placeholder={t('send.contact.phonePlaceholder')}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  accessibilityLabel={t('send.contact.phoneA11y')}
                />
              </View>
              <TouchableOpacity
                style={[styles.phoneInputBtn, !canUseManual && styles.phoneInputBtnDisabled]}
                disabled={!canUseManual}
                onPress={() => {
                  const phone = normalizePhone(manualPhone);
                  setSelectedContact({ id: -1, name: phone, phone, avatar: phone.slice(-2), color: Colors.primary });
                  setStep('amount');
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('send.contact.continueBtnA11y')}
              >
                <Ionicons name="arrow-forward" size={18} color={Colors.white} />
              </TouchableOpacity>
            </View>

            {/* Contacts récents (dérivés de l'historique) + recherche */}
            {recentContacts.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: Spacing.xl }]}>{t('send.contact.recentSection')}</Text>
                <View style={styles.searchRow}>
                  <Ionicons name="search" size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    value={search}
                    onChangeText={setSearch}
                    placeholder={t('send.contact.searchPlaceholder', { defaultValue: 'Rechercher un nom ou numéro…' })}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel={t('send.contact.searchPlaceholder', { defaultValue: 'Rechercher un nom ou numéro…' })}
                  />
                  {search.length > 0 && (
                    <TouchableOpacity onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
                      <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {filteredContacts.length === 0 ? (
                  <Text style={styles.noContactText}>{t('send.contact.noResults', { defaultValue: 'Aucun contact trouvé' })}</Text>
                ) : (
                  filteredContacts.map((c) => {
                    const frequent = c.count >= 3;
                    return (
                      <TouchableOpacity
                        key={c.phone}
                        style={styles.contactRow}
                        onPress={() => {
                          setSelectedContact({ id: -1, name: c.name, phone: c.phone, avatar: c.initials, color: c.color });
                          setStep('amount');
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${c.name}, ${c.phone}`}
                      >
                        <View>
                          <Avatar initials={c.initials} size={44} color={c.color} bg={c.color + '20'} />
                          <View style={[styles.freqDot, { backgroundColor: frequent ? Colors.primary : Colors.textMuted }]} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
                          <Text style={styles.contactPhone} numberOfLines={1}>
                            {fmtPhone(c.phone)} · {t('send.contact.lastSent', { amount: c.lastAmountFcfa.toLocaleString('fr-FR'), defaultValue: `Dernier envoi : ${c.lastAmountFcfa.toLocaleString('fr-FR')} FCFA` })}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                      </TouchableOpacity>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>
        );
      }

      case 'amount':
        return (
          <ScrollView contentContainerStyle={styles.body}>
            {/* Recipient */}
            {selectedContact && (
              <View style={styles.recipientCard}>
                <Avatar initials={selectedContact.avatar} size={40} color={selectedContact.color} bg={selectedContact.color + '20'} />
                <View>
                  <Text style={styles.contactName}>{selectedContact.name}</Text>
                  <Text style={styles.contactPhone}>{fmtPhone(selectedContact.phone)}</Text>
                </View>
              </View>
            )}

            {/* Amount */}
            <View style={styles.amountWrap}>
              <Text style={styles.amountLabel}>{t('send.amount.amountLabel')}</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={(v) => setAmount(v.replace(/\D/g, ''))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                autoFocus
                accessibilityLabel={t('send.amount.amountA11y')}
              />
              <Text style={styles.amountCurrency}>{t('common.currency')}</Text>
            </View>

            {/* Quick amounts */}
            <View style={styles.quickAmounts}>
              {[1000, 2000, 5000, 10000].map((q) => (
                <TouchableOpacity
                  key={q}
                  style={[styles.quickBtn, parseInt(amount) === q && styles.quickBtnActive]}
                  onPress={() => setAmount(q.toString())}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${q.toLocaleString('fr-FR')} FCFA`}
                >
                  <Text style={[styles.quickBtnText, parseInt(amount) === q && styles.quickBtnTextActive]}>
                    {(q / 1000).toLocaleString('fr-FR')}k
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Motif */}
            <View style={styles.motifRow}>
              <TextInput
                style={styles.motifInput}
                value={motif}
                onChangeText={(v) => setMotif(v.slice(0, 60))}
                placeholder={t('send.amount.motifPlaceholder')}
                placeholderTextColor={Colors.textMuted}
                maxLength={60}
                returnKeyType="done"
                accessibilityLabel={t('send.amount.motifA11y')}
              />
              <Text style={styles.motifCount}>{motif.length}/60</Text>
            </View>

            {/* Fees */}
            {amt > 0 && (
              <View style={styles.feeBox}>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{t('send.amount.feeLabel')}</Text>
                  <Text style={styles.feeVal}>{amt.toLocaleString('fr-FR')} {t('common.currency')}</Text>
                </View>
                <View style={styles.feeRow}>
                  <Text style={styles.feeLabel}>{t('send.amount.feesLabel')}</Text>
                  <Text style={styles.feeVal}>{FRAIS} {t('common.currency')}</Text>
                </View>
                <View style={[styles.feeRow, { borderTopWidth: 1, borderTopColor: Colors.yellow + '30', marginTop: 4, paddingTop: 8 }]}>
                  <Text style={[styles.feeLabel, { color: Colors.text }]}>{t('send.amount.totalLabel')}</Text>
                  <Text style={[styles.feeVal, { color: Colors.yellow, fontWeight: Typography.bold }]}>
                    {(amt + FRAIS).toLocaleString('fr-FR')} {t('common.currency')}
                  </Text>
                </View>
              </View>
            )}

            <Button label={t('send.amount.btnContinue')} icon="arrow-forward" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setStep('pin'); }} disabled={!canSend} fullWidth />
          </ScrollView>
        );

      case 'pin':
        return (
          <View style={styles.pinContainer}>
            <Text style={styles.pinTitle}>{t('send.pin.title')}</Text>
            <Text style={styles.pinSubtitle}>
              {t('send.pin.subtitle', { amount: amt.toLocaleString('fr-FR'), name: selectedContact?.name })}
            </Text>

            {(pinError || sendError) && (
              <Text style={styles.pinErrorText}>{sendError ?? pinErrMsg}</Text>
            )}

            <Animated.View style={[styles.pinDots, { transform: [{ translateX: shake }] }]}>
              {Array(6).fill(0).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    pin.length > i
                      ? [styles.pinDotFilled, (pinError || sendError) && { backgroundColor: Colors.red }]
                      : styles.pinDotEmpty,
                  ]}
                />
              ))}
            </Animated.View>

            {sending && <ActivityIndicator color={Colors.primary} style={{ marginBottom: Spacing.md }} />}

            <View style={styles.pinGrid}>
              {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => {
                const isBackspace = k === '⌫';
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.pinKey, k === '' && styles.pinKeyEmpty]}
                    onPress={() => {
                      if (k === '' || sending) return;
                      if (isBackspace) setPin(p => p.slice(0, -1));
                      else handlePin(k);
                    }}
                    disabled={k === '' || sending}
                    activeOpacity={0.7}
                    accessibilityRole={k === '' ? undefined : 'button'}
                    accessibilityLabel={k === '' ? undefined : isBackspace ? t('send.pin.deleteA11y') : k}
                  >
                    {isBackspace ? (
                      <Ionicons name="backspace-outline" size={24} color={Colors.text} />
                    ) : k !== '' ? (
                      <Text style={styles.pinKeyText}>{k}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );

      case 'done':
        return (
          <View style={styles.doneContainer}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={48} color={Colors.primary} />
            </View>
            <Text style={styles.doneTitle}>{t('send.done.title')}</Text>
            <Text style={styles.doneSubtitle}>
              {t('send.done.subtitle', { amount: amt.toLocaleString('fr-FR'), name: selectedContact?.name })}
            </Text>

            {/* Receipt */}
            <View style={styles.receipt}>
              {[
                { id: 'from', label: t('send.done.receiptFrom'), value: user.name },
                { id: 'to', label: t('send.done.receiptTo'), value: selectedContact?.name ?? '' },
                { id: 'amount', label: t('send.done.receiptAmount'), value: `${amt.toLocaleString('fr-FR')} ${t('common.currency')}` },
                { id: 'fees', label: t('send.done.receiptFees'), value: `${FRAIS} ${t('common.currency')}` },
                { id: 'total', label: t('send.done.receiptTotal'), value: `${(amt + FRAIS).toLocaleString('fr-FR')} ${t('common.currency')}` },
                ...(motif ? [{ id: 'reason', label: t('send.done.receiptReason'), value: motif }] : []),
                { id: 'ref', label: t('send.done.receiptRef'), value: txRef },
                { id: 'date', label: t('send.done.receiptDate'), value: txDate },
              ].map(({ id, label, value }) => (
                <View key={id} style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>{label}</Text>
                  <Text style={[styles.receiptValue, id === 'total' && { color: Colors.yellow }]}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={styles.waBtn}
              onPress={() => Linking.openURL(`https://wa.me/?text=${waText}`)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('send.done.btnWhatsAppA11y')}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
              <Text style={styles.waBtnText}>{t('send.done.btnWhatsApp')}</Text>
            </TouchableOpacity>

            <Button label={t('send.done.btnFinish')} icon="checkmark-circle" onPress={() => { onSuccess(t('send.done.toastSuccess', { amount: amt.toLocaleString('fr-FR') })); handleClose(); }} fullWidth style={{ marginTop: Spacing.md }} />
          </View>
        );
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.sheet} edges={['top']}>
        <Animated.View style={[styles.flex, animStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>
              {step === 'contact' ? t('send.headerContact')
                : step === 'amount' ? t('send.headerAmount')
                : step === 'pin' ? t('send.headerPin')
                : t('send.headerDone')}
            </Text>
            <IconButton icon="close" onPress={handleClose} accessibilityLabel={t('send.closeBtnA11y')} />
          </View>

          {/* Back button */}
          {(step === 'amount' || step === 'pin') && (
            <View style={styles.backRow}>
              <IconButton
                icon="arrow-back"
                onPress={() => step === 'amount' ? setStep('contact') : setStep('amount')}
                accessibilityLabel={t('send.backA11y')}
                size={20}
              />
              <Text style={styles.backLabel}>{t('send.backLabel')}</Text>
            </View>
          )}

          {renderStep()}
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  backLabel: { color: Colors.textMuted, fontSize: Typography.base },
  body: { padding: Spacing.xl, gap: Spacing.md },
  sectionLabel: {
    color: Colors.textMuted, fontSize: Typography.sm,
    fontWeight: Typography.semibold, marginBottom: Spacing.sm,
  },
  phoneInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md,
  },
  phoneInput: {
    flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, padding: Spacing.md,
    color: Colors.text, fontSize: Typography.base,
  },
  phoneField: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, minHeight: 48,
  },
  phonePrefix: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.bold },
  phoneSeparator: { width: 1, height: 22, backgroundColor: Colors.border, marginHorizontal: Spacing.sm },
  phoneLocalInput: { flex: 1, color: Colors.text, fontSize: Typography.base, paddingVertical: Spacing.md, letterSpacing: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, minHeight: 44, marginBottom: Spacing.md,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: Typography.base, paddingVertical: Spacing.sm },
  noContactText: { color: Colors.textMuted, fontSize: Typography.sm, textAlign: 'center', paddingVertical: Spacing.lg },
  freqDot: {
    position: 'absolute', right: -2, bottom: -2, width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: '#FFFFFF',
  },
  phoneInputBtn: {
    width: 44, height: 44, borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  phoneInputBtnDisabled: { backgroundColor: Colors.border },
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
    borderRadius: BorderRadius.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  quickBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  quickBtnText: { color: Colors.textSoft, fontSize: Typography.sm },
  quickBtnTextActive: { color: Colors.primary, fontWeight: Typography.semibold },
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
    flexDirection: 'row', gap: Spacing.sm,
    backgroundColor: WHATSAPP_GREEN + '20', borderWidth: 1, borderColor: WHATSAPP_GREEN + '50',
    borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.xl,
    width: '100%', alignItems: 'center', justifyContent: 'center', minHeight: 48,
  },
  waBtnText: { color: WHATSAPP_GREEN, fontWeight: Typography.bold },
});
