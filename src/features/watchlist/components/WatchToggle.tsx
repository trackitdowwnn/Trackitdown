/**
 * WHAT:  WatchToggle — the bookmark that adds/removes a post from the
 *        watchlist: circular surface button, Bookmark fills when watched,
 *        with the Airbnb pop (springBouncy scale + light haptic; reduced
 *        motion → plain swap). All behaviour (gate, optimistic write,
 *        Toasts, logging) comes from useWatchToggle.
 * WHY:   One component renders on every surface (VehicleCard's
 *        topRightAction slot, the post-detail header) so the toggle looks
 *        and behaves identically everywhere. Bookmark, deliberately not a
 *        heart: this is vigilance, not desire. Haptics degrade silently
 *        where the module isn't in the binary yet (lazy require — house
 *        pattern).
 * LINKS: src/features/watchlist/hooks/useWatchToggle.ts (the behaviour);
 *        src/shared/ui/VehicleCard.tsx (the reserved slot);
 *        docs/DESIGN_SYSTEM.md (Motion, touch targets).
 */

import { Bookmark } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { colors, motion, radii, shadows, sizes } from '@/shared/theme';

import { useWatchToggle } from '../hooks/useWatchToggle';
import { consumeUserToggled } from '../lib/watchedStore';
import type { WatchToggleSource } from '../types';

/** Light impact, silently skipped when the native module isn't present. */
function popHaptic(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy load
    const haptics = require('expo-haptics') as {
      impactAsync(style: unknown): Promise<void>;
      ImpactFeedbackStyle: { Light: unknown };
    };
    void haptics.impactAsync(haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // Not in this binary yet — the pop animation still lands.
  }
}

export interface WatchToggleProps {
  postId: string;
  /** Logging dimension — which surface hosted the tap. */
  source: WatchToggleSource;
  testID?: string;
}

export function WatchToggle({ postId, source, testID }: WatchToggleProps) {
  const { watched, toggle } = useWatchToggle(postId, source);
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // The pop fires only on USER-initiated flips (tap, or a gate continuation
  // completing the tap post-auth) — consumed from the store's mark, so a
  // hydration landing never makes every watched card pop at once, and
  // recycled/remounted cards stay still (code review 2026-07-22).
  useEffect(() => {
    const userDidThis = consumeUserToggled(postId);
    if (watched && userDidThis) {
      popHaptic();
      if (!reduceMotion) {
        // springStandard, not springBouncy: the motion rules reserve bouncy
        // for reward moments (recovery); the 1.25 overshoot sequence still
        // reads as the Airbnb pop at the calmer spring.
        scale.value = withSequence(
          withSpring(1.25, motion.springStandard),
          withSpring(1, motion.springGentle),
        );
      }
    }
  }, [watched, postId, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={watched ? 'Remove from your watchlist' : 'Add to your watchlist'}
      accessibilityState={{ selected: watched }}
      onPress={toggle}
      // Visual circle is circleButtonSm; the hitSlop tops the touch target
      // up to the 44pt minimum (DESIGN_SYSTEM accessibility).
      hitSlop={(sizes.touchTarget - sizes.circleButtonSm) / 2}
      style={styles.circle}
      testID={testID}
    >
      <Animated.View style={animatedStyle}>
        <Bookmark
          size={sizes.iconSm}
          color={watched ? colors.primary : colors.textPrimary}
          fill={watched ? colors.primary : 'transparent'}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A real surface circle (like the map back button): the bookmark must stay
  // legible over any photo. Lifted shadow per that precedent.
  circle: {
    width: sizes.circleButtonSm,
    height: sizes.circleButtonSm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lifted,
  },
});
