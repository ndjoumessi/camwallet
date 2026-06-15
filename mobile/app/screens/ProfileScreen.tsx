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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Badge, Skeleton } from '../components/ui';
import { userApi, authApi, MeResponse } from '../../src/lib/api';
import { useStore } from '../store/useStore';
import KycModal from './modals/KycModal';
import { useTheme } from '../context/ThemeContext';
import { useTranslation } from 'react-i18next';
import { setLanguage } from '../../src/i18n';
import * as Haptics from 'expo-haptics';

const BIO_KEY = 'cw_biometric_enabled';
const PUSH_KEY = 'cw_push_enabled';

type IoniconName = keyof typeof Ionicons.glyphMap;

// Mapping statut KYC → badge.
const KYC_BADGE: Record<string, { label: string; icon: IoniconName; color: string; bg: string }> = {
  APPROVED: { label: 'Vérifié', icon: 'checkmark-circle', color: Colors.primary, bg: Colors.primaryLight },
  PENDING: { label: 'En attente', icon: 'time-outline', color: Colors.yellow, bg: Colors.yellow + '20' },
  SUBMITTED: { label: 'En revue', icon: 'time-outline', color: Colors.yellow, bg: Colors.yellow + '20' },
  REJECTED: { label: 'Rejeté', icon: 'close-circle', color: Colors.red, bg: Colors.errorBg },
};

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

  // Édition
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', email: '', city: '', dateOfBirth: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [kycOpen, setKycOpen] = useState(false);
  const { mode: themeMode, toggleTheme } = useTheme();
  const { i18n } = useTranslation();
  const currentLang = i18n.language as 'fr' | 'en';
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
      .catch((e) => setError(e?.response?.data?.message ?? 'Erreur de chargement'))
      .finally(() => setLoading(false));
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
      Alert.alert('Validation', 'Le nom complet doit contenir au moins 2 caractères.');
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      Alert.alert('Validation', "Format d'e-mail invalide.");
      return;
    }
    if (form.dateOfBirth.trim() && !/^\d{2}\/\d{2}\/\d{4}$/.test(form.dateOfBirth.trim())) {
      Alert.alert('Validation', 'Date de naissance : format JJ/MM/AAAA attendu.');
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
      Alert.alert('Erreur', e?.response?.data?.message ?? 'Échec de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission requise', "Autorisez l'accès à la galerie pour changer la photo.");
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
      Alert.alert('Erreur', e?.response?.data?.message ?? "Échec de l'upload");
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
      setPinError('Le PIN actuel doit contenir 6 chiffres.');
      return;
    }
    setPinVerifying(true);
    setPinError(null);
    try {
      await authApi.verifyPin(pinForm.current);
      setPinStep('new');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'PIN actuel incorrect';
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
      setPinError('Le nouveau PIN doit contenir 6 chiffres.');
      return;
    }
    if (next !== confirm) {
      setPinError('Les deux nouveaux PIN ne correspondent pas.');
      return;
    }
    setPinSaving(true);
    setPinError(null);
    try {
      await authApi.changePin(current, next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPinModalOpen(false);
      Alert.alert('PIN modifié', 'Votre PIN a été changé. Reconnectez-vous.');
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Erreur inconnue';
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
        Alert.alert('Indisponible', "Aucune biométrie configurée sur cet appareil.");
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Activer la biométrie' });
      if (!res.success) return;
    }
    setBiometric(value);
    // SecureStore (et non AsyncStorage) pour que LoginScreen lise le même flag.
    await SecureStore.setItemAsync(BIO_KEY, value ? '1' : '0');
  };

  const handleLogout = () => {
    Alert.alert('Se déconnecter', 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: onLogout },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (deletePin.length !== 6) {
      Alert.alert('PIN invalide', 'Saisissez votre PIN à 6 chiffres.');
      return;
    }
    setDeleting(true);
    try {
      // Vérification du PIN via login — si le login échoue, le PIN est incorrect.
      const phone = me?.phone;
      if (!phone) throw new Error('Téléphone introuvable');
      await authApi.login(phone, deletePin);
      // PIN correct : supprimer le compte
      await userApi.deleteAccount();
      onLogout();
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? 'Erreur de suppression';
      if (msg.toLowerCase().includes('pin') || msg.toLowerCase().includes('incorrect') || msg.toLowerCase().includes('invalide')) {
        Alert.alert('PIN incorrect', 'Le code saisi ne correspond pas à votre PIN.');
      } else {
        Alert.alert('Erreur', msg);
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
    ? new Date(me.createdAt).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile card */}
      <LinearGradient colors={['#0d2a1f', '#0a1628']} style={styles.profileCard}>
        <TouchableOpacity
          onPress={pickAvatar}
          activeOpacity={0.8}
          disabled={uploading}
          style={styles.profileAvatar}
          accessibilityRole="button"
          accessibilityLabel="Changer la photo de profil"
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
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profilePhone}>{phone}</Text>
          {me?.email ? <Text style={styles.profilePhone}>{me.email}</Text> : null}
          {me?.city ? (
            <View style={styles.profileLocation}>
              <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
              <Text style={styles.profilePhone}>{me.city}</Text>
            </View>
          ) : null}
          <View style={styles.profileBadges}>
            <Badge label={kyc.label} icon={kyc.icon} color={kyc.color} bg={kyc.bg} />
            <Badge label="XAF" color={Colors.blue} bg={Colors.infoBg} />
            {me?.role === 'MERCHANT' && (
              <Badge label="Marchand" icon="storefront-outline" color={Colors.yellow} bg={Colors.yellow + '20'} />
            )}
          </View>
        </View>
      </LinearGradient>

      {error && (
        <View style={styles.errorWrap}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn} accessibilityRole="button" accessibilityLabel="Réessayer">
            <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
            <Text style={styles.retryText}>Réessayer</Text>
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
            accessibilityLabel="Modifier le profil"
          >
            <Ionicons name="create-outline" size={18} color={Colors.text} />
            <Text style={styles.editBtnText}>Modifier le profil</Text>
          </Pressable>

          {me && me.kycStatus !== 'APPROVED' && (
            <Pressable
              style={({ pressed }) => [styles.kycBtn, pressed && styles.pressed]}
              onPress={() => setKycOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Vérifier mon identité"
            >
              <Ionicons name="card-outline" size={18} color={Colors.yellow} />
              <Text style={styles.kycBtnText}>
                {me.kycStatus === 'REJECTED' ? 'Re-soumettre mon KYC' : me.kycStatus === 'SUBMITTED' ? 'KYC en revue — re-soumettre' : 'Vérifier mon identité (KYC)'}
              </Text>
            </Pressable>
          )}

          {/* Edit form (inline) */}
          {editing && (
            <View style={styles.editCard}>
              {/* Téléphone — lecture seule */}
              <View style={{ marginBottom: Spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Text style={styles.fieldLabel}>Téléphone</Text>
                  <TouchableOpacity
                    onPress={() => setPhoneTooltip((v) => !v)}
                    accessibilityLabel="Pourquoi ce champ est verrouillé"
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
                  <Text style={styles.readonlyNote}>Non modifiable pour des raisons de sécurité</Text>
                )}
                <Text style={styles.readonlyNote}>Pour modifier votre numéro, contactez le support</Text>
              </View>

              {/* Statut KYC — badge uniquement */}
              <View style={{ marginBottom: Spacing.md, opacity: 0.5 }}>
                <Text style={[styles.fieldLabel, { marginBottom: 6 }]}>Statut KYC</Text>
                <Badge label={kyc.label} icon={kyc.icon} color={kyc.color} bg={kyc.bg} />
              </View>

              {/* Devise — lecture seule */}
              <View style={{ marginBottom: Spacing.xl }}>
                <Text style={styles.fieldLabel}>Devise</Text>
                <View style={[styles.input, styles.readonlyInput, { flexDirection: 'row', alignItems: 'center', marginTop: 4 }]}>
                  <Text style={{ color: Colors.textMuted, fontSize: Typography.base }}>XAF — Franc CFA</Text>
                </View>
              </View>

              {/* Champs modifiables */}
              {([
                ['fullName', 'Nom complet', 'Jean Dupont'],
                ['email', 'Email', 'jean@example.cm'],
                ['city', 'Ville', 'Douala'],
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
                  />
                </View>
              ))}

              {/* Date de naissance — verrouillée si KYC approuvé */}
              <View style={{ marginBottom: Spacing.md }}>
                <Text style={styles.fieldLabel}>Date de naissance</Text>
                {me?.kycStatus === 'APPROVED' ? (
                  <>
                    <View style={[styles.input, styles.readonlyInput, { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4 }]}>
                      <Ionicons name="lock-closed-outline" size={14} color={Colors.textMuted} />
                      <Text style={{ color: Colors.textMuted, fontSize: Typography.base, flex: 1 }}>
                        {form.dateOfBirth || '—'}
                      </Text>
                    </View>
                    <Text style={styles.readonlyNote}>Date de naissance non modifiable après vérification KYC</Text>
                  </>
                ) : (
                  <TextInput
                    style={styles.input}
                    value={form.dateOfBirth}
                    onChangeText={(v) => setForm((f) => ({ ...f, dateOfBirth: formatDob(v) }))}
                    placeholder="JJ/MM/AAAA"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="none"
                    keyboardType="numeric"
                  />
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={[styles.formBtn, styles.cancelBtn]} onPress={() => setEditing(false)}>
                  <Text style={styles.cancelBtnText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.formBtn, styles.saveBtn]} onPress={save} disabled={saving}>
                  <Text style={styles.saveBtnText}>{saving ? '…' : 'Enregistrer'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{me?.wallet ? fcfa(me.wallet.balance) : '—'}</Text>
              <Text style={styles.statLabel}>Solde FCFA</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{me?.stats.transactionsCount ?? 0}</Text>
              <Text style={styles.statLabel}>Transactions</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{memberSince}</Text>
              <Text style={styles.statLabel}>Membre depuis</Text>
            </View>
          </View>

          {/* Tableau de bord commerçant */}
          {me?.role === 'MERCHANT' && onMerchant && (
            <View style={styles.menuGroup}>
              <Text style={styles.groupLabel}>Espace commerçant</Text>
              <Pressable
                style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                onPress={onMerchant}
                accessibilityRole="button"
                accessibilityLabel="Tableau de bord commerçant"
              >
                <View style={[styles.menuItemIcon, { backgroundColor: Colors.yellow + '20' }]}>
                  <Ionicons name="storefront-outline" size={20} color={Colors.yellow} />
                </View>
                <View style={styles.menuItemInfo}>
                  <Text style={styles.menuItemLabel}>Tableau de bord marchand</Text>
                  <Text style={styles.menuItemDesc}>Stats, transactions et QR dynamique</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          )}

          {/* Sécurité */}
          <View style={styles.menuGroup}>
            <Text style={styles.groupLabel}>Sécurité</Text>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={openPinModal}
              accessibilityRole="button"
              accessibilityLabel="Changer le PIN"
            >
              <View style={styles.menuItemIcon}>
                <Ionicons name="lock-closed-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Changer le PIN</Text>
                <Text style={styles.menuItemDesc}>Ancien PIN requis</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
            </Pressable>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="finger-print-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Connexion biométrique</Text>
                <Text style={styles.menuItemDesc}>Face ID / empreinte</Text>
              </View>
              <Switch
                value={biometric}
                onValueChange={toggleBiometric}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
                accessibilityLabel="Activer la connexion biométrique"
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name={themeMode === 'dark' ? 'moon-outline' : 'sunny-outline'} size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Mode {themeMode === 'dark' ? 'nuit' : 'clair'}</Text>
                <Text style={styles.menuItemDesc}>Apparence de l'application</Text>
              </View>
              <Switch
                value={themeMode === 'dark'}
                onValueChange={toggleTheme}
                trackColor={{ false: Colors.border, true: Colors.purple }}
                thumbColor="#fff"
                accessibilityLabel="Basculer le mode nuit"
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="notifications-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Notifications push</Text>
                <Text style={styles.menuItemDesc}>Alertes transactions en temps réel</Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={togglePushNotif}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
                accessibilityLabel="Activer les notifications push"
              />
            </View>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}>
                <Ionicons name="language-outline" size={20} color={Colors.text} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Langue</Text>
                <Text style={styles.menuItemDesc}>{currentLang === 'fr' ? 'Français' : 'English'}</Text>
              </View>
              <Switch
                value={currentLang === 'en'}
                onValueChange={() => setLanguage(currentLang === 'fr' ? 'en' : 'fr')}
                trackColor={{ false: Colors.border, true: Colors.blue }}
                thumbColor="#fff"
                accessibilityLabel="Basculer la langue FR / EN"
              />
            </View>
          </View>

          {/* Informations légales */}
          <View style={styles.menuGroup}>
            <Text style={styles.groupLabel}>Informations légales</Text>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => setLegalScreen('cgu')}
              accessibilityRole="button"
              accessibilityLabel="Conditions générales d'utilisation"
            >
              <View style={[styles.menuItemIcon, { backgroundColor: Colors.infoBg }]}>
                <Ionicons name="document-text-outline" size={20} color={Colors.blue} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Conditions d'utilisation</Text>
                <Text style={styles.menuItemDesc}>CGU CamWallet</Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color={Colors.textMuted} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => setLegalScreen('privacy')}
              accessibilityRole="button"
              accessibilityLabel="Politique de confidentialité"
            >
              <View style={[styles.menuItemIcon, { backgroundColor: Colors.infoBg }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Colors.blue} />
              </View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Politique de confidentialité</Text>
                <Text style={styles.menuItemDesc}>Vos données personnelles</Text>
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
        accessibilityLabel="Se déconnecter"
      >
        <Ionicons name="log-out-outline" size={18} color={Colors.red} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>

      {/* Suppression de compte */}
      <Pressable
        style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
        onPress={() => setDeleteStep('confirm')}
        accessibilityRole="button"
        accessibilityLabel="Supprimer le compte"
      >
        <Ionicons name="trash-outline" size={16} color={Colors.red} />
        <Text style={styles.deleteText}>Supprimer mon compte</Text>
      </Pressable>

      <Text style={styles.version}>CamWallet v2.7.2 · Marché Cameroun</Text>
      <View style={{ height: 80 }} />

      <KycModal visible={kycOpen} onClose={() => setKycOpen(false)} onSubmitted={load} />
    </ScrollView>

    {/* Modal : Changement de PIN (étape 1 : ancien PIN — étape 2 : nouveau PIN) */}
    <Modal visible={pinModalOpen} transparent animationType="slide" onRequestClose={() => setPinModalOpen(false)}>
      <View style={styles.deleteOverlay}>
        <View style={[styles.deleteModalCard, { gap: Spacing.md }]}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.primary} />
          <Text style={styles.deleteModalTitle}>Changer le PIN</Text>

          {pinStep === 'current' ? (
            <>
              <Text style={styles.deleteModalDesc}>Étape 1/2 · Confirmez votre PIN actuel.</Text>
              <View style={{ width: '100%' }}>
                <Text style={[styles.deleteModalDesc, { textAlign: 'left', marginBottom: 4 }]}>PIN actuel</Text>
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
                  accessibilityLabel="PIN actuel"
                />
              </View>
              {pinError && <Text style={{ color: Colors.red, fontSize: Typography.xs, textAlign: 'center' }}>{pinError}</Text>}
              <TouchableOpacity
                style={[styles.deleteProceedBtn, { backgroundColor: Colors.primary }, pinVerifying && { opacity: 0.6 }]}
                onPress={handleVerifyCurrentPin}
                disabled={pinVerifying}
              >
                <Text style={styles.deleteProceedText}>{pinVerifying ? 'Vérification…' : 'Continuer'}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.deleteModalDesc}>Étape 2/2 · Choisissez votre nouveau PIN.</Text>
              {([
                { key: 'next', label: 'Nouveau PIN' },
                { key: 'confirm', label: 'Confirmer le nouveau PIN' },
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
                <Text style={styles.deleteProceedText}>{pinSaving ? 'Modification…' : 'Confirmer'}</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity onPress={() => setPinModalOpen(false)}>
            <Text style={styles.deleteCancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Modal : Écrans légaux (CGU + Confidentialité) */}
    <Modal visible={!!legalScreen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLegalScreen(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }} edges={['top']}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
          <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold }}>
            {legalScreen === 'cgu' ? "Conditions d'utilisation" : 'Politique de confidentialité'}
          </Text>
          <Pressable onPress={() => setLegalScreen(null)} accessibilityRole="button" accessibilityLabel="Fermer">
            <Ionicons name="close" size={24} color={Colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: Spacing.xl, paddingBottom: 80 }}>
          {legalScreen === 'cgu' ? (
            <>
              <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold, marginBottom: Spacing.md }}>Conditions Générales d'Utilisation</Text>
              <Text style={{ color: Colors.textMuted, fontSize: Typography.xs, marginBottom: Spacing.xl }}>Dernière mise à jour : juin 2026</Text>
              {[
                ['1. Objet', "CamWallet est un service de paiement par QR-code destiné au marché camerounais. Le Crédit QR est un solde interne prépayé, distinct d'un compte bancaire."],
                ['2. Conditions d\'accès', "L'accès est réservé aux personnes physiques résidant au Cameroun, majeures ou munies d'une autorisation parentale. L'inscription requiert un numéro de téléphone valide (+237)."],
                ['3. Utilisation du service', "Le service permet le transfert P2P, le paiement QR chez les commerçants partenaires, la recharge et le retrait via Orange Money ou MTN Mobile Money."],
                ['4. Sécurité', "Vous êtes responsable de la confidentialité de votre PIN à 6 chiffres. En cas de perte de téléphone, contactez immédiatement le support pour bloquer votre compte."],
                ['5. Limites financières', "Limites par transaction : 500 000 FCFA. Limites journalières définies par les opérateurs partenaires. CamWallet se réserve le droit de modifier ces limites."],
                ['6. Responsabilité', "CamWallet ne peut être tenu responsable des interruptions de service des opérateurs tiers (Orange Money, MTN MoMo) ou de force majeure."],
                ['7. Résiliation', "Vous pouvez supprimer votre compte depuis l'onglet Profil. Le solde restant sera perdu si non retiré préalablement."],
                ['8. Contact', "Support : support@camwallet.cm · WhatsApp : +237 600 000 000"],
              ].map(([title, body]) => (
                <View key={title as string} style={{ marginBottom: Spacing.xl }}>
                  <Text style={{ color: Colors.text, fontSize: Typography.base, fontWeight: Typography.bold, marginBottom: Spacing.sm }}>{title}</Text>
                  <Text style={{ color: Colors.textSoft, fontSize: Typography.sm, lineHeight: 22 }}>{body}</Text>
                </View>
              ))}
            </>
          ) : (
            <>
              <Text style={{ color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.bold, marginBottom: Spacing.md }}>Politique de confidentialité</Text>
              <Text style={{ color: Colors.textMuted, fontSize: Typography.xs, marginBottom: Spacing.xl }}>Dernière mise à jour : juin 2026</Text>
              {[
                ['Données collectées', "Nom complet, numéro de téléphone, date de naissance, ville, adresse e-mail (optionnelle), photo de profil, documents KYC (CNI recto-verso + selfie)."],
                ['Finalité', "Vérification d'identité (KYC), prévention de la fraude, conformité ANIF/COBAC, fourniture du service de paiement, notifications transactionnelles."],
                ['Conservation', "Vos données sont conservées 5 ans après la clôture du compte, conformément aux obligations légales camerounaises."],
                ['Partage', "Nous ne vendons jamais vos données. Elles peuvent être partagées avec les autorités réglementaires (ANIF) en cas d'obligation légale."],
                ['Vos droits', "Accès, rectification, suppression de vos données : envoyez votre demande à privacy@camwallet.cm. Délai de réponse : 30 jours."],
                ['Sécurité', "Données chiffrées en transit (TLS 1.3) et au repos. PIN stocké sous forme de hash bcrypt (coût 12). Tokens JWT avec expiration courte."],
                ['Contact DPO', "Délégué à la Protection des Données : dpo@camwallet.cm"],
              ].map(([title, body]) => (
                <View key={title as string} style={{ marginBottom: Spacing.xl }}>
                  <Text style={{ color: Colors.text, fontSize: Typography.base, fontWeight: Typography.bold, marginBottom: Spacing.sm }}>{title}</Text>
                  <Text style={{ color: Colors.textSoft, fontSize: Typography.sm, lineHeight: 22 }}>{body}</Text>
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
          <Text style={styles.deleteModalTitle}>Supprimer le compte ?</Text>
          <Text style={styles.deleteModalDesc}>
            Cette action est irréversible. Toutes vos données seront désactivées. Votre solde restant sera perdu.
          </Text>
          <TouchableOpacity style={styles.deleteProceedBtn} onPress={() => setDeleteStep('pin')}>
            <Text style={styles.deleteProceedText}>Oui, continuer</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setDeleteStep('idle')}>
            <Text style={styles.deleteCancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Modal 2 : confirmation PIN */}
    <Modal visible={deleteStep === 'pin'} transparent animationType="slide" onRequestClose={() => { setDeleteStep('idle'); setDeletePin(''); }}>
      <View style={styles.deleteOverlay}>
        <View style={styles.deleteModalCard}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.red} />
          <Text style={styles.deleteModalTitle}>Confirmez avec votre PIN</Text>
          <Text style={styles.deleteModalDesc}>Saisissez votre PIN à 6 chiffres pour confirmer la suppression définitive.</Text>
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
            accessibilityLabel="PIN de confirmation suppression"
          />
          <TouchableOpacity
            style={[styles.deleteProceedBtn, deleting && { opacity: 0.6 }]}
            onPress={handleDeleteAccount}
            disabled={deleting}
          >
            <Text style={styles.deleteProceedText}>{deleting ? 'Suppression…' : 'Supprimer définitivement'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setDeleteStep('idle'); setDeletePin(''); }}>
            <Text style={styles.deleteCancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.black },
  statLabel: { color: Colors.textMuted, fontSize: Typography.xs, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  menuGroup: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.xl },
  groupLabel: {
    color: Colors.textMuted, fontSize: Typography.sm, fontWeight: Typography.semibold,
    marginBottom: Spacing.sm,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm,
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
