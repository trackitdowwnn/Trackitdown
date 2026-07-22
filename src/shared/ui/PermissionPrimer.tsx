/**
 * WHAT:  PermissionPrimer — the calm explain-before-you-ask screen shown
 *        ahead of an OS permission prompt, and (as `variant="denied"`) the
 *        acknowledging screen when the OS is blocked: a large illustration,
 *        display-scale benefit headline, ONE reassurance paragraph, and
 *        bottom-anchored actions (primary + optional honest ghost opt-out).
 *        Content is config-driven via PermissionPrimerContent so the same
 *        permission can be primed with different stakes per flow — consumers
 *        pass a content object, never fork the layout.
 * WHY:   OS prompts convert far better when the user already knows the
 *        benefit, and a blocked permission needs a route to Settings rather
 *        than a dead re-prompt. Copy rules: headline = the user's benefit
 *        (never "We need…"), body = what happens + a reassurance that is
 *        TRUE per docs/SECURITY_AND_TRUST.md. The ghost opt-out stays a
 *        full-size legible button — a screenshot of this screen must look
 *        fair to an App Store reviewer (no dark patterns). Purely
 *        presentational — the CONSUMER owns when to request, what "without"
 *        means, and the actual permission/settings APIs; during the OS
 *        dialog the primer stays mounted and steady underneath.
 * LINKS: src/shared/ui/CameraCapture.tsx (camera permission);
 *        src/features/sightings (location priming + camera content);
 *        src/features/profile (avatar photos denied sheet);
 *        src/features/auth/components/OnboardingSlide.tsx (shared art
 *        language: 60%-width surfaceSubtle circle + emoji placeholder);
 *        docs/DESIGN_SYSTEM.md (Tone of voice, Motion).
 */

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import {
  colors,
  displayFontScaleCap,
  motion,
  radii,
  sizes,
  spacing,
  typography,
} from '../theme';
import { Button } from './Button';

/** TODO(art): emoji are placeholders for final illustrations (same art
 *  language as onboarding — swap the emoji for artwork in one place). */
export interface PermissionPrimerContent {
  /** Placeholder illustration — decorative, never read aloud. */
  emoji: string;
  /** The user's benefit, sentence case ("Pin it to the exact spot"). */
  headline: string;
  /** ONE paragraph: what happens + a reassurance verified against
   *  docs/SECURITY_AND_TRUST.md. Primers die by bullet-list. */
  body: string;
  /** Primary label naming the OS moment ("Allow location") — the app-wide
   *  convention; the denied variant's primary is always "Open settings". */
  allowLabel: string;
  /** Optional honest opt-out ("Continue without location", "Not now") —
   *  rendered only when the consumer also wires onSecondary. */
  secondaryLabel?: string;
  /** Copy for the OS-blocked state — acknowledging, never sulking. */
  denied?: {
    headline: string;
    body: string;
    secondaryLabel?: string;
  };
}

export interface PermissionPrimerProps {
  content: PermissionPrimerContent;
  /** 'denied' = the OS will no longer ask (canAskAgain=false): denied copy,
   *  primary becomes "Open settings". Consumers own the flag. */
  variant?: 'ask' | 'denied';
  /** Ask: fire the OS prompt. Denied: open system settings. */
  onPrimary: () => void;
  /** Enables the ghost opt-out (label comes from content). */
  onSecondary?: () => void;
  /** Default true: the primer scrolls when its container is too short, so
   *  the actions are ALWAYS reachable (small phones, large type). Pass false
   *  inside surfaces that already scroll (e.g. a BottomSheet). */
  scroll?: boolean;
  /** Default true. Pass false when the host screen already announces its own
   *  header (e.g. a wizard step question) — one header per screen. */
  announceAsHeader?: boolean;
  testID?: string;
}

/** Staggered fade-up per the motion system (same idiom as Inbox/PostSightings
 *  list entrances): standard duration, listStagger delay per block,
 *  ReduceMotion.System collapses it to a plain render (WCAG 2.3.3). */
