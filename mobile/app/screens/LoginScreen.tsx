import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Button } from '../components/ui';
import { useStore } from '../store/useStore';

interface LoginScreenProps {
  onSuccess: () => void;
  onRegister?: () => void;
}

export default function LoginScreen({ onSuccess, onRegister }: LoginScreenProps) {
  const login = useStore((s) => s.login);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  const [phone, setPhone] = useState('+237');
  const [pin, setPin] = useState('');

  const canSubmit = phone.trim().length >= 8 && pin.length === 6 && !loading;

  const handleLogin = async () => {
    try {
      await login(phone.trim(), pin);
      onSuccess();
    } catch {
      // L'erreur est exposée via le store et affichée ci-dessous.
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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
            <Text style={styles.subtitle}>Connectez-vous pour continuer</Text>
          </View>

          {/* Téléphone */}
          <View style={styles.field}>
            <Text style={styles.label}>Numéro de téléphone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="+237 6XX XXX XXX"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {/* PIN */}
          <View style={styles.field}>
            <Text style={styles.label}>Code PIN</Text>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))}
              placeholder="••••••"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              editable={!loading}
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

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label="Se connecter"
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
              accessibilityLabel="Créer un compte"
            >
              <Text style={styles.registerText}>
                Pas encore de compte ?{' '}
                <Text style={styles.registerTextGreen}>Créer un compte</Text>
              </Text>
            </Pressable>
          ) : null}

          <Text style={styles.hint}>Test : +237677000001 · PIN 123456</Text>
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
});
