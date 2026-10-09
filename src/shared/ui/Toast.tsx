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
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
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

export type ToastKind = 'success' | 'error';

/** Words a toast may hold before it earns extra reading time. */
const QUICK_READ_WORDS = 6;

/**
 * How long a toast stays: `motion.toastVisible` for a short one, plus
 * `motion.toastPerWord` for each word past the first few, never past
 * `motion.toastMax` — and an error never under `motion.toastErrorMin`, since
 * it is often the only sign that something failed. "Profile saved" stays
 * 2.5s; "Report taken back — the owner no longer sees it…" (17 words) ~5.8s.
 */
export function toastDuration(message: string, kind: ToastKind): number {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  const reading =
    motion.toastVisible + Math.max(0, words - QUICK_READ_WORDS) * motion.toastPerWord;
  const floor = kind === 'error' ? motion.toastErrorMin : 0;
  return Math.min(motion.toastMax, Math.max(floor, reading));
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

export function ToastProvider({ children, aboveTabBar = false }: ToastProviderProps) {
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const visible = useSharedValue(0);
  // Just above the tab bar on a tab screen; elsewhere clear of a standard
  // sticky footer button, rather than floating over a tab bar that isn't
  // there.
  const bottom = aboveTabBar
    ? insets.bottom + sizes.tabBar + spacing.md
    : insets.bottom + sizes.control + spacing.xl;

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
    // The live region below covers Android; iOS VoiceOver needs an explicit
    // announcement — error toasts are often the ONLY surfacing of a failure.
    AccessibilityInfo.announceForAccessibility(toast.message);
    visible.value = withTiming(1, {
      duration: reduceMotion ? 0 : motion.fast,
      easing: easeOut,
    });
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }
    hideTimer.current = setTimeout(() => {
      visible.value = withTiming(0, { duration: reduceMotion ? 0 : motion.fast });
      // Unmount after the fade so the live region isn't clipped mid-announce.
      hideTimer.current = setTimeout(() => setToast(null), motion.fast);
    }, toastDuration(toast.message, toast.kind));
    return () => {
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
          style={[styles.host, { bottom }]}
          // Only a toast WITH an action may receive taps; a plain toast must
          // never block the screen beneath it.
          pointerEvents={toast.action ? 'box-none' : 'none'}
          testID="toast-host"
        >
          <Animated.View
            style={[styles.card, animatedStyle]}
            accessibilityLiveRegion="polite"
            accessible={!toast.action}
            accessibilityLabel={toast.message}
            testID={`toast-${toast.kind}`}
          >
            {/* Which kind, at a glance — hidden from screen readers, which
                hear the message itself. iconSm (18) matches the label's
                line height, so it sits level with the first line. */}
            <View
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
                (iOS is covered by announceForAccessibility). No line cap: a
                toast says all of what it has to say. */}
            <Text
              style={styles.message}
              accessibilityLiveRegion={toast.action ? 'polite' : 'none'}
              testID="toast-message"
            >
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
                onPress={runAction}
                // Tops the label line up to the 44pt minimum target.
                hitSlop={spacing.lg}
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
    // pointerEvents none (above) so it can't block taps beneath it.
    host: {
      position: 'absolute',
      left: spacing.lg,
      right: spacing.lg,
    },
    // A light FLOATING card (DESIGN_SYSTEM: "shadow means floating — map
    // chrome, sheets, slider thumbs, toasts"). The hairline is load-bearing
    // in dark mode, where `surface` on `background` is #1E1E1E on #141414 and
    // the shadow barely registers.
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: c.surface,
      borderRadius: radii.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      ...shadows.lifted,
    },
    message: {
      ...typography.label,
      color: c.textPrimary,
      flex: 1,
    },
    // Underline = tappable (design-system convention).
    actionLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
