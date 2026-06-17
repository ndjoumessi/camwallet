import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Button } from '../components/ui';
import { useStore } from '../store/useStore';

const BIO_KEY = 'cw_biometric_enabled';

interface LoginScreenProps {
  onSuccess: () => void;
  onRegister?: () => void;
}

export default function LoginScreen({ onSuccess, onRegister }: LoginScreenProps) {
  const { t } = useTranslation();
  const login = useStore((s) => s.login);
  const restoreSession = useStore((s) => s.restoreSession);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  const [phone, setPhone] = useState('+237');
  const [pin, setPin] = useState('');
  const pinRef = useRef<TextInput>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [showBioPrompt, setShowBioPrompt] = useState(false);

  const isPhoneValid = /^\+237[62]\d{8}$/.test(phone.trim().replace(/\s/g, ''));
  const canSubmit = isPhoneValid && pin.length === 6 && !loading;

  // Pré-remplit les identifiants du compte de démonstration (l'utilisateur n'a
  // plus qu'à appuyer sur « Se connecter »). Disponible y compris en production.
  const fillDemo = useCallback(() => {
    setPhone('+237677000001');
    setPin('123456');
    pinRef.current?.blur();
  }, []);

  // Vérifie si la biométrie est activée et disponible
  useEffect(() => {
    (async () => {
      try {
        const hasHw = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const enabled = await SecureStore.getItemAsync(BIO_KEY);
        setBioAvailable(hasHw && enrolled);
        setBioEnabled(hasHw && enrolled && enabled === '1');
      } catch {
        // Biométrie indisponible sur cet appareil/émulateur
      }
    })();
  }, []);

  const handleLogin = async () => {
    try {
      await login(phone.trim(), pin);
      // Après un login réussi avec PIN, proposer d'activer la biométrie si disponible mais pas encore activée
      if (bioAvailable && !bioEnabled) {
        setShowBioPrompt(true);
      } else {
        onSuccess();
      }
    } catch {
      // L'erreur est exposée via le store et affichée ci-dessous.
    }
  };

  const handleBioLogin = useCallback(async () => {
    setBioLoading(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('auth.biometric_prompt.promptMessage'),
        cancelLabel: t('auth.biometric_prompt.cancelLabel'),
        fallbackLabel: t('auth.biometric_prompt.fallbackLabel'),
      });
      if (result.success) {
        const ok = await restoreSession();
        if (ok) {
          onSuccess();
        } else {
          Alert.alert(t('auth.login_screen.alertSessionExpiredTitle'), t('auth.login_screen.alertSessionExpiredMsg'));
        }
      }
    } catch {
      // Biométrie échouée — rester sur l'écran PIN
    } finally {
      setBioLoading(false);
    }
  }, [restoreSession, onSuccess]);

  const handleEnableBio = async () => {
    try {
      await SecureStore.setItemAsync(BIO_KEY, '1');
      setBioEnabled(true);
    } catch {
      // SecureStore indisponible
    }
    setShowBioPrompt(false);
    onSuccess();
  };

  const handleSkipBio = () => {
    setShowBioPrompt(false);
    onSuccess();
  };

  // Modale d'activation biométrique post-login
  if (showBioPrompt) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <View style={styles.container}>
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>₩</Text>
            </View>
            <Text style={styles.title}>
              Cam<Text style={styles.titleGreen}>Wallet</Text>
            </Text>
          </View>
          <View style={styles.bioPromptCard}>
            <Text style={styles.bioPromptIcon}>🔑</Text>
            <Text style={styles.bioPromptTitle}>{t('auth.biometric_prompt.promptTitle')}</Text>
            <Text style={styles.bioPromptDesc}>{t('auth.biometric_prompt.promptDesc')}</Text>
            <Button label={t('auth.biometric_prompt.btnEnable')} onPress={handleEnableBio} style={{ marginTop: Spacing.md }} />
            <Pressable onPress={handleSkipBio} style={styles.skipLink}>
              <Text style={styles.skipText}>{t('auth.biometric_prompt.btnLater')}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          {/* Marque */}
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Text style={styles.logoText}>₩</Text>
            </View>
            <Text style={styles.title}>
              Cam<Text style={styles.titleGreen}>Wallet</Text>
            </Text>
            <Text style={styles.subtitle}>{t('auth.login_screen.subtitle')}</Text>
          </View>

          {/* Bouton biométrique (si activé) */}
          {bioEnabled && (
            <Pressable
              style={({ pressed }) => [styles.bioBtn, pressed && styles.pressed]}
              onPress={handleBioLogin}
              disabled={bioLoading || loading}
              accessibilityRole="button"
              accessibilityLabel={t('auth.login_screen.bioBtn.a11y')}
            >
              {bioLoading
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={styles.bioBtnIcon}>🔑</Text>
              }
              <Text style={styles.bioBtnText}>
                {bioLoading ? t('auth.login_screen.bioBtn.loading') : t('auth.login_screen.bioBtn.label')}
              </Text>
            </Pressable>
          )}

          {/* Séparateur si biométrie visible */}
          {bioEnabled && (
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>{t('auth.login_screen.divider')}</Text>
              <View style={styles.divider} />
            </View>
          )}

          {/* Téléphone */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('auth.login_screen.phoneLabel')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder={t('auth.login_screen.phonePlaceholder')}
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t('auth.login_screen.phoneA11y')}
              editable={!loading}
              returnKeyType="next"
              onSubmitEditing={() => pinRef.current?.focus()}
              blurOnSubmit={false}
            />
          </View>

          {/* PIN */}
          <View style={styles.field}>
            <Text style={styles.label}>{t('auth.login_screen.pinLabel')}</Text>
            <TextInput
              ref={pinRef}
              style={styles.input}
              value={pin}
              onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              accessibilityLabel={t('auth.login_screen.pinA11y')}
              editable={!loading}
              returnKeyType="done"
              onSubmitEditing={() => { if (canSubmit) handleLogin(); }}
            />
            <View style={styles.pinDots}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View
                  key={i}
                  style={[styles.pinDot, i < pin.length && styles.pinDotFilled]}
                />
              ))}
            </View>
          </View>

          {error ? <Text style={styles.error} numberOfLines={3}>{error}</Text> : null}

          <Button
            label={t('auth.login_screen.btnSubmit')}
            onPress={handleLogin}
            loading={loading}
            disabled={!canSubmit}
            style={styles.submit}
          />

          {onRegister ? (
            <Pressable
              onPress={onRegister}
              style={({ pressed }) => [styles.registerLink, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('auth.login_screen.createAccount')}
            >
              <Text style={styles.registerText}>
                {t('auth.login_screen.noAccount')}{' '}
                <Text style={styles.registerTextGreen}>{t('auth.login_screen.createAccount')}</Text>
              </Text>
            </Pressable>
          ) : null}

          <Button
            label={t('auth.login_screen.demoBtn')}
            onPress={fillDemo}
            variant="secondary"
            icon="flask-outline"
            disabled={loading}
            style={styles.demoBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },

  brand: { alignItems: 'center', marginBottom: Spacing.huge },
  logo: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  logoText: { color: Colors.white, fontWeight: Typography.black, fontSize: Typography.display },
  title: { fontSize: Typography.hero, fontWeight: Typography.black, color: Colors.text },
  titleGreen: { color: Colors.primary },
  subtitle: {
    fontSize: Typography.base,
    color: Colors.textSoft,
    marginTop: Spacing.sm,
  },

  // Bouton biométrique
  bioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary + '50',
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  bioBtnIcon: { fontSize: 20 },
  bioBtnText: {
    color: Colors.primary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },

  // Séparateur
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.xl, gap: Spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textMuted, fontSize: Typography.xs },

  field: { marginBottom: Spacing.xl },
  label: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSoft,
    marginBottom: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    fontSize: Typography.lg,
    color: Colors.text,
  },

  pinDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  pinDot: {
    width: 12,
    height: 12,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.transparent,
  },
  pinDotFilled: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },

  error: {
    color: Colors.error,
    fontSize: Typography.base,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  submit: { marginTop: Spacing.sm },
  demoBtn: { marginTop: Spacing.lg },

  pressed: { opacity: 0.7 },
  registerLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: Spacing.xl },
  registerText: { color: Colors.textSoft, fontSize: Typography.base },
  registerTextGreen: { color: Colors.primary, fontWeight: Typography.bold },

  hint: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: Typography.sm,
    marginTop: Spacing.xxxl,
  },

  // Prompt d'activation biométrique
  bioPromptCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.md,
  },
  bioPromptIcon: { fontSize: 48 },
  bioPromptTitle: {
    color: Colors.text,
    fontSize: Typography.lg,
    fontWeight: Typography.black,
    textAlign: 'center',
  },
  bioPromptDesc: {
    color: Colors.textSoft,
    fontSize: Typography.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  skipLink: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xl },
  skipText: { color: Colors.textMuted, fontSize: Typography.base },
});
