/**
 * WHAT:  Toast — a transient confirmation card (success or error) floating
 *        above the bottom of the screen, plus the ToastProvider/useToast
 *        pair any screen calls to show one.
 * WHY:   Non-blocking moments (profile saved, logs copied) need lightweight
 *        confirmation — a FullscreenLoader or alert would be heavier than
 *        the action. One toast at a time (a new one replaces the current);
 *        announced to screen readers via a polite live region.
 *
 *        ⚠️ REDESIGNED 2026-10-09 (owner: "plain / off-style", "hard to tell
 *        good vs bad", "long messages look wrong"). Was a near-black pill,
 *        text only, cut to two lines and gone in 2.5s whatever it said.
 *        Now a light floating CARD — `surface`, `lg` radius, hairline edge,
 *        the floating shadow — with a leading icon that says which kind it
 *        is at a glance (a `success` tick, a `danger` alert; the error is the
 *        same calm card, never a red slab). The text WRAPS FULLY, and the
 *        toast stays for as long as it takes to read (toastDuration).
 *        Placed just above the tab bar on tab screens and clear of a footer
 *        button elsewhere, rather than everywhere pretending a tab bar exists.
 * LINKS: src/app/_layout.tsx (provider mounts once at the root);
 *        src/shared/theme/motion.ts (toast timings); docs/DESIGN_SYSTEM.md
 *        (Core components: Toast).
 *
 * Usage:
 *   const toast = useToast();
 *   toast.show('Profile saved');
 *   toast.show('Something went wrong', 'error');
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';

import { useAndroidKeyboardHeight } from '../hooks';

export type ToastKind = 'success' | 'error';

/** A screen's sticky footer above the safe area — StickyActionBar's (and
 *  PostBottomBar's) 12 + 52pt button + 12. Off the tabs the toast floats a
 *  gap above it, never flush on its hairline (review of the redesign). */
const FOOTER_BAR_HEIGHT = spacing.md + sizes.control + spacing.md;

/**
 * How long a toast stays: `motion.toastVisible` for a short one, plus
 * `motion.toastPerWord` for each word past the first few, never past
 * `motion.toastMax` — and never under `motion.toastErrorMin` for an error
 * (often the only sign that something failed) or a toast with an action (a
 * screen-reader user needs time to reach its button). "Profile saved" stays
 * 2.5s; "Report taken back — the owner no longer sees it…" (17 words) ~5.8s.
 */
export function toastDuration(message: string, kind: ToastKind, hasAction = false): number {
  // Real words only — a standalone "—" is punctuation, not reading.
  const words = message.split(/\s+/).filter((word) => /\w/.test(word)).length;
  const reading =
    motion.toastVisible + Math.max(0, words - motion.toastQuickReadWords) * motion.toastPerWord;
  const floor = kind === 'error' || hasAction ? motion.toastErrorMin : 0;
  return Math.min(motion.toastMax, Math.max(floor, reading));
}

/** What a screen reader hears. The icon is the only visual sign of the kind,
 *  so an error says so in words ("Error: …", WCAG 1.3.1); a success needs no
 *  prefix — its message says what happened. */
function spokenToast(toast: { message: string; kind: ToastKind }): string {
  return toast.kind === 'error' ? `Error: ${toast.message}` : toast.message;
}

/**
 * The software keyboard's height, on both platforms: Android's measured lift
 * (useAndroidKeyboardHeight — edge-to-edge stops the window resizing) and
 * iOS's will-show/will-hide frames. NOT Reanimated's useAnimatedKeyboard,
 * which takes over the window-insets listener on edge-to-edge Android.
 */
