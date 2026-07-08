/**
 * WHAT:  BottomSheet — the app's modal bottom sheet primitive. A themed
 *        wrapper around @gorhom/bottom-sheet's BottomSheetModal with a drag
 *        handle, optional title header, scrollable content, a scrim backdrop,
 *        and keyboard handling.
 * WHY:   Sheets are how the app presents focused tasks over any screen
 *        (filters, actions, detail peeks) and they must all look and behave
 *        identically. Screens control it through a ref (open()/close()),
 *        matching the library's imperative present/dismiss model, so any
 *        handler can open it without lifting state. It auto-sizes to its
 *        content (capped below full screen); taller content scrolls inside.
 *        Always dismissable: swipe down or tap the scrim. Keyboard-aware so
 *        TextFields inside stay visible while typing: iOS uses the library's
 *        interactive behaviour; Android pads the sheet content by the keyboard
 *        height instead, because edge-to-edge breaks the library's own
 *        handling (see useAndroidKeyboardLift).
 *        Inputs inside the sheet must go through TextField / the
 *        TextInputHost context so the sheet is told about the keyboard.
 *        Styling is tokens-only
 *        (docs/DESIGN_SYSTEM.md): `surface` sheet with `xl` top radius,
 *        `overlay` scrim, `border` grabber, 250ms ease-out motion.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour, Radii, Motion, Accessibility);
 *        src/app/_layout.tsx (BottomSheetModalProvider + GestureHandlerRootView
 *        must wrap the app); src/shared/theme.
 *
 * Usage:
 *   const sheetRef = useRef<BottomSheetRef>(null);
 *   <Pressable onPress={() => sheetRef.current?.open()} />
 *   <BottomSheet ref={sheetRef} title="Filters" onDismiss={clearDraft}>
 *     <Text>Sheet content</Text>
 *   </BottomSheet>
 */

import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  useBottomSheetTimingConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Keyboard, Platform, StyleSheet, Text, useWindowDimensions } from 'react-native';
import { Easing } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, sizes, spacing, typography } from '../theme';
import { TextInputHostContext } from './TextInputHost';

/** Open/close animation, per the design system's 200–250ms ease-out rule. */
const ANIMATION_DURATION_MS = 250;

/** Content-fit sizing is capped at this share of the window so the sheet
 *  always reads as a sheet (never a full screen) and leaves the scrim
 *  visible as a dismiss target. */
const MAX_HEIGHT_RATIO = 0.9;

export interface BottomSheetRef {
  /** Present the sheet over the current screen. */
  open: () => void;
  /** Dismiss the sheet (also fires onDismiss). */
  close: () => void;
}

export interface BottomSheetProps {
  /** Imperative handle — sheetRef.current?.open() / .close(). */
  ref?: Ref<BottomSheetRef>;
  /** Optional heading row, announced as a header to screen readers. */
  title?: string;
  /** Sheet body. Scrolls inside the sheet when taller than the height cap. */
  children: ReactNode;
  /** Fires after the sheet closes — swipe, scrim tap, or close(). */
  onDismiss?: () => void;
}

export function BottomSheet({ ref, title, children, onDismiss }: BottomSheetProps) {
  const modalRef = useRef<BottomSheetModal>(null);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboardLift = useAndroidKeyboardLift();

  useImperativeHandle(ref, () => ({
    open: () => modalRef.current?.present(),
    close: () => modalRef.current?.dismiss(),
  }));

  const animationConfigs = useBottomSheetTimingConfigs({
    duration: ANIMATION_DURATION_MS,
    easing: Easing.out(Easing.quad),
  });

  // The scrim: fades with the sheet, closes it on tap. opacity={1} hands the
  // final translucency to the `overlay` token's own alpha.
  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior="close"
        style={[backdropProps.style, styles.backdrop]}
        accessibilityLabel="Close sheet"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      onDismiss={onDismiss}
      enablePanDownToClose
      enableDynamicSizing
      maxDynamicContentSize={windowHeight * MAX_HEIGHT_RATIO}
      animationConfigs={animationConfigs}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.background}
      handleIndicatorStyle={styles.handleIndicator}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        // VoiceOver escape gesture (two-finger Z) closes the sheet. Do NOT set
        // accessibilityViewIsModal here — it would hide the sibling backdrop
        // (the labelled "Close sheet" control) from screen readers.
        onAccessibilityEscape={() => modalRef.current?.dismiss()}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          // keyboardLift (Android only) grows the content by the keyboard
          // height so dynamic sizing raises the sheet clear of the keyboard.
          { paddingBottom: insets.bottom + spacing.xl + keyboardLift },
        ]}
      >
        {title ? (
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
        ) : null}
        {/* Any TextField in the body renders gorhom's sheet-aware input, which
            is what makes the sheet rise with the keyboard instead of being
            covered by it. */}
        <TextInputHostContext.Provider value={BottomSheetTextInput}>
          {children}
        </TextInputHostContext.Provider>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

/**
 * Height to lift the sheet content clear of the software keyboard, Android only.
 *
 * On iOS the library's keyboardBehavior="interactive" translates the sheet
 * natively. On Android that mechanism is broken under edge-to-edge (always on
 * in Expo SDK 57+): the window no longer resizes, so
 * android_keyboardInputMode="adjustResize" is a no-op and the keyboard just
 * covers the sheet (gorhom/react-native-bottom-sheet#2674). So we watch the
 * keyboard ourselves and add its height to the content's bottom padding —
 * enableDynamicSizing re-measures the taller content and raises the sheet.
 *
 * Do NOT feed this into the modal's `bottomInset` instead: the library reads
 * that prop's runtime changes but never re-applies them (its useAnimatedLayout
 * reactions early-exit when the container height itself is unchanged), so the
 * sheet never moves. Verified against @gorhom/bottom-sheet 5.2.14.
 */
function useAndroidKeyboardLift(): number {
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

const styles = StyleSheet.create({
  background: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
  },
  handleIndicator: {
    backgroundColor: colors.border,
    width: sizes.grabberWidth,
    height: sizes.grabberHeight,
    borderRadius: radii.sm,
  },
  backdrop: {
    backgroundColor: colors.overlay,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
});
