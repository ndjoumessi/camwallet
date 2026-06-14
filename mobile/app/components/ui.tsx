import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  TextInput,
  TextInputProps,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, BorderRadius, Spacing, Shadows, Animation } from '../constants/theme';

// ── Button ────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Nom d'icône Ionicons affiché avant le label. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Élément personnalisé à la place de `icon`. */
  iconNode?: React.ReactNode;
  fullWidth?: boolean;
}

const SIZES: Record<ButtonSize, { minHeight: number; padV: number; font: number; iconSize: number }> = {
  sm: { minHeight: 44, padV: 10, font: Typography.base, iconSize: 16 },
  md: { minHeight: 52, padV: 15, font: Typography.md, iconSize: 18 },
  lg: { minHeight: 58, padV: 18, font: Typography.lg, iconSize: 20 },
};

export function Button({
  label, onPress, variant = 'primary', size = 'md',
  loading, disabled, style, icon, iconNode, fullWidth,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const v = VARIANT_STYLES[variant];
  const s = SIZES[size];

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        { minHeight: s.minHeight, paddingVertical: s.padV },
        v.container,
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.btnDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.spinner} />
      ) : (
        <View style={styles.btnContent}>
          {iconNode ?? (icon && <Ionicons name={icon} size={s.iconSize} color={v.text.color} />)}
          <Text style={[styles.btnText, { fontSize: s.font }, v.text]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ── IconButton (icon-only, ≥44×44, label obligatoire) ─────
interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  color?: string;
  bg?: string;
  style?: StyleProp<ViewStyle>;
}
export function IconButton({
  icon, onPress, accessibilityLabel, size = 22, color = Colors.text, bg, style,
}: IconButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        bg ? { backgroundColor: bg } : null,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

// ── Badge ────────────────────────────────────────────────
interface BadgeProps {
  label: string;
  color?: string;
  bg?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}
export function Badge({ label, color = Colors.primary, bg = Colors.primaryLight, icon }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={11} color={color} style={{ marginRight: 4 }} />}
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// ── Avatar ────────────────────────────────────────────────
interface AvatarProps {
  initials: string;
  size?: number;
  color?: string;
  bg?: string;
}
export function Avatar({ initials, size = 42, color = Colors.primary, bg = Colors.primaryLight }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, borderColor: color + '55' },
      ]}
    >
      <Text style={[styles.avatarText, { color, fontSize: size * 0.33 }]}>{initials}</Text>
    </View>
  );
}

// ── Card ────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Rend la carte cliquable avec feedback "pressed". */
  onPress?: () => void;
  accessibilityLabel?: string;
}
export function Card({ children, style, onPress, accessibilityLabel }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Input ────────────────────────────────────────────────
interface InputProps extends TextInputProps {
  label?: string;
  /** Nom d'icône Ionicons affiché à gauche. */
  icon?: keyof typeof Ionicons.glyphMap;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}
export function Input({ label, icon, error, containerStyle, style, onFocus, onBlur, ...rest }: InputProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? Colors.red : focused ? Colors.primary : Colors.border;
  return (
    <View style={containerStyle}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={[styles.inputWrap, { borderColor }]}>
        {icon && <Ionicons name={icon} size={18} color={focused ? Colors.primary : Colors.textMuted} style={{ marginRight: 8 }} />}
        <TextInput
          placeholderTextColor={Colors.textMuted}
          style={[styles.input, style]}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...rest}
        />
      </View>
      {error && <Text style={styles.inputError}>{error}</Text>}
    </View>
  );
}

// ── Skeleton (pulse 900ms) ───────────────────────────────
interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}
export function Skeleton({ width = '100%', height = 16, radius = BorderRadius.sm, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: Colors.cardHover, opacity }, style as any]}
    />
  );
}

// ── Section Title ────────────────────────────────────────
export function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

// ── Divider ────────────────────────────────────────────────
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

// ── Toast ────────────────────────────────────────────────
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
}
export function Toast({ message, type = 'success' }: ToastProps) {
  const cfg = {
    success: { bg: Colors.successBg, border: Colors.primary, text: Colors.primary, icon: 'checkmark-circle' as const },
    error: { bg: Colors.errorBg, border: Colors.red, text: Colors.red, icon: 'alert-circle' as const },
    info: { bg: Colors.infoBg, border: Colors.blue, text: Colors.blue, icon: 'information-circle' as const },
  }[type];
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: Animation.spring.damping, stiffness: Animation.spring.stiffness }).start();
  }, [enter]);
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        { backgroundColor: cfg.bg, borderColor: cfg.border,
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] },
      ]}
    >
      <Ionicons name={cfg.icon} size={16} color={cfg.text} style={{ marginRight: 8 }} />
      <Text style={[styles.toastText, { color: cfg.text }]}>{message}</Text>
    </Animated.View>
  );
}

// ── Variant table ─────────────────────────────────────────
const VARIANT_STYLES: Record<ButtonVariant, { container: ViewStyle; text: TextStyle; spinner: string }> = {
  primary: { container: { backgroundColor: Colors.primary, ...Shadows.button }, text: { color: Colors.white }, spinner: Colors.white },
  secondary: { container: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }, text: { color: Colors.text }, spinner: Colors.primary },
  danger: { container: { backgroundColor: Colors.errorBg, borderWidth: 1, borderColor: Colors.red + '50' }, text: { color: Colors.red }, spinner: Colors.red },
  ghost: { container: { backgroundColor: Colors.transparent }, text: { color: Colors.primary }, spinner: Colors.primary },
};

const styles = StyleSheet.create({
  // Shared pressed feedback
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },

  // Button
  btn: {
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  btnText: { fontWeight: Typography.bold },
  btnDisabled: { opacity: 0.4 },

  // IconButton
  iconBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Badge
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  badgeText: { fontSize: Typography.xs, fontWeight: Typography.bold, letterSpacing: 0.5 },

  // Avatar
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  avatarText: { fontWeight: Typography.black },

  // Card
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },

  // Input
  inputLabel: { color: Colors.textSoft, fontSize: Typography.xs, fontWeight: Typography.semibold, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
  },
  input: { flex: 1, color: Colors.text, fontSize: Typography.base, paddingVertical: Spacing.md },
  inputError: { color: Colors.red, fontSize: Typography.xs, marginTop: 4 },

  // Section title
  sectionTitle: {
    color: Colors.textSoft,
    fontSize: Typography.xs,
    fontWeight: Typography.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.md,
  },

  // Divider
  divider: { height: 1, backgroundColor: Colors.border },

  // Toast
  toast: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  toastText: { fontSize: Typography.sm, fontWeight: Typography.bold },
});
