/**
 * WHAT:  Current software-keyboard height in dp — Android only (returns 0 on
 *        iOS and while the keyboard is hidden).
 * WHY:   Expo SDK 57 forces edge-to-edge on Android, where the window no
 *        longer resizes for the keyboard, so fixed bottom UI (wizard footers,
 *        bottom sheets) must lift itself by the measured keyboard height.
 *        iOS callers pair their layout with KeyboardAvoidingView or a
 *        library's native handling instead, so this deliberately stays 0
 *        there.
 * LINKS: src/shared/wizard/WizardScreen.tsx and src/shared/ui/BottomSheet.tsx
 *        (consumers); gorhom/react-native-bottom-sheet#2674 (why the window
 *        stops resizing).
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useAndroidKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const show = Keyboard.addListener('keyboardDidShow', (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return keyboardHeight;
}
