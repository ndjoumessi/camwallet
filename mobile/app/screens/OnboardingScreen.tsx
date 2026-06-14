import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, BorderRadius } from '../constants/theme';
import { Button } from '../components/ui';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'phone-portrait-outline' as const,
    title: 'Paiements instantanés',
    desc: "Scannez un QR Code et payez en 3 secondes, n'importe où au Cameroun.",
    gradient: ['#0d2a1f', Colors.bg],
  },
  {
    icon: 'lock-closed-outline' as const,
    title: 'Sécurisé & fiable',
    desc: 'Chiffrement militaire, PIN à 6 chiffres et alertes SMS en temps réel.',
    gradient: ['#0a1628', Colors.bg],
  },
  {
    icon: 'flash' as const,
    title: 'Rechargez facilement',
    desc: 'Via MTN MoMo, Orange Money ou agents partenaires près de chez vous.',
    gradient: ['#1a1505', Colors.bg],
  },
];

interface OnboardingProps {
  onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<'slides' | 'phone' | 'otp' | 'pin'>('slides');
  const [slideIndex, setSlideIndex] = useState(0);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [pinStep, setPinStep] = useState<'create' | 'confirm'>('create');
  const scrollRef = useRef<ScrollView>(null);
  const shake = useRef(new Animated.Value(0)).current;

  const slideToNext = () => {
    if (slideIndex < SLIDES.length - 1) {
      const next = slideIndex + 1;
      setSlideIndex(next);
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    } else {
      setStep('phone');
    }
  };

