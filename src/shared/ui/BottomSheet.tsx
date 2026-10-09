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
 *        Always dismissable: swipe down, tap the scrim, or Android Back (which
 *        closes the sheet and nothing else). Keyboard-aware so
 *        TextFields inside stay visible while typing: iOS uses the library's
 *        interactive behaviour; Android pads the sheet content by the keyboard
 *        height instead, because edge-to-edge breaks the library's own
 *        handling (see useAndroidKeyboardHeight) — and, since 2026-10-09,
 *        scrolls the focused input into the strip above the keyboard once
 *        a tall sheet has hit its height cap and can only scroll.
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
  type BottomSheetScrollViewMethods,
} from '@gorhom/bottom-sheet';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  BackHandler,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAndroidKeyboardHeight } from '../hooks';
import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { TextInputHostContext } from './TextInputHost';

/** Open/close animation, per the design system's 200–250ms ease-out rule. */
const ANIMATION_DURATION_MS = 250;

/** Content-fit sizing is capped at this share of the window so the sheet
 *  always reads as a sheet (never a full screen) and leaves the scrim
 *  visible as a dismiss target. */
const MAX_HEIGHT_RATIO = 0.9;

/** The scroll content's top padding — also where the measured content view
 *  starts, for the keyboard reveal below. */
const CONTENT_PADDING_TOP = spacing.sm;

/** Room kept clear below a focused input when it is scrolled above the
 *  keyboard — enough for a TextField's helper/counter row beneath it. */
const REVEAL_MARGIN = spacing.xxxl;

/**
 * Where the sheet's scroll view must sit so a focused input's bottom (plus
 * `margin`) clears the keyboard — or null when it is already in view. All
 * values in the scroll CONTENT's coordinates except `viewport`, the scroll
 * view's own height, and `covered`, how much of its bottom the keyboard hides.
 * An input taller than the visible strip is aligned by its TOP instead, so the
 * start of what is being typed is never pushed off the top; an input scrolled
 * off the top is brought back to it. Exported for its tests.
 */
export function sheetRevealOffset({
  inputTop,
  inputBottom,
  scrollY,
  viewport,
  covered,
  margin,
}: {
  inputTop: number;
  inputBottom: number;
  scrollY: number;
  viewport: number;
  covered: number;
  margin: number;
}): number | null {
  const visible = viewport - covered;
  if (visible <= 0) return null;
  if (inputTop < scrollY) return inputTop;
  const wanted = inputBottom + margin;
  if (wanted <= scrollY + visible) return null;
  return Math.max(0, Math.min(wanted - visible, inputTop));
}

/** The open sheet's "reveal the focused input" — what SheetTextInput calls
 *  when a field takes focus. A no-op outside a sheet. */
const SheetRevealContext = createContext<() => void>(() => {});

/**
 * The input every TextField in a sheet renders: gorhom's sheet-aware
 * BottomSheetTextInput, which also tells the sheet when it takes focus. With
 * the keyboard already up, moving to another field changes neither the
 * keyboard height nor the content size, so without this nothing would bring
 * the newly focused field above the keyboard.
 */
function SheetTextInput({ onFocus, ...props }: TextInputProps) {
  const reveal = useContext(SheetRevealContext);
  return (
    <BottomSheetTextInput
      // React 19: a `ref` from HostTextInput arrives as a prop and is
      // forwarded by this spread (gorhom types its ref with
      // gesture-handler's TextInput, so it is not named here).
      {...props}
      onFocus={(event) => {
        onFocus?.(event);
        reveal();
      }}
    />
  );
}

/**
 * The sheet body's side padding. Exported so full-bleed content inside a sheet
 * (a scrollable ChoiceChips row takes it as `bleed`) reaches the true edge
 * without hard-coding a number that could drift from this one.
 */
