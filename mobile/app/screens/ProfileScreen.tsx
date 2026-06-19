import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  Switch,
  Alert,
  ActivityIndicator,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, BorderRadius, BALANCE_GRADIENT } from '../constants/theme';
import { Badge, Skeleton } from '../components/ui';
import { userApi, authApi, MeResponse, loyaltyApi, LoyaltyBalance, LoyaltyEvent } from '../../src/lib/api';
import { useStore } from '../store/useStore';
import KycModal from './modals/KycModal';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../../src/i18n';
import * as Haptics from 'expo-haptics';
import { formatDistanceToNow } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { version as APP_VERSION } from '../../package.json'; // source unique de version (release-tracked)

// Icône Ionicons selon la raison du gain de fidélité.
function loyaltyGainIcon(reason: string): keyof typeof Ionicons.glyphMap {
  const r = reason.toLowerCase();
  if (r.includes('kyc')) return 'shield-checkmark-outline';
  if (r.includes('recharg') || r.includes('top up')) return 'add-circle-outline';
  return 'arrow-up-circle-outline'; // envoi P2P par défaut
}

const BIO_KEY = 'cw_biometric_enabled';
const PUSH_KEY = 'cw_push_enabled';

type IoniconName = keyof typeof Ionicons.glyphMap;


const initials = (name?: string | null, phone?: string) =>
  name
    ? name.split(/\s+/).map((n) => n[0] ?? '').filter(Boolean).join('').slice(0, 2).toUpperCase()
    : (phone ?? '?').replace(/\D/g, '').slice(-2);

const fcfa = (centimes: number) => Math.round(centimes / 100).toLocaleString('fr-FR');

// "1995-04-23" → "23/04/1995"
const isoToDmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
// "23/04/1995" → "1995-04-23"
const dmyToIso = (dmy: string) => {
  const [d, m, y] = dmy.split('/');
  return `${y}-${m}-${d}`;
};
// Auto-insère les "/" pendant la saisie (retourne la valeur formatée)
const formatDob = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length > 4) return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
  if (digits.length > 2) return digits.slice(0, 2) + '/' + digits.slice(2);
  return digits;
};

interface ProfileScreenProps {
  onLogout: () => void;
  onMerchant?: () => void;
}