  const sendOtp = () => {
    if (phone.length < 9) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setOtpSent(true);
      setStep('otp');
    }, 1200);
  };

  const verifyOtp = () => {
    if (otp !== '847291') {
      triggerShake();
      return;
    }
    setStep('pin');
  };

  const handlePin = (digit: string) => {
    if (pinStep === 'create') {
      const next = pin + digit;
      setPin(next);
      if (next.length === 6) {
        setTimeout(() => setPinStep('confirm'), 300);
      }
    } else {
      const next = pinConfirm + digit;
      setPinConfirm(next);
      if (next.length === 6) {
        if (next === pin) {
          setTimeout(onComplete, 300);
        } else {
          triggerShake();
          setPinConfirm('');
        }
      }
    }
  };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  if (step === 'slides') {
    const s = SLIDES[slideIndex];
    return (
      <LinearGradient colors={s.gradient as [string, string]} style={styles.container}>
        <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
          >
            {SLIDES.map((slide, i) => (
              <View key={i} style={[styles.slide, { width }]}>
                <View style={styles.slideContent}>
                  <View style={styles.slideIconWrap}>
                    <Ionicons name={slide.icon} size={64} color={Colors.primary} />
                  </View>
                  <Text style={styles.slideTitle}>{slide.title}</Text>
                  <Text style={styles.slideDesc}>{slide.desc}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          {/* Dots */}
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === slideIndex ? styles.dotActive : styles.dotInactive,
                ]}
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              label={slideIndex < 2 ? 'Suivant' : 'Créer mon compte'}
              icon={slideIndex < 2 ? 'arrow-forward' : undefined}
              onPress={slideToNext}
            />
            {slideIndex === 0 && (
              <Pressable
                onPress={() => setStep('phone')}
                style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Passer l'introduction"
              >
                <Text style={styles.skipText}>Passer</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if (step === 'phone') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.formContainer}>
            <View style={styles.stepIconWrap}>
              <Ionicons name="call-outline" size={36} color={Colors.primary} />
            </View>
            <Text style={styles.stepTitle}>Votre numéro</Text>
            <Text style={styles.stepDesc}>Nous envoyons un SMS de vérification</Text>

            <View style={styles.inputRow}>
              <Text style={styles.inputPrefix}>+237</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="6XX XX XX XX"
                placeholderTextColor={Colors.textMuted}
                keyboardType="phone-pad"
                maxLength={9}
                autoFocus
              />
            </View>

            <Button
              label="Envoyer le code SMS"
              onPress={sendOtp}
              loading={loading}
              disabled={phone.length < 9}
            />

            <Text style={styles.termsText}>
              En continuant, vous acceptez nos{' '}
              <Text style={styles.termsLink}>Conditions d'utilisation</Text>
            </Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (step === 'otp') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.formContainer}>
            <View style={styles.stepIconWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={Colors.primary} />
            </View>
            <Text style={styles.stepTitle}>Code de vérification</Text>
            <Text style={styles.stepDesc}>
              Entrez le code envoyé au +237 {phone}
            </Text>

            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  value={otp}
                  onChangeText={setOtp}
                  placeholder="••••••"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="numeric"
                  maxLength={6}
                  autoFocus
                />
              </View>
            </Animated.View>

            <View style={styles.demoHint}>
              <Text style={styles.demoHintText}>
                Code de démo : <Text style={{ color: Colors.primary, fontWeight: Typography.bold }}>847291</Text>
              </Text>
            </View>

            <Button label="Vérifier" onPress={verifyOtp} disabled={otp.length < 6} />

            <Pressable
              onPress={() => setStep('phone')}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Modifier le numéro"
            >
              <View style={styles.backRow}>
                <Ionicons name="arrow-back" size={16} color={Colors.textMuted} />
                <Text style={styles.backText}>Modifier le numéro</Text>
              </View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // PIN creation
  const currentPin = pinStep === 'create' ? pin : pinConfirm;
  return (
    <SafeAreaView style={[styles.container, styles.pinContainer]} edges={['top', 'bottom']}>
      <View style={styles.stepIconWrap}>
        <Ionicons name="shield-checkmark-outline" size={36} color={Colors.primary} />
      </View>
      <Text style={styles.stepTitle}>
        {pinStep === 'create' ? 'Créez votre PIN' : 'Confirmez votre PIN'}
      </Text>
      <Text style={styles.stepDesc}>
        {pinStep === 'create'
          ? 'Choisissez un code PIN à 6 chiffres'
          : 'Saisissez à nouveau votre PIN'}
      </Text>

      {/* PIN dots */}
      <Animated.View style={[styles.pinDots, { transform: [{ translateX: shake }] }]}>
        {Array(6).fill(0).map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              currentPin.length > i ? styles.pinDotFilled : styles.pinDotEmpty,
            ]}
          />
        ))}
      </Animated.View>

      {/* PIN keypad */}
      <View style={styles.pinGrid}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, i) => {
          const isDelete = key === 'del';
          const isEmpty = key === '';
          return (
            <Pressable
              key={i}
              style={({ pressed }) => [
                styles.pinKey,
                isEmpty && styles.pinKeyEmpty,
                !isEmpty && pressed && styles.pinKeyPressed,
              ]}
              onPress={() => {
                if (isEmpty) return;
                if (isDelete) {
                  if (pinStep === 'create') setPin(p => p.slice(0, -1));
                  else setPinConfirm(p => p.slice(0, -1));
                } else {
                  handlePin(key);
                }
              }}
              disabled={isEmpty}
              accessibilityRole="button"
              accessibilityLabel={isDelete ? 'Supprimer' : isEmpty ? undefined : `Chiffre ${key}`}
            >
              {isDelete ? (
                <Ionicons name="backspace-outline" size={24} color={Colors.text} />
              ) : !isEmpty ? (
                <Text style={styles.pinKeyText}>{key}</Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  slide: {
    flex: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: 80,
  },
  slideContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xxl,
  },
  slideIconWrap: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideTitle: {
    fontSize: Typography.xxl,
    fontWeight: Typography.black,
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  slideDesc: {
    fontSize: Typography.md,
    color: Colors.textSoft,
    textAlign: 'center',
    lineHeight: Typography.md * Typography.relaxed,
    maxWidth: 280,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: Spacing.xl,
  },
  dot: { height: 8, borderRadius: 4 },
  dotActive: { backgroundColor: Colors.primary, width: 24 },
  dotInactive: { backgroundColor: Colors.border, width: 8 },
  actions: {
    paddingHorizontal: Spacing.xxl,
    paddingBottom: 40,
    gap: Spacing.md,
  },
  skipBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: Spacing.sm },
  skipText: { color: Colors.textMuted, fontSize: Typography.base },

  // Form
  formContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: 80,
    gap: Spacing.xl,
  },
  stepIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  stepTitle: {
    fontSize: Typography.xxl,
    fontWeight: Typography.black,
    color: Colors.text,
    textAlign: 'center',
  },
  stepDesc: {
    fontSize: Typography.base,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  inputRow: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  inputPrefix: { color: Colors.textSoft, fontSize: Typography.base },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.base,
    paddingVertical: 14,
    minHeight: 50,
  },
  otpInput: {
    textAlign: 'center',
    fontSize: Typography.xl,
    letterSpacing: 8,
    fontWeight: Typography.bold,
  },
  demoHint: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
  },
  demoHintText: { color: Colors.textSoft, fontSize: Typography.sm },
  termsText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  termsLink: { color: Colors.primary },
  backBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: Spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: Colors.textMuted, fontSize: Typography.base },

  // PIN
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDots: {
    flexDirection: 'row',
    gap: 14,
    marginVertical: Spacing.xxl,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  pinDotFilled: { backgroundColor: Colors.primary },
  pinDotEmpty: { backgroundColor: Colors.border },
  pinGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 264,
    gap: 12,
    justifyContent: 'center',
  },
  pinKey: {
    width: 80,
    height: 60,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinKeyPressed: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  pinKeyEmpty: {
    backgroundColor: Colors.transparent,
    borderColor: Colors.transparent,
  },
  pinKeyText: {
    fontSize: Typography.xl,
    fontWeight: Typography.semibold,
    color: Colors.text,
  },
});