function enterAt(order: number) {
  return FadeInDown.duration(motion.standard)
    .delay(order * motion.listStagger)
    .reduceMotion(ReduceMotion.System);
}

export function PermissionPrimer({
  content,
  variant = 'ask',
  onPrimary,
  onSecondary,
  scroll = true,
  announceAsHeader = true,
  testID,
}: PermissionPrimerProps) {
  const denied = variant === 'denied' ? content.denied : undefined;
  const headline = denied?.headline ?? content.headline;
  const body = denied?.body ?? content.body;
  const primaryLabel = variant === 'denied' ? 'Open settings' : content.allowLabel;
  const secondaryLabel =
    variant === 'denied' ? content.denied?.secondaryLabel : content.secondaryLabel;

  const inner = (
    <>
      <View style={styles.illustrationArea}>
        <Animated.View
          entering={enterAt(0)}
          style={styles.illustrationCircle}
          // Decorative only — screen readers land on the headline first.
          // Both props: importantForAccessibility is Android-only,
          // accessibilityElementsHidden covers iOS (house idiom).
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={styles.emoji} maxFontSizeMultiplier={1}>
            {content.emoji}
          </Text>
        </Animated.View>
      </View>

      <Animated.View entering={enterAt(1)} style={styles.textBlock}>
        <Text
          accessibilityRole={announceAsHeader ? 'header' : undefined}
          style={styles.headline}
          maxFontSizeMultiplier={displayFontScaleCap}
        >
          {headline}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </Animated.View>

      {/* Both actions are full-width Buttons — the opt-out is a real,
          legible ghost button, never fine print. */}
      <Animated.View entering={enterAt(2)} style={styles.actions}>
        <Button label={primaryLabel} onPress={onPrimary} />
        {secondaryLabel && onSecondary ? (
          <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} />
        ) : null}
      </Animated.View>
    </>
  );

  if (!scroll) {
    return (
      <View style={[styles.frame, styles.content]} testID={testID}>
        {inner}
      </View>
    );
  }

  // contentContainerStyle flexGrow fills tall containers (art takes the
  // slack, actions anchor low); short containers scroll instead of clipping.
  return (
    <ScrollView
      style={styles.frame}
      contentContainerStyle={styles.content}
      bounces={false}
      showsVerticalScrollIndicator={false}
      // Android: without this a primer nested in another vertical scroller
      // (wizard step content) can't scroll at all.
      nestedScrollEnabled
      testID={testID}
    >
      {inner}
    </ScrollView>
  );
}

const EMOJI_SIZE = typography.display.fontSize * 2;

const styles = StyleSheet.create({
  // flexGrow (not flex): fills bounded containers (camera modal, wizard
  // step), hugs content in unbounded ones (a bottom sheet).
  frame: {
    flexGrow: 1,
    flexShrink: 1,
  },
  // No screen padding of its own: every host (wizard step, camera modal,
  // bottom sheet, sandbox frame) already owns the 24px gutter — self-padding
  // here would double it (design-review finding).
  content: {
    flexGrow: 1,
  },
  // The art gets real presence: it takes the slack space in tall containers,
  // keeping text and actions settled low; in short ones the whole primer
  // scrolls (see the ScrollView) — the actions never clip. minHeight reuses
  // avatarLg purely as "smallest sensible art tile" (72pt).
  illustrationArea: {
    flexGrow: 1,
    minHeight: sizes.avatarLg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  // Same art language as OnboardingSlide's illustrationCircle (60% width,
  // full-round, surfaceSubtle) — no width cap there, none here.
  illustrationCircle: {
    width: '60%',
    aspectRatio: 1,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: EMOJI_SIZE,
    lineHeight: EMOJI_SIZE + spacing.md,
    textAlign: 'center',
  },
  textBlock: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  headline: {
    ...typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
});
