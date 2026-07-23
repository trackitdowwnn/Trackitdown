/**
 * WHAT:  Toast — transient confirmation pill (success or error) floating
 *        above the bottom of the screen, plus the ToastProvider/useToast
 *        pair any screen calls to show one.
 * WHY:   Non-blocking moments (profile saved, logs copied) need lightweight
 *        confirmation — a FullscreenLoader or alert would be heavier than
 *        the action. One toast at a time (a new one replaces the current),
 *        auto-dismissing after motion.toastVisible; announced to screen
 *        readers via a polite live region. Success is the warm near-black
 *        pill; errors use the muted danger tone — never alarm-red drama.
 * LINKS: src/app/_layout.tsx (provider mounts once at the root);
 *        src/features/profile (first consumer); docs/DESIGN_SYSTEM.md.
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
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, motion, radii, shadows, sizes, spacing, typography } from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';

export type ToastKind = 'success' | 'error';

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

interface ActiveToast {
  message: string;
  kind: ToastKind;
  action?: ToastAction;
  /** Distinguishes back-to-back toasts with identical text. */
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  'use no memo';
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const nextId = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const visible = useSharedValue(0);

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
    }, motion.toastVisible);
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
          style={[styles.host, { bottom: insets.bottom + sizes.tabBar + spacing.lg }]}
          // Only a toast WITH an action may receive taps; a plain toast must
          // never block the screen beneath it.
          pointerEvents={toast.action ? 'box-none' : 'none'}
          testID="toast-host"
        >
          <Animated.View
            style={[styles.pill, toast.kind === 'error' && styles.pillError, animatedStyle]}
            accessibilityLiveRegion="polite"
            accessible={!toast.action}
            accessibilityLabel={toast.message}
            testID={`toast-${toast.kind}`}
          >
            <View style={styles.pillRow}>
              {/* With an action the pill isn't one accessible node — put the
                  live region on the message itself so Android still
                  announces (iOS is covered by announceForAccessibility). */}
              <Text
                style={styles.message}
                numberOfLines={2}
                accessibilityLiveRegion={toast.action ? 'polite' : 'none'}
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
            </View>
          </Animated.View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  // Above the tab bar so it never covers navigation; pointerEvents none so
  // it can't block taps beneath it.
  host: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: '100%',
    ...shadows.soft,
  },
  pillError: {
    backgroundColor: colors.danger,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  message: {
    ...typography.label,
    color: colors.textOnPrimary,
    textAlign: 'center',
    flexShrink: 1,
  },
  // Underline = tappable (design-system convention), on the pill's dark fill.
  actionLabel: {
    ...typography.label,
    color: colors.textOnPrimary,
    textDecorationLine: 'underline',
  },
});