function useKeyboardHeight(): number {
  const androidHeight = useAndroidKeyboardHeight();
  const [iosHeight, setIosHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (event) =>
      setIosHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setIosHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return Platform.OS === 'ios' ? iosHeight : androidHeight;
}

/** Optional inline action ("View") — pressing runs it and dismisses. */
export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastValue {
  /** Show a toast; a new call replaces the current one. */
  show: (message: string, kind?: ToastKind, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

/** The app's toast — `show(message, kind?, action?)`. Throws outside a
 *  ToastProvider, because a screen that lost its provider has a real bug. */
export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return context;
}

/**
 * The same value, or null when no provider is above — for LEAF PRIMITIVES whose
 * toast is a courtesy rather than the point (PlateChip's copy confirmation).
 *
 * The throwing `useToast` is still the right hook for a screen: a screen that
 * lost its provider has a real bug and should say so loudly. But a primitive
 * rendered in seven places must not make mounting a ToastProvider a condition
 * of rendering a plate — every existing test renders these cards bare, and the
 * app's own provider lives at the root anyway (src/app/_layout.tsx), so null
 * here means "a test harness", never a user-facing gap.
 */
export function useOptionalToast(): ToastValue | null {
  return useContext(ToastContext);
}

interface ActiveToast {
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  /** Distinguishes back-to-back toasts with identical text. */
  id: number;
}

export interface ToastProviderProps {
  children: ReactNode;
  /**
   * Whether the screen showing is a TAB screen, so the toast sits just above
   * the tab bar; otherwise it clears a standard footer button. The root
   * layout knows the route and passes it — this primitive stays router-free.
   */
  aboveTabBar?: boolean;
}

/** Mounts ONCE at the root (src/app/_layout.tsx, which passes `aboveTabBar`)
 *  and hosts the app's single toast above every screen. */
export function ToastProvider({ children, aboveTabBar = false }: ToastProviderProps) {
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const visible = useSharedValue(0);
  const keyboard = useKeyboardHeight();
  // Just above the tab bar on a tab screen; elsewhere clear of a standard
  // sticky footer button, rather than floating over a tab bar that isn't
  // there. ⚠️ With the keyboard up, above IT (UI review): a "Couldn't save"
  // behind the keyboard is a failure nobody sees. Off the tabs the footer
  // rides the keyboard too (StickyActionBar lifts by it), so the toast
  // still clears it; on the tabs the bar is behind the keyboard.
  const bottom =
    insets.bottom +
    keyboard +
    (aboveTabBar
      ? (keyboard > 0 ? 0 : sizes.tabBar) + spacing.md
      : FOOTER_BAR_HEIGHT + spacing.md);

  const show = useCallback(
    (message: string, kind: ToastKind = 'success', action?: ToastAction) => {
      nextId.current += 1;
      setToast({ message, kind, action, id: nextId.current });
    },
    [],
  );

  // Action press: run, then dismiss NOW (instant unmount — the user acted;
  // no shared-value writes here, the show effect owns the animation).
  const runAction = useCallback(() => {
    const action = toast?.action;
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    setToast(null);
    action?.onPress();
  }, [toast]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    // The live region below covers Android — announcing there too made
    // TalkBack say it twice (UI review). iOS VoiceOver needs the explicit
    // announcement, QUEUED so it never cuts off what is being read — error
    // toasts are often the ONLY surfacing of a failure.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(spokenToast(toast), { queue: true });
    }
    visible.value = withTiming(1, {
      duration: reduceMotion ? 0 : motion.fast,
      easing: easeOut,
    });
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    let cancelled = false;
    const scheduleHide = (after: number) => {
      if (cancelled) return;
      hideTimer.current = setTimeout(() => {
        visible.value = withTiming(0, {
          duration: reduceMotion ? 0 : motion.fast,
          easing: easeOut,
        });
        // Unmount after the fade so the live region isn't clipped mid-announce.
        hideTimer.current = setTimeout(() => setToast(null), motion.fast);
      }, after);
    };
    const duration = toastDuration(toast.message, toast.kind, Boolean(toast.action));
    // Android's "Time to take action" accessibility setting can ask for
    // longer (WCAG 2.2.1); iOS has no such setting.
    if (Platform.OS === 'android') {
      AccessibilityInfo.getRecommendedTimeoutMillis(duration).then(
        (recommended) => scheduleHide(Math.max(duration, recommended)),
        () => scheduleHide(duration),
      );
    } else {
      scheduleHide(duration);
    }
    return () => {
      cancelled = true;
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
      }
    };
  }, [toast, reduceMotion, visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateY: (1 - visible.value) * spacing.md }],
  }));

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          // Only a toast WITH an action may receive taps; a plain toast must
          // never block the screen beneath it.
          style={[styles.host, { bottom, pointerEvents: toast.action ? 'box-none' : 'none' }]}
          testID="toast-host"
        >
          <Animated.View
            style={[styles.card, animatedStyle]}
            accessibilityLiveRegion="polite"
            accessible={!toast.action}
            accessibilityLabel={spokenToast(toast)}
            testID={`toast-${toast.kind}`}
          >
            {/* Which kind, at a glance — hidden from screen readers, which
                hear "Error: …" instead. Boxed to the first line's height AS
                SCALED, so it stays level with it at large text sizes. */}
            <View
              style={[styles.iconBox, { height: typography.label.lineHeight * (fontScale ?? 1) }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID={`toast-icon-${toast.kind}`}
            >
              {toast.kind === 'error' ? (
                <CircleAlert size={sizes.iconSm} color={palette.danger} />
              ) : (
                <CircleCheck size={sizes.iconSm} color={palette.success} />
              )}
            </View>
            {/* With an action the card isn't one accessible node — put the
                live region on the message itself so Android still announces
                (iOS is covered by the announcement above). No line cap: a
                toast says all of what it has to say. */}
            <Text
              style={styles.message}
              accessibilityLiveRegion={toast.action ? 'polite' : 'none'}
              accessibilityLabel={toast.action ? spokenToast(toast) : undefined}
              testID="toast-message"
            >
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                onPress={runAction}
                // A real 44pt box, not hitSlop: Android delivers no touch
                // outside the card, and a one-line card is only 42pt tall.
                style={styles.action}
              >
                <Text style={styles.actionLabel}>{toast.action.label}</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The screen's own 24pt gutter, so the card lines up with its content
    // and footer buttons.
    host: {
      position: 'absolute',
      left: spacing.xl,
      right: spacing.xl,
    },
    // A light FLOATING card (DESIGN_SYSTEM: "shadow means floating — map
    // chrome, sheets, slider thumbs, toasts"). `surfaceFloating` steps it up
    // the ladder in dark, where the shadow barely registers and a `surface`
    // card would melt into the cards beneath it; the hairline then reads.
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: c.surfaceFloating,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      ...shadows.lifted,
    },
    iconBox: {
      justifyContent: 'center',
    },
    message: {
      ...typography.label,
      color: c.textPrimary,
      flex: 1,
      // Beside an icon (DESIGN_SYSTEM): Satoshi's font padding would push
      // the line below the icon on Android.
      includeFontPadding: false,
    },
    // Fills the card's height (cancelling its vertical padding) to reach the
    // 44pt target while the label stays level with the first line.
    action: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      marginVertical: -spacing.md,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    // Underline = tappable (design-system convention).
    actionLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