export default function ProfileScreen({ onLogout, onMerchant }: ProfileScreenProps) {
  const storeUser = useStore((s) => s.user);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyBalance | null>(null);
  const [loyaltyHistory, setLoyaltyHistory] = useState<LoyaltyEvent[]>([]);
  const [loyaltyModalOpen, setLoyaltyModalOpen] = useState(false);

  // Édition
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', city: '', dateOfBirth: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  const { mode: themeMode, toggleTheme } = useTheme();
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language as 'fr' | 'en';

  const KYC_BADGE: Record<string, { label: string; icon: IoniconName; color: string; bg: string }> = {
    APPROVED: { label: t('profile.kycBadge.approved'), icon: 'checkmark-circle', color: Colors.primary, bg: Colors.primaryLight },
    PENDING: { label: t('profile.kycBadge.pending'), icon: 'time-outline', color: Colors.yellow, bg: Colors.yellow + '20' },
    SUBMITTED: { label: t('profile.kycBadge.submitted'), icon: 'time-outline', color: Colors.yellow, bg: Colors.yellow + '20' },
    REJECTED: { label: t('profile.kycBadge.rejected'), icon: 'close-circle', color: Colors.red, bg: Colors.errorBg },
  };
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'pin'>('idle');
  const [deletePin, setDeletePin] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [phoneTooltip, setPhoneTooltip] = useState(false);

  // Changement de PIN (flux par étapes : vérification ancien PIN → nouveau PIN)
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinStep, setPinStep] = useState<'current' | 'new'>('current');
  const [pinForm, setPinForm] = useState({ current: '', next: '', confirm: '' });
  const [pinSaving, setPinSaving] = useState(false);
  const [pinVerifying, setPinVerifying] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Notifications push
  const [pushEnabled, setPushEnabled] = useState(true);

  // Écrans légaux
  const [legalScreen, setLegalScreen] = useState<'cgu' | 'privacy' | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    userApi
      .getMe()
      .then((d) => { setMe(d); setError(null); })
      .catch((e) => setError(e?.response?.data?.message ?? t('common.error_loading')))
      .finally(() => setLoading(false));
    // Fidélité (non bloquant — n'empêche pas l'affichage du profil en cas d'erreur).
    loyaltyApi.getBalance().then(setLoyalty).catch(() => {});
    loyaltyApi.getHistory().then(setLoyaltyHistory).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // Le flag biométrie est lu/écrit dans SecureStore (partagé avec LoginScreen).
    SecureStore.getItemAsync(BIO_KEY).then((v) => setBiometric(v === '1')).catch(() => {});
    AsyncStorage.getItem(PUSH_KEY).then((v) => setPushEnabled(v !== '0'));
  }, []);

  const openEdit = () => {
    if (!me) return;
    setForm({
      fullName: me.fullName ?? '',
      email: me.email ?? '',
      city: me.city ?? '',
      dateOfBirth: me.dateOfBirth ? isoToDmy(me.dateOfBirth.slice(0, 10)) : '',
    });
    setPhoneTooltip(false);
    setEditing(true);
  };

  const save = async () => {
    if (form.fullName.trim() && form.fullName.trim().length < 2) {
      Alert.alert(t('profile.alertValidationTitle'), t('profile.alertValidationNameError'));
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      Alert.alert(t('profile.alertValidationTitle'), t('profile.alertValidationEmailError'));
      return;
    }
    if (form.dateOfBirth.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(form.dateOfBirth.trim())) {
      Alert.alert(t('profile.alertValidationTitle'), t('profile.alertValidationDobError'));
      return;
    }
    setSaving(true);
    try {
      const updated = await userApi.updateProfile({
        fullName: form.fullName.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        dateOfBirth: form.dateOfBirth.trim() && me?.kycStatus !== 'APPROVED' ? dmyToIso(form.dateOfBirth.trim()) : undefined,
      });
      setMe((prev) => (prev ? { ...prev, ...updated } : updated));
      setEditing(false);
    } catch (e: any) {
      Alert.alert(t('common.error_title'), e?.response?.data?.message ?? t('profile.alertUpdateError'));
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('profile.alertPermissionTitle'), t('profile.alertPermissionMsg'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setUploading(true);
    try {
      const { avatarUrl } = await userApi.uploadAvatar(result.assets[0].uri);
      setMe((prev) => (prev ? { ...prev, avatarUrl } : prev));
    } catch (e: any) {
      Alert.alert(t('common.error_title'), e?.response?.data?.message ?? t('profile.alertUploadError'));
    } finally {
      setUploading(false);
    }
  };

  const openPinModal = () => {
    setPinForm({ current: '', next: '', confirm: '' });
    setPinStep('current');
    setPinError(null);
    setPinModalOpen(true);
  };

  // Étape 1 : confirme l'ancien PIN via POST /auth/verify-pin avant la saisie du nouveau.
  const handleVerifyCurrentPin = async () => {
    if (pinForm.current.length !== 6) {
      setPinError(t('profile.pinModal.errorCurrentPinLength'));
      return;
    }
    setPinVerifying(true);
    setPinError(null);
    try {
      await authApi.verifyPin(pinForm.current);
      setPinStep('new');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('profile.pinModal.errorCurrentPinFallback');
      setPinError(Array.isArray(msg) ? msg.join(', ') : msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPinVerifying(false);
    }
  };

  // Étape 2 : saisie du nouveau PIN (x2) puis PATCH /auth/change-pin.
  const handleChangePin = async () => {
    const { current, next, confirm } = pinForm;
    if (next.length !== 6 || confirm.length !== 6) {
      setPinError(t('profile.pinModal.errorNewPinLength'));
      return;
    }
    if (next !== confirm) {
      setPinError(t('profile.pinModal.errorNewPinMismatch'));
      return;
    }
    setPinSaving(true);
    setPinError(null);
    try {
      await authApi.changePin(current, next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPinModalOpen(false);
      Alert.alert(t('profile.pinModal.alertChangedTitle'), t('profile.pinModal.alertChangedMsg'));
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('profile.pinModal.errorUnknown');
      setPinError(Array.isArray(msg) ? msg.join(', ') : msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPinSaving(false);
    }
  };

  const togglePushNotif = async (value: boolean) => {
    setPushEnabled(value);
    await AsyncStorage.setItem(PUSH_KEY, value ? '1' : '0');
  };

  const toggleBiometric = async (value: boolean) => {
    if (value) {
      const hasHw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHw || !enrolled) {
        Alert.alert(t('profile.alertBioUnavailableTitle'), t('profile.alertBioUnavailableMsg'));
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: t('profile.biometricPromptMessage') });
      if (!res.success) return;
    }
    setBiometric(value);
    // SecureStore (et non AsyncStorage) pour que LoginScreen lise le même flag.
    await SecureStore.setItemAsync(BIO_KEY, value ? '1' : '0');
  };

  const handleLogout = () => {
    Alert.alert(t('profile.alertLogoutTitle'), t('profile.alertLogoutMsg'), [
      { text: t('profile.alertLogoutCancel'), style: 'cancel' },
      { text: t('profile.alertLogoutConfirm'), style: 'destructive', onPress: onLogout },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (deletePin.length !== 6) {
      Alert.alert(t('profile.alertDeleteInvalidPin'), t('profile.alertDeleteInvalidPinMsg'));
      return;
    }
    setDeleting(true);
    try {
      // Vérification du PIN via login — si le login échoue, le PIN est incorrect.
      const phone = me?.phone;
      if (!phone) throw new Error(t('common.phone_not_found'));
      await authApi.login(phone, deletePin);
      // PIN correct : supprimer le compte
      await userApi.deleteAccount();
      onLogout();
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? t('profile.alertDeleteErrorMsg');
      if (msg.toLowerCase().includes('pin') || msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('invalide')) {
        Alert.alert(t('profile.alertDeletePinWrongTitle'), t('profile.alertDeletePinWrongMsg'));
      } else {
        Alert.alert(t('common.error_title'), msg);
      }
    } finally {
      setDeleting(false);
      setDeletePin('');
      setDeleteStep('idle');
    }
  };

  const name = me?.fullName ?? storeUser?.name ?? 'Utilisateur';
  const phone = me?.phone ?? '';
  const kyc = KYC_BADGE[me?.kycStatus ?? 'PENDING'] ?? KYC_BADGE.PENDING;
  const memberSince = me?.createdAt
    ? new Date(me.createdAt).toLocaleDateString(currentLang === 'fr' ? 'fr-FR' : 'en-US', { month: 'long', year: 'numeric' })
    : '—';
  const relLocale = currentLang === 'fr' ? fr : enUS;
  const relTime = (iso: string) => {
    try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: relLocale }); }
    catch { return ''; }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile card */}
      <LinearGradient colors={BALANCE_GRADIENT} style={styles.profileCard}>
        <TouchableOpacity
          onPress={pickAvatar}
          activeOpacity={0.8}
          disabled={uploading}
          style={styles.profileAvatar}
          accessibilityRole="button"
          accessibilityLabel={t('profile.a11yChangeAvatar')}
        >
          {me?.avatarUrl ? (
            <Image source={{ uri: me.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.profileAvatarText}>{initials(name, phone)}</Text>
          )}
          <View style={styles.avatarEditBadge}>
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="camera" size={12} color={Colors.text} />
            )}
          </View>
        </TouchableOpacity>
        <View style={styles.profileInfo}>
          <View style={styles.profileNameRow}>
            <Text style={styles.profileName}>{name}</Text>
            {me?.kycStatus === 'APPROVED' && (
              <Ionicons name="checkmark-circle" size={18} color={Colors.primary} accessibilityLabel={t('profile.kycBadge.approved')} />
            )}
          </View>
          <Text style={styles.profilePhone}>{phone}</Text>
          {me?.email ? <Text style={styles.profilePhone}>{me.email}</Text> : null}
          {me?.city ? (
            <View style={styles.profileLocation}>
              <Text style={{ fontSize: 13 }}>🇨🇲</Text>
              <Text style={styles.profilePhone}>{me.city}</Text>
            </View>
          ) : null}
          <View style={styles.profileBadges}>
            <Badge label={kyc.label} icon={kyc.icon} color={kyc.color} bg={kyc.bg} />
            <Badge label="XAF" color={Colors.blue} bg={Colors.infoBg} />
            {me?.role === 'MERCHANT' && (
              <Badge label={t('profile.badgeMerchant')} icon="storefront-outline" color={Colors.yellow} bg={Colors.yellow + '20'} />
            )}
          </View>
        </View>
      </LinearGradient>

      {error && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn} accessibilityRole="button" accessibilityLabel={t('common.retry')}>
            <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      )}
      {loading && !me ? (
        <View style={styles.skeletonWrap}>
          {/* Bouton Modifier */}
          <Skeleton height={48} radius={BorderRadius.lg} style={{ marginBottom: Spacing.lg }} />
          {/* Ligne de stats */}
          <Skeleton height={88} radius={BorderRadius.lg} style={{ marginBottom: Spacing.xl }} />
          {/* Items du menu */}
          <Skeleton width="40%" height={12} style={{ marginBottom: Spacing.sm }} />
          <Skeleton height={64} radius={BorderRadius.lg} style={{ marginBottom: Spacing.sm }} />
          <Skeleton height={64} radius={BorderRadius.lg} />
        </View>
      ) : (
        <>
          <Pressable
            style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            onPress={openEdit}
            accessibilityRole="button"
            accessibilityLabel={t('profile.btnEditA11y')}
          >
            <Ionicons name="create-outline" size={18} color={Colors.text} />
            <Text style={styles.editBtnText}>{t('profile.btnEditProfile')}</Text>
          </Pressable>

          {me && me.kycStatus !== 'APPROVED' && (
            <Pressable
              style={({ pressed }) => [styles.kycBtn, pressed && styles.pressed]}
              onPress={() => setKycOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('profile.kycBtnA11y')}
            >
              <Ionicons name="card-outline" size={18} color={Colors.yellow} />
              <Text style={styles.kycBtnText}>
                {me.kycStatus === 'REJECTED' ? t('profile.kycBtnResubmit') : me.kycStatus === 'SUBMITTED' ? t('profile.kycBtnInReview') : t('profile.kycBtnVerify')}
              </Text>
            </Pressable>
          )}

          {/* Programme de fidélité */}
          {!editing && loyalty && (
            <View style={styles.loyaltyCard}>
              <View style={styles.loyaltyHeader}>
                <View style={styles.loyaltyLevelRow}>
                  <Text style={styles.loyaltyEmoji}>{loyalty.level.emoji}</Text>
                  <View>
                    <Text style={styles.loyaltyLevelLabel}>{loyalty.level.label}</Text>
                    <Text style={styles.loyaltyPointsSub}>{t('loyalty.points', { count: loyalty.points })}</Text>
                  </View>
                </View>
                <Ionicons name="ribbon-outline" size={22} color={Colors.primary} />
              </View>

              {/* Barre de progression vers le niveau suivant (avec %) */}
              {loyalty.nextLevel ? (
                <>
                  <View style={styles.loyaltyBarRow}>
                    <View style={styles.loyaltyBarTrack}>
                      <View style={[styles.loyaltyBarFill, { width: `${loyalty.progress}%` }]} />
                    </View>
                    <Text style={styles.loyaltyBarPct}>{loyalty.progress}%</Text>
                  </View>
                  <Text style={styles.loyaltyNextText}>
                    {t('loyalty.toNext', { points: loyalty.pointsToNext, level: loyalty.nextLevel.label })}
                  </Text>
                </>
              ) : (
                <Text style={styles.loyaltyNextText}>{t('loyalty.maxLevel')}</Text>
              )}

              {/* Gains récents : icône + raison + date relative + points */}
              {loyaltyHistory.length > 0 && (
                <View style={styles.loyaltyHistory}>
                  <Text style={styles.loyaltyHistoryTitle}>{t('loyalty.historyTitle')}</Text>
                  {loyaltyHistory.slice(0, 3).map((ev) => (
                    <View key={ev.id} style={styles.loyaltyGainRow}>
                      <View style={styles.loyaltyGainIcon}>
                        <Ionicons name={loyaltyGainIcon(ev.reason)} size={16} color={Colors.primary} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.loyaltyGainReason} numberOfLines={1}>{ev.reason}{ev.amountCentimes != null ? ` · ${fcfa(ev.amountCentimes)} FCFA` : ''}</Text>
                        <Text style={styles.loyaltyGainDate}>{relTime(ev.createdAt)}</Text>
                      </View>
                      <Text style={styles.loyaltyHistoryPoints}>+{ev.points} pts</Text>
                    </View>
                  ))}
                  {loyaltyHistory.length > 3 && (
                    <Pressable
                      onPress={() => setLoyaltyModalOpen(true)}
                      style={styles.loyaltySeeAll}
                      accessibilityRole="button"
                      accessibilityLabel={t('loyalty.seeAll', { defaultValue: 'Voir tout l’historique' })}
                    >
                      <Text style={styles.loyaltySeeAllText}>{t('loyalty.seeAll', { defaultValue: 'Voir tout l’historique' })}</Text>
                      <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Edit form (inline) */}
          {editing && (
            <View style={styles.editCard}>
              {/* Téléphone — lecture seule */}
              <View style={{ marginBottom: Spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.fieldLabel}>{t('profile.edit.phoneLabel')}</Text>
                  <TouchableOpacity
                    onPress={() => setPhoneTooltip((v) => !v)}
                    accessibilityLabel={t('profile.edit.phoneLockA11y')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="lock-closed" size={13} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.input, styles.readonlyInput, { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }]}>
                  <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
                  <Text style={{ color: Colors.textMuted, fontSize: Typography.base, flex: 1 }}>{phone}</Text>
                </View>
                {phoneTooltip && (
                  <Text style={styles.readonlyNote}>{t('profile.edit.phoneReadonlyNote')}</Text>
                )}
                <Text style={styles.readonlyNote}>{t('profile.edit.phoneSupportNote')}</Text>
              </View>

              {/* Statut KYC — badge uniquement */}
              <View style={{ marginBottom: Spacing.md, opacity: 0.5 }}>
                <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>{t('profile.edit.kycStatusLabel')}</Text>
                <Badge label={kyc.label} icon={kyc.icon} color={kyc.color} bg={kyc.bg} />
              </View>

              {/* Devise — lecture seule */}
              <View style={{ marginBottom: Spacing.xl }}>
                <Text style={styles.fieldLabel}>{t('profile.edit.currencyLabel')}</Text>
                <View style={[styles.input, styles.readonlyInput, { flexDirection: 'row', alignItems: 'center', marginTop: 4 }]}>
                  <Text style={{ color: Colors.textMuted, fontSize: Typography.base }}>{t('profile.edit.currencyValue')}</Text>
                </View>
              </View>

              {/* Champs modifiables */}
              {([
                ['fullName', t('profile.edit.fullNameLabel'), t('profile.edit.fullNamePlaceholder')],
                ['email', t('profile.edit.emailLabel'), t('profile.edit.emailPlaceholder')],
                ['city', t('profile.edit.cityLabel'), t('profile.edit.cityPlaceholder')],
              ] as const).map(([key, label, ph]) => (
                <View key={key} style={{ marginBottom: Spacing.md }}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <TextInput
                    style={styles.input}
                    value={(form as any)[key]}
                    onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                    placeholder={ph}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize={key === 'email' ? 'none' : 'words'}
                    keyboardType={key === 'email' ? 'email-address' : 'default'}
                    accessibilityLabel={label}
                  />
                </View>
              ))}

              {/* Date de naissance — verrouillée si KYC approuvé */}
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={styles.fieldLabel}>{t('profile.edit.dobLabel')}</Text>
                {me?.kycStatus === 'APPROVED' ? (
                  <>
                    <View style={[styles.input, styles.readonlyInput, { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 }]}>
                      <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
                      <Text style={{ color: Colors.textMuted, fontSize: Typography.base, flex: 1 }}>
                        {form.dateOfBirth || '—'}
                      </Text>
                    </View>
                    <Text style={styles.readonlyNote}>{t('profile.edit.dobReadonlyNote')}</Text>
                  </>
                ) : (
                  <TextInput
                    style={styles.input}
                    value={form.dateOfBirth}
                    onChangeText={(v) => setForm((f) => ({ ...f, dateOfBirth: formatDob(v) }))}
                    placeholder={t('profile.edit.dobPlaceholder')}
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="numeric"
                  />
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={[styles.formBtn, styles.cancelBtn]} onPress={() => setEditing(false)} accessibilityRole="button" accessibilityLabel={t('profile.edit.btnCancelA11y')}>
                  <Text style={styles.cancelBtnText}>{t('profile.edit.btnCancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.formBtn, styles.saveBtn]} onPress={save} disabled={saving} accessibilityRole="button" accessibilityLabel={t('profile.edit.btnSaveA11y')}>
                  <Text style={styles.saveBtnText}>{saving ? '…' : t('profile.edit.btnSave')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, styles.statValueAccent]}>{me?.wallet ? fcfa(me.wallet.balance) : '—'}</Text>
              <Text style={styles.statLabel}>{t('profile.stats.balance')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{me?.stats.transactionsCount ?? 0}</Text>
              <Text style={styles.statLabel}>{t('profile.stats.transactions')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{memberSince}</Text>
              <Text style={styles.statLabel}>{t('profile.stats.memberSince')}</Text>
            </View>
          </View>

          {/* Tableau de bord commerçant */}
          {me?.role === 'MERCHANT' && onMerchant && (
            <View style={styles.menuGroup}>
              <Text style={styles.groupLabel}>{t('profile.merchant.groupLabel')}</Text>
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                onPress={onMerchant}
                accessibilityRole="button"
                accessibilityLabel={t('profile.merchant.dashboardA11y')}
              >
                <View style={[styles.menuItemIcon, { backgroundColor: Colors.yellow + '20' }]}>
                  <Ionicons name="storefront-outline" size={20} color={Colors.yellow} />
                </View>
                <View style={styles.menuItemInfo}>
                  <Text style={styles.menuItemLabel}>{t('profile.merchant.dashboardLabel')}</Text>
                  <Text style={styles.menuItemDesc}>{t('profile.merchant.dashboardDesc')}</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          )}

          {/* Sécurité */}
          <View style={styles.menuGroup}>
            <Text style={styles.groupLabel}>{t('profile.security_group.groupLabel')}</Text>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={openPinModal}
              accessibilityRole="button"
              accessibilityLabel={t('profile.security_group.changePinA11y')}
            >
              <View style={styles.menuItemIcon}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.security_group.changePinLabel')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.security_group.changePinDesc')}</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
            </Pressable>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="finger-print-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.security_group.biometricLabel')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.security_group.biometricDesc')}</Text>
              </View>
              <Switch
                value={biometric}
                onValueChange={toggleBiometric}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
                accessibilityLabel={t('profile.security_group.biometricA11y')}
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name={themeMode === 'dark' ? 'moon-outline' : 'sunny-outline'} size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t(themeMode === 'dark' ? 'profile.security_group.themeDark' : 'profile.security_group.themeLight')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.security_group.themeDesc')}</Text>
              </View>
              <Switch
                value={themeMode === 'dark'}
                onValueChange={toggleTheme}
                trackColor={{ false: Colors.border, true: Colors.purple }}
                thumbColor="#fff"
                accessibilityLabel={t('profile.security_group.themeA11y')}
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="notifications-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.security_group.pushLabel')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.security_group.pushDesc')}</Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={togglePushNotif}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
                accessibilityLabel={t('profile.security_group.pushA11y')}
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="language-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.security_group.langLabel')}</Text>
                <Text style={styles.menuItemDesc}>{currentLang === 'fr' ? t('profile.security_group.langDescFr') : t('profile.security_group.langDescEn')}</Text>
              </View>
              <Switch
                value={currentLang === 'en'}
                onValueChange={() => setLanguage(currentLang === 'fr' ? 'en' : 'fr')}
                trackColor={{ false: Colors.border, true: Colors.blue }}
                thumbColor="#fff"
                accessibilityLabel={t('profile.security_group.langA11y')}
              />
            </View>
          </View>

          {/* Informations légales */}
          <View style={styles.menuGroup}>
            <Text style={styles.groupLabel}>{t('profile.legal_group.groupLabel')}</Text>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => setLegalScreen('cgu')}
              accessibilityRole="button"
              accessibilityLabel={t('profile.legal_group.cguA11y')}
            >
              <View style={[styles.menuItemIcon, { backgroundColor: Colors.infoBg }]}>
                <Ionicons name="document-text-outline" size={20} color={Colors.blue} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.legal_group.cguLabel')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.legal_group.cguDesc')}</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => setLegalScreen('privacy')}
              accessibilityRole="button"
              accessibilityLabel={t('profile.legal_group.privacyA11y')}
            >
              <View style={[styles.menuItemIcon, { backgroundColor: Colors.infoBg }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Colors.blue} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>{t('profile.legal_group.privacyLabel')}</Text>
                <Text style={styles.menuItemDesc}>{t('profile.legal_group.privacyDesc')}</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>
        </>
      )}

      {/* Logout */}
      <Pressable
        style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
        onPress={handleLogout}
        accessibilityRole="button"
        accessibilityLabel={t('profile.btnLogoutA11y')}
      >
        <Ionicons name="log-out-outline" size={18} color={Colors.red} />
        <Text style={styles.logoutText}>{t('profile.btnLogout')}</Text>
      </Pressable>

      {/* Suppression de compte */}
      <Pressable
        style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
        onPress={() => setDeleteStep('confirm')}
        accessibilityRole="button"
        accessibilityLabel={t('profile.btnDeleteA11y')}
      >
        <Ionicons name="trash-outline" size={16} color={Colors.red} />
        <Text style={styles.deleteText}>{t('profile.btnDeleteAccount')}</Text>
      </Pressable>

      <Text style={styles.version}>{t('profile.versionText', { version: APP_VERSION })}</Text>
      <View style={{ height: 80 }} />

      <KycModal visible={kycOpen} onClose={() => setKycOpen(false)} onSubmitted={load} />
    </ScrollView>

    {/* Modal : Changement de PIN (étape 1 : ancien PIN — étape 2 : nouveau PIN) */}
    <Modal visible={pinModalOpen} transparent animationType="slide" onRequestClose={() => setPinModalOpen(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.deleteOverlay}>
        <View style={[styles.deleteModalCard, { gap: Spacing.md }]}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.primary} />
          <Text style={styles.deleteModalTitle}>{t('profile.pinModal.title')}</Text>

          {pinStep === 'current' ? (
            <>
              <Text style={styles.deleteModalDesc}>{t('profile.pinModal.step1Desc')}</Text>
              <View style={{ width: '100%' }}>
                <Text style={[styles.deleteModalDesc, { textAlign: 'left', marginBottom: 4 }]}>{t('profile.pinModal.step1PinLabel')}</Text>
                <TextInput
                  style={styles.pinInput}
                  value={pinForm.current}
                  onChangeText={(v) => setPinForm((f) => ({ ...f, current: v.replace(/\D/g, '').slice(0, 6) }))}
                  placeholder="• • • • • •"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  secureTextEntry
                  maxLength={6}
                  autoFocus
                  accessibilityLabel={t('profile.pinModal.step1PinLabel')}
                />
              </View>
              {pinError && <Text style={{ color: Colors.red, fontSize: Typography.xs, textAlign: 'center' }}>{pinError}</Text>}
              <TouchableOpacity
                style={[styles.deleteProceedBtn, { backgroundColor: Colors.primary }, pinVerifying && { opacity: 0.6 }]}
                onPress={handleVerifyCurrentPin}
                disabled={pinVerifying}
              >
                <Text style={styles.deleteProceedText}>{pinVerifying ? t('profile.pinModal.step1BtnVerifying') : t('profile.pinModal.step1BtnContinue')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.deleteModalDesc}>{t('profile.pinModal.step2Desc')}</Text>
              {([
                { key: 'next', label: t('profile.pinModal.newPinLabel') },
                { key: 'confirm', label: t('profile.pinModal.confirmNewPinLabel') },
              ] as const).map(({ key, label }) => (
                <View key={key} style={{ width: '100%' }}>
                  <Text style={[styles.deleteModalDesc, { textAlign: 'left', marginBottom: 4 }]}>{label}</Text>
                  <TextInput
                    style={styles.pinInput}
                    value={pinForm[key]}
                    onChangeText={(v) => setPinForm((f) => ({ ...f, [key]: v.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="• • • • • •"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    secureTextEntry
                    maxLength={6}
                    autoFocus={key === 'next'}
                    accessibilityLabel={label}
                  />
                </View>
              ))}
              {pinError && <Text style={{ color: Colors.red, fontSize: Typography.xs, textAlign: 'center' }}>{pinError}</Text>}
              <TouchableOpacity
                style={[styles.deleteProceedBtn, { backgroundColor: Colors.primary }, pinSaving && { opacity: 0.6 }]}
                onPress={handleChangePin}
                disabled={pinSaving}
              >
                <Text style={styles.deleteProceedText}>{pinSaving ? t('profile.pinModal.step2BtnSaving') : t('profile.pinModal.step2BtnConfirm')}</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => setPinModalOpen(false)}>
            <Text style={styles.deleteCancelText}>{t('profile.pinModal.btnCancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Modal : Écrans légaux (CGU + Confidentialité) */}
    <Modal visible={!!legalScreen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLegalScreen(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }} edges={['top']}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold }}>
            {legalScreen === 'cgu' ? t('profile.legalModal.cguTitle') : t('profile.legalModal.privacyTitle')}
          </Text>
          <Pressable onPress={() => setLegalScreen(null)} accessibilityRole="button" accessibilityLabel={t('profile.legalModal.closeBtnA11y')}>
            <Ionicons name="close" size={24} color={Colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 80 }}>
          {legalScreen === 'cgu' ? (
            <>
              <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold, marginBottom: Spacing.md }}>{t('profile.cgu.title')}</Text>
              <Text style={{ color: Colors.textMuted, fontSize: Typography.xs, marginBottom: Spacing.xl }}>{t('profile.cgu.lastUpdate')}</Text>
              {(['s1','s2','s3','s4','s5','s6','s7','s8'] as const).map((key) => (
                <View key={key} style={{ marginBottom: Spacing.xl }}>
                  <Text style={{ color: Colors.text, fontSize: Typography.base, fontWeight: Typography.bold, marginBottom: Spacing.sm }}>{t(`profile.cgu.${key}.title`)}</Text>
                  <Text style={{ color: Colors.textSoft, fontSize: Typography.sm, lineHeight: 22 }}>{t(`profile.cgu.${key}.body`)}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold, marginBottom: Spacing.md }}>{t('profile.privacyPolicy.title')}</Text>
              <Text style={{ color: Colors.textMuted, fontSize: Typography.xs, marginBottom: Spacing.xl }}>{t('profile.privacyPolicy.lastUpdate')}</Text>
              {(['s1','s2','s3','s4','s5','s6','s7'] as const).map((key) => (
                <View key={key} style={{ marginBottom: Spacing.xl }}>
                  <Text style={{ color: Colors.text, fontSize: Typography.base, fontWeight: Typography.bold, marginBottom: Spacing.sm }}>{t(`profile.privacyPolicy.${key}.title`)}</Text>
                  <Text style={{ color: Colors.textSoft, fontSize: Typography.sm, lineHeight: 22 }}>{t(`profile.privacyPolicy.${key}.body`)}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>

    {/* Modal 1 : première confirmation */}
    <Modal visible={deleteStep === 'confirm'} transparent animationType="fade" onRequestClose={() => setDeleteStep('idle')}>
      <View style={styles.deleteOverlay}>
        <View style={styles.deleteModalCard}>
          <Ionicons name="warning-outline" size={36} color={Colors.red} />
          <Text style={styles.deleteModalTitle}>{t('profile.deleteModal1.title')}</Text>
          <Text style={styles.deleteModalDesc}>{t('profile.deleteModal1.desc')}</Text>
          <TouchableOpacity style={styles.deleteProceedBtn} onPress={() => setDeleteStep('pin')}>
            <Text style={styles.deleteProceedText}>{t('profile.deleteModal1.btnContinue')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDeleteStep('idle')}>
            <Text style={styles.deleteCancelText}>{t('profile.deleteModal1.btnCancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Modal 2 : confirmation PIN */}
    <Modal visible={deleteStep === 'pin'} transparent animationType="slide" onRequestClose={() => { setDeleteStep('idle'); setDeletePin(''); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.deleteOverlay}>
        <View style={styles.deleteModalCard}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.red} />
          <Text style={styles.deleteModalTitle}>{t('profile.deleteModal2.title')}</Text>
          <Text style={styles.deleteModalDesc}>{t('profile.deleteModal2.desc')}</Text>
          <TextInput
            style={styles.pinInput}
            value={deletePin}
            onChangeText={(v) => setDeletePin(v.replace(/\D/g, '').slice(0, 6))}
            placeholder="• • • • • •"
            placeholderTextColor={Colors.textMuted}
            keyboardType="numeric"
            secureTextEntry
            maxLength={6}
            autoFocus
            accessibilityLabel={t('profile.deleteModal2.pinA11y')}
          />
          <TouchableOpacity
            style={[styles.deleteProceedBtn, deleting && { opacity: 0.6 }]}
            onPress={handleDeleteAccount}
            disabled={deleting}
          >
            <Text style={styles.deleteProceedText}>{deleting ? t('profile.deleteModal2.btnDeleting') : t('profile.deleteModal2.btnConfirm')}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setDeleteStep('idle'); setDeletePin(''); }}>
            <Text style={styles.deleteCancelText}>{t('profile.deleteModal2.btnCancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Historique complet des gains de fidélité */}
    <Modal visible={loyaltyModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLoyaltyModalOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.bg }} edges={['top', 'bottom']}>
        <View style={styles.loyaltyModalHeader}>
          <Text style={styles.loyaltyModalTitle}>{t('loyalty.historyTitle')}</Text>
          <Pressable onPress={() => setLoyaltyModalOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Ionicons name="close" size={24} color={Colors.text} />
          </Pressable>
        </View>
        <ScrollView style={{ backgroundColor: Colors.bg }} contentContainerStyle={{ paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg }}>
          {loyaltyHistory.map((ev) => (
            <View key={ev.id} style={styles.loyaltyGainRow}>
              <View style={styles.loyaltyGainIcon}>
                <Ionicons name={loyaltyGainIcon(ev.reason)} size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.loyaltyGainReason} numberOfLines={1}>{ev.reason}{ev.amountCentimes != null ? ` · ${fcfa(ev.amountCentimes)} FCFA` : ''}</Text>
                <Text style={styles.loyaltyGainDate}>{relTime(ev.createdAt)}</Text>
              </View>
              <Text style={styles.loyaltyHistoryPoints}>+{ev.points} pts</Text>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  profileCard: {
    margin: Spacing.lg, borderRadius: BorderRadius.xxl,
    padding: Spacing.xl, flexDirection: 'row', alignItems: 'center', gap: Spacing.lg,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  profileAvatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '30', borderWidth: 2, borderColor: Colors.primary + '60',
    alignItems: 'center', justifyContent: 'center', overflow: 'visible',
  },
  avatarImg: { width: 60, height: 60, borderRadius: 30 },
  avatarEditBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  profileAvatarText: { color: Colors.primary, fontWeight: Typography.black, fontSize: Typography.xl },
  profileInfo: { flex: 1, gap: 2 },
  profileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  profileName: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black },
  profilePhone: { color: Colors.textMuted, fontSize: Typography.sm },
  profileLocation: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  profileBadges: { flexDirection: 'row', gap: Spacing.sm, marginTop: 6, flexWrap: 'wrap' },
  pressed: { opacity: 0.7 },
  skeletonWrap: { paddingHorizontal: Spacing.lg, marginTop: Spacing.md },
  errorText: { color: Colors.red, textAlign: 'center', marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  editBtn: {
    flexDirection: 'row', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md,
    alignItems: 'center', justifyContent: 'center',
  },
  editBtnText: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  kycBtn: {
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center',
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg, marginTop: -Spacing.sm,
    backgroundColor: Colors.yellow + '18', borderWidth: 1, borderColor: Colors.yellow + '50',
    borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center',
  },
  kycBtnText: { color: Colors.yellow, fontSize: Typography.base, fontWeight: Typography.bold },
  loyaltyCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg, marginTop: -Spacing.sm,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg,
  },
  loyaltyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  loyaltyLevelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  loyaltyEmoji: { fontSize: 30 },
  loyaltyLevelLabel: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  loyaltyPointsSub: { color: Colors.textMuted, fontSize: Typography.sm },
  loyaltyBarRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  loyaltyBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.border, overflow: 'hidden' },
  loyaltyBarFill: { height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  loyaltyBarPct: { color: Colors.primary, fontSize: Typography.xs, fontWeight: Typography.bold, minWidth: 34, textAlign: 'right' },
  loyaltyNextText: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 6 },
  loyaltyHistory: { marginTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  loyaltyHistoryTitle: { color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold, textTransform: 'uppercase', marginBottom: 6 },
  loyaltyHistoryPoints: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.bold },
  loyaltyGainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  loyaltyGainIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
  loyaltyGainReason: { color: Colors.text, fontSize: Typography.sm, fontWeight: Typography.semibold },
  loyaltyGainDate: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 1 },
  loyaltySeeAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: Spacing.sm, paddingVertical: 6 },
  loyaltySeeAllText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  loyaltyModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border },
  loyaltyModalTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold },
  editCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg,
  },
  fieldLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginBottom: 4 },
  readonlyInput: { opacity: 0.5 },
  readonlyNote: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 4 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text, fontSize: Typography.base,
  },
  formBtn: { flex: 1, borderRadius: BorderRadius.sm, padding: Spacing.md, alignItems: 'center' },
  cancelBtn: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { color: Colors.textSoft, fontWeight: Typography.semibold },
  saveBtn: { backgroundColor: Colors.primary },
  saveBtnText: { color: Colors.bg, fontWeight: Typography.bold },
  statsRow: {
    flexDirection: 'row', backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.xl, padding: Spacing.lg,
  },
  statItem: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statValue: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.black, textAlign: 'center' },
  statValueAccent: { color: Colors.primary },
  statLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2, textAlign: 'center' },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.borderLight, marginHorizontal: Spacing.sm },
  menuGroup: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.xl },
  groupLabel: {
    color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.semibold,
    marginBottom: Spacing.sm,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.lg, marginBottom: Spacing.md,
  },
  menuItemIcon: {
    width: 40, height: 40, borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  menuItemInfo: { flex: 1 },
  menuItemLabel: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  menuItemDesc: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  logoutBtn: {
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center',
    margin: Spacing.lg, marginTop: 0,
    backgroundColor: Colors.errorBg, borderWidth: 1, borderColor: Colors.red + '40',
    borderRadius: BorderRadius.lg, padding: Spacing.lg, alignItems: 'center',
  },
  logoutText: { color: Colors.red, fontSize: Typography.base, fontWeight: Typography.bold },
  errorWrap: { alignItems: 'center', gap: Spacing.xs, marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: Spacing.xs },
  retryText: { color: Colors.primary, fontSize: Typography.sm, fontWeight: Typography.semibold },
  version: {
    color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center',
    marginBottom: Spacing.md,
  },
  deleteBtn: {
    flexDirection: 'row', gap: Spacing.sm, justifyContent: 'center',
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg, marginTop: -Spacing.sm,
    borderWidth: 1, borderColor: Colors.red + '30',
    borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center',
  },
  deleteText: { color: Colors.red, fontSize: Typography.sm, fontWeight: Typography.semibold },
  deleteOverlay: {
    flex: 1, backgroundColor: Colors.overlay,
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  deleteModalCard: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.red + '40',
    borderRadius: BorderRadius.xl, padding: Spacing.xl,
    width: '100%', alignItems: 'center', gap: Spacing.md,
  },
  deleteModalTitle: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black, textAlign: 'center' },
  deleteModalDesc: { color: Colors.textSoft, fontSize: Typography.sm, textAlign: 'center', lineHeight: 20 },
  deleteProceedBtn: {
    backgroundColor: Colors.red, borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl,
    width: '100%', alignItems: 'center',
  },
  deleteProceedText: { color: Colors.bg, fontWeight: Typography.bold, fontSize: Typography.base },
  deleteCancelText: { color: Colors.textMuted, fontSize: Typography.base, padding: Spacing.sm },
  pinInput: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text,
    fontSize: Typography.xl, textAlign: 'center', letterSpacing: 8, width: '100%',
  },
});
