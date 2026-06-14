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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Badge } from '../components/ui';
import { userApi, authApi, MeResponse } from '../../src/lib/api';
import { useStore } from '../store/useStore';
import KycModal from './modals/KycModal';

const BIO_KEY = 'cw_biometric_enabled';

// Mapping statut KYC → badge.
const KYC_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  APPROVED: { label: '✓ Vérifié', color: Colors.primary, bg: Colors.primaryLight },
  PENDING: { label: '⏳ En attente', color: Colors.yellow, bg: Colors.yellow + '20' },
  SUBMITTED: { label: '⏳ En revue', color: Colors.yellow, bg: Colors.yellow + '20' },
  REJECTED: { label: '✕ Rejeté', color: Colors.red, bg: Colors.errorBg },
};

const initials = (name?: string | null, phone?: string) =>
  name
    ? name.split(/\s+/).map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : (phone ?? '?').replace(/\D/g, '').slice(-2);

const fcfa = (centimes: number) => Math.round(centimes / 100).toLocaleString('fr-FR');

interface ProfileScreenProps {
  onLogout: () => void;
}

export default function ProfileScreen({ onLogout }: ProfileScreenProps) {
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
    AsyncStorage.getItem(BIO_KEY).then((v) => setBiometric(v === '1'));
  }, []);

  const openEdit = () => {
    if (!me) return;
    setForm({
      fullName: me.fullName ?? '',
      email: me.email ?? '',
      city: me.city ?? '',
      dateOfBirth: me.dateOfBirth ? me.dateOfBirth.slice(0, 10) : '',
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await userApi.updateProfile({
        fullName: form.fullName.trim() || undefined,
        email: form.email.trim() || undefined,
        city: form.city.trim() || undefined,
        dateOfBirth: form.dateOfBirth.trim() || undefined,
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

  const changePin = () => {
    const phone = me?.phone;
    if (!phone) return;
    Alert.alert(
      'Changer le PIN',
      'Un code OTP vous sera envoyé par SMS pour sécuriser le changement.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer le code',
          onPress: async () => {
            try {
              await authApi.requestPinReset(phone);
              Alert.alert('Code envoyé', 'Saisissez le code OTP reçu par SMS pour définir un nouveau PIN.');
            } catch (e: any) {
              Alert.alert('Erreur', e?.response?.data?.message ?? "Échec de l'envoi");
            }
          },
        },
      ],
    );
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
    await AsyncStorage.setItem(BIO_KEY, value ? '1' : '0');
  };

  const handleLogout = () => {
    Alert.alert('Se déconnecter', 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: onLogout },
    ]);
  };

  const name = me?.fullName ?? storeUser?.name ?? 'Utilisateur';
  const phone = me?.phone ?? '';
  const kyc = KYC_BADGE[me?.kycStatus ?? 'PENDING'] ?? KYC_BADGE.PENDING;
  const memberSince = me?.createdAt
    ? new Date(me.createdAt).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile card */}
      <LinearGradient colors={['#0d2a1f', '#0a1628']} style={styles.profileCard}>
        <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8} style={styles.profileAvatar}>
          {me?.avatarUrl ? (
            <Image source={{ uri: me.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.profileAvatarText}>{initials(name, phone)}</Text>
          )}
          <View style={styles.avatarEditBadge}>
            {uploading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.avatarEditIcon}>📷</Text>}
          </View>
        </TouchableOpacity>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profilePhone}>+237 {phone}</Text>
          {me?.email ? <Text style={styles.profilePhone}>{me.email}</Text> : null}
          {me?.city ? <Text style={styles.profilePhone}>📍 {me.city}</Text> : null}
          <View style={styles.profileBadges}>
            <Badge label={kyc.label} color={kyc.color} bg={kyc.bg} />
            <Badge label="🇨🇲 XAF" color={Colors.blue} bg={Colors.infoBg} />
          </View>
        </View>
      </LinearGradient>

      {error && <Text style={styles.errorText}>{error}</Text>}
      {loading && !me ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.xl }} />
      ) : (
        <>
          <TouchableOpacity style={styles.editBtn} onPress={openEdit} activeOpacity={0.8}>
            <Text style={styles.editBtnText}>✏️  Modifier le profil</Text>
          </TouchableOpacity>

          {me && me.kycStatus !== 'APPROVED' && (
            <TouchableOpacity style={styles.kycBtn} onPress={() => setKycOpen(true)} activeOpacity={0.85}>
              <Text style={styles.kycBtnText}>
                {me.kycStatus === 'REJECTED' ? '🪪  Re-soumettre mon KYC' : me.kycStatus === 'SUBMITTED' ? '🪪  KYC en revue — re-soumettre' : '🪪  Vérifier mon identité (KYC)'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Edit form (inline) */}
          {editing && (
            <View style={styles.editCard}>
              {([
                ['fullName', 'Nom complet', 'Jean Dupont'],
                ['email', 'Email', 'jean@example.cm'],
                ['city', 'Ville', 'Douala'],
                ['dateOfBirth', 'Date de naissance (AAAA-MM-JJ)', '1995-04-23'],
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

          {/* Sécurité */}
          <View style={styles.menuGroup}>
            <Text style={styles.groupLabel}>Sécurité</Text>
            <TouchableOpacity style={styles.menuItem} onPress={changePin} activeOpacity={0.7}>
              <View style={styles.menuItemIcon}><Text style={{ fontSize: 20 }}>🔒</Text></View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Changer le PIN</Text>
                <Text style={styles.menuItemDesc}>Code OTP requis</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
            <View style={styles.menuItem}>
              <View style={styles.menuItemIcon}><Text style={{ fontSize: 20 }}>🧬</Text></View>
              <View style={styles.menuItemInfo}>
                <Text style={styles.menuItemLabel}>Connexion biométrique</Text>
                <Text style={styles.menuItemDesc}>Face ID / empreinte</Text>
              </View>
              <Switch
                value={biometric}
                onValueChange={toggleBiometric}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>
        </>
      )}

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
        <Text style={styles.logoutText}>🚪 Se déconnecter</Text>
      </TouchableOpacity>

      <Text style={styles.version}>CamWallet v1.2.0 · Marché Cameroun 🇨🇲</Text>
      <View style={{ height: 80 }} />

      <KycModal visible={kycOpen} onClose={() => setKycOpen(false)} onSubmitted={load} />
    </ScrollView>
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
  avatarEditIcon: { fontSize: 12 },
  profileAvatarText: { color: Colors.primary, fontWeight: Typography.black, fontSize: Typography.xl },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { color: Colors.text, fontSize: Typography.lg, fontWeight: Typography.black },
  profilePhone: { color: Colors.textMuted, fontSize: Typography.sm },
  profileBadges: { flexDirection: 'row', gap: Spacing.sm, marginTop: 6, flexWrap: 'wrap' },
  errorText: { color: Colors.red, textAlign: 'center', marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  editBtn: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.lg,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.lg, padding: Spacing.md, alignItems: 'center',
  },
  editBtnText: { color: Colors.text, fontSize: Typography.base, fontWeight: Typography.semibold },
  kycBtn: {
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
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: BorderRadius.sm, padding: Spacing.md, color: Colors.text, fontSize: Typography.base,
  },
  formBtn: { flex: 1, borderRadius: BorderRadius.sm, padding: Spacing.md, alignItems: 'center' },
  cancelBtn: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { color: Colors.textSoft, fontWeight: Typography.semibold },
  saveBtn: { backgroundColor: Colors.primary },
  saveBtnText: { color: '#fff', fontWeight: Typography.bold },
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
    color: Colors.textMuted, fontSize: Typography.xs, fontWeight: Typography.bold,
    letterSpacing: 1, textTransform: 'uppercase', marginBottom: Spacing.sm,
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
  chevron: { color: Colors.textMuted, fontSize: 20 },
  logoutBtn: {
    margin: Spacing.lg, marginTop: 0,
    backgroundColor: Colors.errorBg, borderWidth: 1, borderColor: Colors.red + '40',
    borderRadius: BorderRadius.lg, padding: Spacing.lg, alignItems: 'center',
  },
  logoutText: { color: Colors.red, fontSize: Typography.base, fontWeight: Typography.bold },
  version: {
    color: Colors.textMuted, fontSize: Typography.xs, textAlign: 'center',
    marginBottom: Spacing.md,
  },
});