export const SHEET_GUTTER = spacing.xl;

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
  const styles = useThemedStyles(makeStyles);
  const modalRef = useRef<BottomSheetModal>(null);
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Height to lift the sheet content clear of the software keyboard, Android
  // only. On iOS the library's keyboardBehavior="interactive" translates the
  // sheet natively; on Android that mechanism is broken under edge-to-edge
  // (always on in Expo SDK 57+), so the keyboard height is added to the
  // content's bottom padding — enableDynamicSizing re-measures the taller
  // content and raises the sheet. Do NOT feed this into the modal's
  // `bottomInset` instead: the library never re-applies that prop's runtime
  // changes (verified against @gorhom/bottom-sheet 5.2.14), so the sheet
  // would not move.
  const keyboardLift = useAndroidKeyboardHeight();

  // ⚠️ THE LIFT ALONE IS NOT ENOUGH ONCE THE SHEET IS AT ITS CAP (2026-10-09,
  // owner report: "the keyboard covers what they are typing" in the withdraw
  // sheet's note box). The padding raises a SHORT sheet clear of the
  // keyboard, but a tall one stops growing at MAX_HEIGHT_RATIO and starts
  // scrolling instead — and nothing scrolled, so an input in its lower half
  // stayed under the keyboard. So while the keyboard is up, the focused input
  // is scrolled into the strip above it: when the keyboard arrives; when the
  // scroll view settles at its new height; when focus moves to another field
  // (SheetTextInput, below); and when content past the cap changes size (a
  // multiline field growing a line as they type).
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const contentRef = useRef<View>(null);
  const viewportHeight = useRef(0);
  const scrollY = useRef(0);
  const revealFocusedInput = useCallback(() => {
    if (keyboardLift === 0) return;
    const input = TextInput.State.currentlyFocusedInput();
    const content = contentRef.current;
    if (!input || !content) return;
    input.measureLayout(
      content,
      (_x, y, _width, height) => {
        // The content view starts below the container's top padding.
        const inputTop = CONTENT_PADDING_TOP + y;
        const offset = sheetRevealOffset({
          inputTop,
          inputBottom: inputTop + height,
          scrollY: scrollY.current,
          viewport: viewportHeight.current,
          // The keyboard's reported height excludes the navigation bar, which
          // the sheet also sits behind.
          covered: keyboardLift + insets.bottom,
          margin: REVEAL_MARGIN,
        });
        if (offset !== null) scrollRef.current?.scrollTo({ y: offset, animated: true });
      },
      // Not inside this sheet (another screen's input) — nothing to reveal.
      () => {},
    );
  }, [keyboardLift, insets.bottom]);

  // gorhom forwards this from its UI-thread handler, already throttled.
  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  // When the keyboard arrives: after the sheet has had its open/resize
  // animation to grow into the lift.
  useEffect(() => {
    if (keyboardLift === 0) return;
    const timer = setTimeout(revealFocusedInput, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [keyboardLift, revealFocusedInput]);

  // Whether the sheet is presented (or presenting/dismissing). Calling the
  // library's dismiss() on a NON-presented modal wedges it permanently: its
  // internal status becomes DISMISSING with no animation to complete it, and
  // every later present() is silently skipped. close() must therefore be a
  // no-op unless the sheet was actually opened (verified against
  // @gorhom/bottom-sheet 5.2.14, BottomSheetModal handleDismiss/
  // handlePortalRender).
  const presentedRef = useRef(false);

  // Whether the sheet is actually ON SCREEN, for the Back handler below. Taken
  // from gorhom's onChange (index ≥ 0 once it has opened), not from open():
  // a present the library skips would otherwise leave Back swallowed on this
  // screen until it unmounted (2026-09-30 review).
  const [presented, setPresented] = useState(false);

  // ⚠️ ANDROID BACK CLOSES THE SHEET. Neither this wrapper nor gorhom 5.2.14
  // handled it, so Back went to the screen underneath: it popped the route
  // with the sheet still up (the sheet then slid down over the PREVIOUS
  // screen), or the map cleared its card and left the sheet over nothing
  // (2026-09-30 review of the report safety sheet). Registered on open, so it
  // runs before any handler a screen registered earlier (Android runs the
  // newest first), and consumed so Back does one thing. A screen that
  // re-registers while a sheet is up would jump the queue, which is why
  // WizardScreen registers its handler once.
  useEffect(() => {
    if (!presented) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      modalRef.current?.dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [presented]);

  const handleModalDismiss = useCallback(() => {
    // The modal unmounts its content on dismiss, so the next open starts a
    // fresh scroll view at 0 — and no scroll event says so. A stale offset
    // here would make the reveal think the input was already in view.
    scrollY.current = 0;
    presentedRef.current = false;
    setPresented(false);
    onDismiss?.();
  }, [onDismiss]);

  useImperativeHandle(ref, () => ({
    open: () => {
      presentedRef.current = true;
      modalRef.current?.present();
    },
    close: () => {
      if (presentedRef.current) {
        modalRef.current?.dismiss();
      }
    },
  }));

  const animationConfigs = useBottomSheetTimingConfigs({
    duration: ANIMATION_DURATION_MS,
    easing: easeOut,
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
    // `styles` is memoised per palette, so this identity is stable until the
    // theme actually flips.
    [styles],
  );

  return (
    <BottomSheetModal
      ref={modalRef}
      onDismiss={handleModalDismiss}
      onChange={(index) => setPresented(index >= 0)}
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
        ref={scrollRef}
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
        // What the reveal above measures against: the scroll view's own
        // height (and, once it settles at a new height with the keyboard up,
        // a reveal against it) and where it is scrolled to.
        onLayout={(event) => {
          viewportHeight.current = event.nativeEvent.layout.height;
          revealFocusedInput();
        }}
        onScroll={handleScroll}
        // ⚠️ Only for content PAST THE CAP. Below it the sheet is about to
        // grow to fit (dynamic sizing), so revealing against the short,
        // pre-grow viewport would scroll the content up and let it snap back
        // — a jiggle on every short form (review of this fix).
        onContentSizeChange={(_width, height) => {
          if (height > windowHeight * MAX_HEIGHT_RATIO) revealFocusedInput();
        }}
      >
        {/* collapsable={false}: a real native view, so an input can measure
            itself against it. */}
        <View ref={contentRef} collapsable={false}>
          {title ? (
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
          ) : null}
          {/* Any TextField in the body renders gorhom's sheet-aware input
              (via SheetTextInput), which is what makes the sheet rise with
              the keyboard instead of being covered by it — and tells this
              sheet when focus moves, so the new field is revealed too. */}
          <SheetRevealContext.Provider value={revealFocusedInput}>
            <TextInputHostContext.Provider value={SheetTextInput}>
              {children}
            </TextInputHostContext.Provider>
          </SheetRevealContext.Provider>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    background: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
    },
    handleIndicator: {
      backgroundColor: c.border,
      width: sizes.grabberWidth,
      height: sizes.grabberHeight,
      borderRadius: radii.sm,
    },
    backdrop: {
      backgroundColor: c.overlay,
    },
    content: {
      paddingHorizontal: SHEET_GUTTER,
      paddingTop: CONTENT_PADDING_TOP,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
      marginBottom: spacing.lg,
    },
  });
