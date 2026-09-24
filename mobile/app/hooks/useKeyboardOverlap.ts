import { RefObject, useEffect, useState } from 'react';
import { Keyboard, Platform, StatusBar, View } from 'react-native';

/**
 * De combien de dp le clavier logiciel recouvre le bas de `ref` (0 s'il ne le recouvre pas).
 *
 * Android uniquement. Selon l'environnement (mode bord à bord, Expo Go, APK de release), la
 * fenêtre est redimensionnée par le système ou par `KeyboardAvoidingView`, ou pas du tout : le
 * clavier recouvre alors le bas d'un `Modal`. On mesure donc le recouvrement réel plutôt que de
 * supposer la hauteur du clavier, pour ne jamais compenser deux fois. Sur iOS on laisse
 * `KeyboardAvoidingView` ("padding") faire le travail.
 */
export function useKeyboardOverlap(ref: RefObject<View | null>): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      // Laisse le système / KeyboardAvoidingView finir leur relayout avant de mesurer.
      timer = setTimeout(() => {
        ref.current?.measureInWindow((_x, y, _w, h) => {
          // `y` est relatif à la fenêtre du Modal, qui démarre sous la barre d'état ; `screenY`
          // est relatif à l'écran : on ramène la mesure dans le repère de l'écran.
          const bottomOnScreen = y + h + (StatusBar.currentHeight ?? 0);
          setOverlap(Math.max(0, Math.round(bottomOnScreen - keyboardTop)));
        });
      }, 150);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      if (timer) clearTimeout(timer);
      setOverlap(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, [ref]);

  return overlap;
}
