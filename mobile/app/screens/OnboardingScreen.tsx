import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  StatusBar,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BorderRadius, BALANCE_GRADIENT } from '../constants/theme';
import { Button } from '../components/ui';
import { authApi } from '../../src/lib/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');
const RESEND_COOLDOWN_S = 60;
// Marqueur « intro vue » : une fois posé, le prochain lancement saute l'onboarding
// et route directement vers le LoginScreen (cf. routage dans app/index.tsx).
const ONBOARDING_SEEN_KEY = 'cw_has_seen_onboarding';

function isPhoneValid(phone: string): boolean {
  return /^[62]\d{8}$/.test(phone);
}

function extractApiError(err: any, fallback: string): string {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg[0] : (msg ?? fallback);
}

interface OnboardingProps {
  onComplete: () => void;
}

export default function OnboardingScreen({ onComplete }: OnboardingProps) {
  const { t } = useTranslation();

  const SLIDES = [
    {
      icon: 'phone-portrait-outline' as const,
      title: t('onboarding.slides.0.title'),
      desc: t('onboarding.slides.0.desc'),
      gradient: [BALANCE_GRADIENT[0], Colors.bg] as [string, string],
    },
    {
      icon: 'lock-closed-outline' as const,
      title: t('onboarding.slides.1.title'),
      desc: t('onboarding.slides.1.desc'),
      gradient: [BALANCE_GRADIENT[1], Colors.bg] as [string, string],
    },
    {
      icon: 'flash' as const,
      title: t('onboarding.slides.2.title'),
      desc: t('onboarding.slides.2.desc'),
      gradient: ['#1a1505', Colors.bg] as [string, string],
    },
  ];

  const [step, setStep] = useState<'slides' | 'phone' | 'otp' | 'pin'>('slides');
  const [slideIndex, setSlideIndex] = useState(0);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [pinStep, setPinStep] = useState<'create' | 'confirm'>('create');
  const [error, setError] = useState('');
  // Vrai quand le numéro saisi est déjà inscrit (409) → on propose d'aller se connecter.
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showTerms, setShowTerms] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const triggerShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shake]);

  // Quitte les slides d'intro vers l'inscription en marquant l'onboarding comme vu.
  const startRegistration = useCallback(() => {
    void AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
    setStep('phone');
  }, []);

  const slideToNext = () => {
    if (slideIndex < SLIDES.length - 1) {
      const next = slideIndex + 1;
      setSlideIndex(next);
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    } else {
      startRegistration();
    }
  };

  const sendOtp = async () => {
    setError('');
    setAlreadyRegistered(false);
    setLoading(true);
    try {
      const result = await authApi.register(`+237${phone}`);
      setUserId(result.userId);
      setOtp('');
      setStep('otp');
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      if (status === 409) {
        setError(t('onboarding.phone.errorAlreadyRegistered'));
        setAlreadyRegistered(true);
      } else if (status === 429) {
        setError(t('onboarding.phone.errorTooManyAttempts'));
      } else if (status === 400) {
        setError(extractApiError(err, t('onboarding.phone.errorInvalidNumber')));
      } else {
        setError(t('onboarding.phone.errorSendFailed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (resendCooldown > 0) return;
    setError('');
    setLoading(true);
    try {
      const result = await authApi.register(`+237${phone}`);
      setUserId(result.userId);
      setResendCooldown(RESEND_COOLDOWN_S);
    } catch {
      setError(t('onboarding.phone.errorResendFailed'));
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!userId || otp.length < 6) return;
    setError('');
    setLoading(true);
    try {
      await authApi.verifyOtp(userId, otp);
      setStep('pin');
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      if (status === 400 || status === 401) {
        setError(t('onboarding.otp.errorWrongCode'));
      } else if (status === 410) {
        setError(t('onboarding.otp.errorExpiredCode'));
      } else if (status === 429) {
        setError(t('onboarding.otp.errorTooMany'));
      } else {
        setError(t('onboarding.otp.errorVerification'));
      }
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const handlePin = (digit: string) => {
    if (pinStep === 'create') {
      if (pin.length >= 6) return;
      const next = pin + digit;
      setPin(next);
      if (next.length === 6) {
        setError('');
        setTimeout(() => setPinStep('confirm'), 300);
      }
    } else {
      if (pinConfirm.length >= 6) return;
      const next = pinConfirm + digit;
      setPinConfirm(next);
      if (next.length === 6) {
        if (next === pin) {
          setLoading(true);
          authApi
            .setPin(userId, next)
            .then(() => setTimeout(onComplete, 200))
            .catch((err: any) => {
              const status: number | undefined = err?.response?.status;
              setError(
                status === 429
                  ? t('onboarding.phone.errorTooManyAttempts')
                  : t('onboarding.pin.errorFinalizeError')
              );
              triggerShake();
              setPinConfirm('');
              setLoading(false);
            });
        } else {
          setError(t('onboarding.pin.errorMismatch'));
          triggerShake();
          setTimeout(() => setPinConfirm(''), 300);
        }
      }
    }
  };

  const handlePinDelete = () => {
    setError('');
    if (pinStep === 'create') {
      setPin(p => p.slice(0, -1));
    } else {
      const next = pinConfirm.slice(0, -1);
      if (next.length === 0) {
        setPinStep('create');
        setPin('');
        setPinConfirm('');
      } else {
        setPinConfirm(next);
      }
    }
  };

  const handlePhoneChange = (text: string) => {
    setPhone(text.replace(/\D/g, '').slice(0, 9));
    setError('');
    setAlreadyRegistered(false);
  };

  const handleOtpChange = (text: string) => {
    setOtp(text.replace(/\D/g, '').slice(0, 6));
    setError('');
  };

  // ── Slides ──────────────────────────────────────────────────────────────────
  if (step === 'slides') {
    const s = SLIDES[slideIndex];
    return (
      <LinearGradient colors={s.gradient} style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
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

          <View
            style={styles.dots}
            accessibilityRole="tablist"
            accessibilityLabel={t('onboarding.a11y.dotsTablist', { current: slideIndex + 1, total: SLIDES.length })}
          >
            {SLIDES.map((_, i) => (
              <View
                key={i}
                style={[styles.dot, i === slideIndex ? styles.dotActive : styles.dotInactive]}
                accessible={false}
                importantForAccessibility="no"
              />
            ))}
          </View>

          <View style={styles.actions}>
            <Button
              label={slideIndex < SLIDES.length - 1 ? t('onboarding.btn.next') : t('onboarding.btn.createAccount')}
              icon={slideIndex < SLIDES.length - 1 ? 'arrow-forward' : undefined}
              onPress={slideToNext}
            />
            {slideIndex === 0 && (
              <Pressable
                onPress={startRegistration}
                style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.a11y.skipIntro')}
                hitSlop={8}
              >
                <Text style={styles.skipText}>{t('onboarding.btn.skip')}</Text>
              </Pressable>
            )}
          </View>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  // ── Phone ──────────────────────────────────────────────────────────────────
  if (step === 'phone') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.formContainer}>
            <View style={styles.stepIconWrap}>
              <Ionicons name="call-outline" size={36} color={Colors.primary} />
            </View>
            <Text style={styles.stepTitle}>{t('onboarding.phone.title')}</Text>
            <Text style={styles.stepDesc}>{t('onboarding.phone.desc')}</Text>

            <View>
              <Text style={styles.inputLabel}>{t('onboarding.phone.label')}</Text>
              <View style={[styles.inputRow, !!error && styles.inputRowError]}>
                <Text style={styles.inputPrefix}>+237</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={handlePhoneChange}
                  placeholder={t('onboarding.phone.placeholder')}
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={9}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  editable={!loading}
                  accessibilityLabel={t('onboarding.phone.a11yLabel')}
                  accessibilityHint={t('onboarding.phone.a11yHint')}
                />
              </View>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {alreadyRegistered && (
                <Button
                  label={t('onboarding.phone.goToLogin')}
                  onPress={onComplete}
                  icon="log-in-outline"
                  style={styles.goToLoginBtn}
                />
              )}
            </View>

            <Button
              label={t('onboarding.phone.btnSendSms')}
              onPress={sendOtp}
              loading={loading}
              disabled={!isPhoneValid(phone) || loading}
            />

            <Text style={styles.termsText}>
              {t('onboarding.phone.terms')}{' '}
              <Text
                style={styles.termsLink}
                onPress={() => setShowTerms(true)}
                accessibilityRole="link"
                accessibilityLabel={t('onboarding.phone.termsLink')}
              >
                {t('onboarding.phone.termsLink')}
              </Text>
            </Text>

            <Modal
              visible={showTerms}
              animationType="slide"
              transparent
              onRequestClose={() => setShowTerms(false)}
            >
              <View style={styles.termsOverlay}>
                <View style={styles.termsModal}>
                  <View style={styles.termsHeader}>
                    <Text style={styles.termsModalTitle}>{t('onboarding.phone.termsTitle')}</Text>
                    <Pressable
                      onPress={() => setShowTerms(false)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('onboarding.phone.termsClose')}
                    >
                      <Ionicons name="close" size={24} color={Colors.textSoft} />
                    </Pressable>
                  </View>
                  <Text style={styles.termsUpdated}>{t('onboarding.phone.termsUpdated')}</Text>
                  <ScrollView
                    style={styles.termsScroll}
                    contentContainerStyle={styles.termsScrollContent}
                    showsVerticalScrollIndicator
                  >
                    <Text style={styles.termsBody}>{t('onboarding.phone.termsBody')}</Text>
                  </ScrollView>
                  <Button label={t('onboarding.phone.termsClose')} onPress={() => setShowTerms(false)} />
                </View>
              </View>
            </Modal>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── OTP ────────────────────────────────────────────────────────────────────
  if (step === 'otp') {
    const resendActive = resendCooldown === 0 && !loading;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.formContainer}>
            <View style={styles.stepIconWrap}>
              <Ionicons name="chatbubble-ellipses-outline" size={36} color={Colors.primary} />
            </View>
            <Text style={styles.stepTitle}>{t('onboarding.otp.title')}</Text>
            <Text style={styles.stepDesc}>{t('onboarding.otp.desc', { phone: `+237 ${phone}` })}</Text>

            <View>
              <Text style={styles.inputLabel}>{t('onboarding.otp.label')}</Text>
              <Animated.View style={{ transform: [{ translateX: shake }] }}>
                <View style={[styles.inputRow, !!error && styles.inputRowError]}>
                  <TextInput
                    style={[styles.input, styles.otpInput]}
                    value={otp}
                    onChangeText={handleOtpChange}
                    placeholder="••••••"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    maxLength={6}
                    autoFocus
                    autoCorrect={false}
                    autoCapitalize="none"
                    editable={!loading}
                    accessibilityLabel={t('onboarding.otp.a11yLabel')}
                  />
                </View>
              </Animated.View>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
            </View>

            <Button
              label={t('onboarding.otp.btnVerify')}
              onPress={verifyOtp}
              loading={loading}
              disabled={otp.length < 6 || loading}
            />

            <Pressable
              onPress={resendOtp}
              disabled={!resendActive}
              style={({ pressed }) => [
                styles.resendBtn,
                pressed && resendActive && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                resendCooldown > 0
                  ? t('onboarding.otp.btnResendCooldown', { seconds: resendCooldown })
                  : t('onboarding.otp.btnResend')
              }
            >
              <Text style={[styles.resendText, !resendActive && styles.resendTextDisabled]}>
                {resendCooldown > 0
                  ? t('onboarding.otp.btnResendCooldown', { seconds: resendCooldown })
                  : t('onboarding.otp.btnResend')}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => { setStep('phone'); setError(''); setOtp(''); }}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.otp.a11yChangeNumber')}
            >
              <View style={styles.backRow}>
                <Ionicons name="arrow-back" size={16} color={Colors.textMuted} />
                <Text style={styles.backText}>{t('onboarding.otp.btnChangeNumber')}</Text>
              </View>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // ── PIN ────────────────────────────────────────────────────────────────────
  const currentPin = pinStep === 'create' ? pin : pinConfirm;
  return (
    <SafeAreaView style={[styles.container, styles.pinContainer]} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />
      <View style={styles.stepIconWrap}>
        <Ionicons name="shield-checkmark-outline" size={36} color={Colors.primary} />
      </View>
      <Text style={styles.stepTitle}>
        {pinStep === 'create' ? t('onboarding.pin.titleCreate') : t('onboarding.pin.titleConfirm')}
      </Text>
      <Text style={styles.stepDesc}>
        {pinStep === 'create' ? t('onboarding.pin.descCreate') : t('onboarding.pin.descConfirm')}
      </Text>

      <Animated.View
        style={[styles.pinDots, { transform: [{ translateX: shake }] }]}
        accessibilityLabel={`${currentPin.length} chiffre${currentPin.length !== 1 ? 's' : ''} saisi${currentPin.length !== 1 ? 's' : ''} sur 6`}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              currentPin.length > i ? styles.pinDotFilled : styles.pinDotEmpty,
            ]}
          />
        ))}
      </Animated.View>

      <View style={styles.pinErrorRow}>
        {!!error && <Text style={styles.pinError}>{error}</Text>}
      </View>

      <View style={styles.pinGrid} accessible={false}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key, i) => {
          const isDelete = key === 'del';
          const isEmpty = key === '';
          const isDisabled = isEmpty || loading;
          return (
            <Pressable
              key={i}
              style={({ pressed }) => [
                styles.pinKey,
                isEmpty && styles.pinKeyEmpty,
                !isDisabled && pressed && styles.pinKeyPressed,
                loading && !isEmpty && styles.pinKeyDisabled,
              ]}
              onPress={() => {
                if (isDisabled) return;
                if (isDelete) handlePinDelete();
                else handlePin(key);
              }}
              disabled={isDisabled}
              accessibilityRole={isEmpty ? undefined : 'button'}
              accessibilityLabel={
                isDelete
                  ? t('onboarding.pin.a11yDelete')
                  : isEmpty
                  ? undefined
                  : t('onboarding.a11y.digit', { digit: key })
              }
            >
              {isDelete ? (
                <Ionicons
                  name="backspace-outline"
                  size={24}
                  color={loading ? Colors.textMuted : Colors.text}
                />
              ) : !isEmpty ? (
                <Text style={[styles.pinKeyText, loading && styles.pinKeyTextDisabled]}>
                  {key}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {pinStep === 'confirm' && !loading && (
        <Pressable
          onPress={() => {
            setPinStep('create');
            setPin('');
            setPinConfirm('');
            setError('');
          }}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.pin.a11yRestart')}
        >
          <View style={styles.backRow}>
            <Ionicons name="arrow-back" size={16} color={Colors.textMuted} />
            <Text style={styles.backText}>{t('onboarding.pin.btnRestart')}</Text>
          </View>
        </Pressable>
      )}
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

  // ── Slides
  slide: {
    flex: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.huge + Spacing.xxxl,
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
    paddingBottom: Spacing.xxl + Spacing.lg,
    gap: Spacing.md,
  },
  skipBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    padding: Spacing.sm,
  },
  skipText: { color: Colors.textMuted, fontSize: Typography.base },

  // ── Form (phone + otp)
  formContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xxl,
    paddingTop: Spacing.huge + Spacing.xxxl,
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
  inputLabel: {
    fontSize: Typography.sm,
    fontWeight: Typography.semibold,
    color: Colors.textSoft,
    marginBottom: Spacing.sm,
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
  inputRowError: {
    borderColor: Colors.error,
  },
  inputPrefix: { color: Colors.textSoft, fontSize: Typography.base },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.base,
    paddingVertical: Spacing.md,
    minHeight: 50,
  },
  otpInput: {
    textAlign: 'center',
    fontSize: Typography.xl,
    letterSpacing: 8,
    fontWeight: Typography.bold,
  },
  errorText: {
    color: Colors.error,
    fontSize: Typography.xs,
    marginTop: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  goToLoginBtn: {
    marginTop: Spacing.md,
  },
  termsText: {
    color: Colors.textMuted,
    fontSize: Typography.xs,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  termsLink: { color: Colors.primary },
  termsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  termsModal: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
    maxHeight: '85%',
  },
  termsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  termsModalTitle: {
    flex: 1,
    paddingRight: Spacing.md,
    fontSize: Typography.lg,
    fontWeight: Typography.black,
    color: Colors.text,
  },
  termsUpdated: {
    fontSize: Typography.xs,
    color: Colors.textMuted,
    marginBottom: Spacing.lg,
  },
  termsScroll: { marginBottom: Spacing.lg },
  termsScrollContent: { paddingBottom: Spacing.md },
  termsBody: {
    fontSize: Typography.sm,
    color: Colors.textSoft,
    lineHeight: Typography.sm * Typography.relaxed,
  },
  resendBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: Spacing.sm,
  },
  resendText: {
    color: Colors.primary,
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
  },
  resendTextDisabled: {
    color: Colors.textMuted,
    fontWeight: Typography.regular,
  },
  backBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    padding: Spacing.md,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { color: Colors.textMuted, fontSize: Typography.base },

  // ── PIN
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDots: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginVertical: Spacing.xxl,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  pinDotFilled: { backgroundColor: Colors.primary },
  pinDotEmpty: { backgroundColor: Colors.border },
  pinErrorRow: {
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  pinError: {
    color: Colors.error,
    fontSize: Typography.sm,
    textAlign: 'center',
  },
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
  pinKeyDisabled: {
    opacity: 0.4,
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
  pinKeyTextDisabled: {
    color: Colors.textMuted,
  },
});
