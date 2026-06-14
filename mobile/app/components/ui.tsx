import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { Colors, Typography, BorderRadius, Spacing, Shadows } from '../constants/theme';

// ── Button ────────────────────────────────────────────────
interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, style, icon }: ButtonProps) {
  const variantStyles = {
    primary: {
      container: styles.btnPrimary,
      text: styles.btnPrimaryText,
    },
    secondary: {
      container: styles.btnSecondary,
      text: styles.btnSecondaryText,
    },
    danger: {
      container: styles.btnDanger,
      text: styles.btnDangerText,
    },
    ghost: {
      container: styles.btnGhost,
      text: styles.btnGhostText,
    },
  };

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        variantStyles[variant].container,
        (disabled || loading) && styles.btnDisabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? Colors.white : Colors.primary} />
      ) : (
        <View style={styles.btnContent}>
          {icon && <View style={styles.btnIcon}>{icon}</View>}
          <Text style={[styles.btnText, variantStyles[variant].text]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── Badge ────────────────────────────────────────────────
interface BadgeProps {
  label: string;
  color?: string;
  bg?: string;
}
export function Badge({ label, color = Colors.primary, bg = Colors.primaryLight }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
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
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── Section Title ────────────────────────────────────────
export function SectionTitle({ label }: { label: string }) {
  return <Text style={styles.sectionTitle}>{label}</Text>;
}

// ── Divider ────────────────────────────────────────────────
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

// ── Toast ────────────────────────────────────────────────
interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
}
export function Toast({ message, type = 'success' }: ToastProps) {
  const colors = {
    success: { bg: Colors.successBg, border: Colors.primary, text: Colors.primary },
    error: { bg: Colors.errorBg, border: Colors.red, text: Colors.red },
    info: { bg: Colors.infoBg, border: Colors.blue, text: Colors.blue },
  };
  const c = colors[type];
  return (
    <View style={[styles.toast, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.toastText, { color: c.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Button
  btn: {
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnIcon: { marginRight: 4 },
  btnText: { fontSize: Typography.md, fontWeight: Typography.bold },
  btnPrimary: {
    backgroundColor: Colors.primary,
    ...Shadows.button,
  },
  btnPrimaryText: { color: Colors.white },
  btnSecondary: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnSecondaryText: { color: Colors.text },
  btnDanger: {
    backgroundColor: Colors.errorBg,
    borderWidth: 1,
    borderColor: Colors.red + '50',
  },
  btnDangerText: { color: Colors.red },
  btnGhost: { backgroundColor: Colors.transparent },
  btnGhostText: { color: Colors.primary },
  btnDisabled: { opacity: 0.4 },

  // Badge
  badge: {
    borderRadius: BorderRadius.full,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  badgeText: { fontSize: Typography.xs, fontWeight: Typography.bold, letterSpacing: 0.5 },

  // Avatar
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarText: { fontWeight: Typography.black },

  // Card
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
  },

  // Section title
  sectionTitle: {
    color: Colors.textMuted,
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
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    alignItems: 'center',
    zIndex: 1000,
  },
  toastText: { fontSize: Typography.sm, fontWeight: Typography.bold },
});
