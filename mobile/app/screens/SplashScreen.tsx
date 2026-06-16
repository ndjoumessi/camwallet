import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, AccessibilityInfo } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Colors, Typography, Spacing, BALANCE_GRADIENT } from '../constants/theme';

interface SplashScreenProps {
  onFinish: () => void;
}

export default function SplashScreen({ onFinish }: SplashScreenProps) {
  const { t } = useTranslation();
  const logoScale = useRef(new Animated.Value(0.5)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const spinnerOpacity = useRef(new Animated.Value(0)).current;
  const spinnerRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    const startAnimations = () => {
      Animated.parallel([
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start(() => {
        if (cancelled) return;
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }).start();
        Animated.timing(spinnerOpacity, {
          toValue: 1,
          duration: 300,
          delay: 200,
          useNativeDriver: true,
        }).start();
      });

      Animated.loop(
        Animated.timing(spinnerRotate, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      ).start();
    };

    const showInstant = () => {
      logoScale.setValue(1);
      logoOpacity.setValue(1);
      textOpacity.setValue(1);
      spinnerOpacity.setValue(1);
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) showInstant();
        else startAnimations();
      })
      .catch(() => { if (!cancelled) startAnimations(); });

    const timer = setTimeout(onFinish, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [onFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  const spin = spinnerRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <LinearGradient
      colors={[BALANCE_GRADIENT[0], Colors.bg]}
      locations={[0, 0.7]}
      style={styles.container}
    >
      {/* Glow orbs */}
      <View style={styles.orb1} />
      <View style={styles.orb2} />

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoWrap,
          { transform: [{ scale: logoScale }], opacity: logoOpacity },
        ]}
      >
        <LinearGradient
          colors={[Colors.primary, Colors.primaryDark]}
          style={styles.logo}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.logoText}>₩</Text>
        </LinearGradient>
      </Animated.View>

      {/* Title */}
      <Animated.View style={[styles.titleWrap, { opacity: textOpacity }]}>
        <Text style={styles.title}>
          Cam<Text style={styles.titleGreen}>Wallet</Text>
        </Text>
        <Text style={styles.subtitle}>{t('splash.tagline')}</Text>
      </Animated.View>

      {/* Spinner */}
      <Animated.View
        style={[
          styles.spinner,
          { opacity: spinnerOpacity, transform: [{ rotate: spin }] },
        ]}
      />

      {/* Version */}
      <Text style={styles.version}>v2.7.3</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg,
  },
  orb1: {
    position: 'absolute',
    top: '15%',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: Colors.primary + '08',
    alignSelf: 'center',
  },
  orb2: {
    position: 'absolute',
    bottom: '20%',
    right: -60,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.blue + '06',
  },
  logoWrap: {
    marginBottom: Spacing.xxl,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 20,
  },
  logoText: {
    fontSize: 44,
    color: Colors.white,
    fontWeight: Typography.black,
  },
  titleWrap: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 40,
  },
  title: {
    fontSize: Typography.hero,
    fontWeight: Typography.black,
    color: Colors.text,
    letterSpacing: -1,
  },
  titleGreen: {
    color: Colors.primary,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: Typography.sm,
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: Colors.border,
    borderTopColor: Colors.primary,
  },
  version: {
    position: 'absolute',
    bottom: 40,
    color: Colors.textMuted,
    fontSize: Typography.xs,
  },
});
