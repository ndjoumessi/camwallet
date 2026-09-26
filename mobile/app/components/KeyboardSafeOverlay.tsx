import React, { useRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Colors, Spacing } from '../constants/theme';
import { useKeyboardOverlap } from '../hooks/useKeyboardOverlap';

/**
 * Fond assombri avec une carte centrée (modaux de confirmation, saisie de PIN, motif…) qui reste
 * entièrement accessible quand le clavier est ouvert.
 *
 * - Android : le clavier recouvre le bas du `Modal` ; le fond réserve la part recouverte
 *   (`useKeyboardOverlap`), la carte se recentre au-dessus du clavier.
 * - iOS : `KeyboardAvoidingView` ("padding") s'en charge ; il est désactivé sur Android pour ne
 *   pas compenser deux fois.
 * - La carte est dans un `ScrollView` : sur un petit écran où elle ne tient pas au-dessus du
 *   clavier, on peut la faire défiler pour atteindre le bouton.
 */
export function KeyboardSafeOverlay({ children }: { children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const keyboardOverlap = useKeyboardOverlap(ref);

  return (
    <View ref={ref} collapsable={false} style={[styles.overlay, { paddingBottom: keyboardOverlap }]}>
      <KeyboardAvoidingView enabled={Platform.OS === 'ios'} behavior="padding" style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
});
