/**
 * WHAT:  BrandLoader — THE app's one loading visual: the Trackitdown
 *        wordmark with a calm rotating phrase beneath it. Every blocking
 *        wait shows this same face — the cold-start splash (BrandSplash)
 *        and the in-app FullscreenLoader both render it — so loading always
 *        looks like the app opening, never like a component buffering.
 * WHY:   Spinners and dot-waves say "machine busy"; the rotating line says
 *        the same thing in the product's own voice, and the periodic swap
 *        IS the liveness signal (a frozen app stops rotating). An explicit
 *        `message` (an honest operational status like "Uploading photos…")
 *        always beats flavour — phrases only fill silence. The phrase pool
 *        is deliberately small, calm, and on-register: watchful and
 *        hopeful, never jokey (this app exists because something bad
 *        happened to the user).
 * LINKS: src/features/auth/components/BrandSplash.tsx and
 *        src/shared/ui/FullscreenLoader.tsx (the two consumers);
 *        docs/DESIGN_SYSTEM.md (Loading, Motion, Tone).
 *        TODO(art): swap the wordmark Text for the final logo asset.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { colors, motion, spacing, typography } from '../theme';

/** One gentle curve both ways — ambient text, not UI snap. Resolved lazily
 *  (render time, not import time): suites that import the ui barrel with a
 *  slim reanimated mock must not crash on a module-scope Easing call. */
const phraseEasing = () => Easing.inOut(Easing.quad);

/** The waiting voice: watchful, communal, hopeful. Keep entries SHORT (one
 *  breath), sentence-cased, ellipsis-terminated; add sparingly. */
export const LOADER_PHRASES = [
  'Keeping watch…',
  'Eyes on the streets…',
  'Checking the latest sightings…',
  'On the lookout…',
  'Every pair of eyes helps…',
  'Rounding up what’s new…',
  'Watching the map…',
  'Bringing cars home…',
] as const;

export interface BrandLoaderProps {
  /** Honest operational status ("Uploading photos…"). Overrides the phrase
   *  rotation while set — real information always beats flavour. */
  message?: string;
  testID?: string;
}

export function BrandLoader({ message, testID }: BrandLoaderProps) {
  // Random starting phrase per mount keeps repeat waits feeling fresh.
  const [index, setIndex] = useState(() => Math.floor(Math.random() * LOADER_PHRASES.length));

  useEffect(() => {
    if (message) return; // the status line owns the slot — no rotation under it
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % LOADER_PHRASES.length),
      motion.loaderPhraseRotate,
    );
    return () => clearInterval(timer);
  }, [message]);

  const line = message ?? LOADER_PHRASES[index];

  return (
    <View
      style={styles.root}
      testID={testID}
      // One announcement for the whole block: a screen reader should hear
      // "loading", not a wordmark followed by decorative copy.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={message ? `Trackitdown, ${message}` : 'Trackitdown, loading'}
    >
      {/* TODO(art): logo asset slot. */}
      <Text style={styles.wordmark}>Trackitdown</Text>
      {/* Fixed slot; each phrase is ABSOLUTE within it so the outgoing and
          incoming lines overlap in place — a pure opacity cross-fade with
          zero layout movement (in-flow siblings would stack and snap). */}
      <View style={styles.messageSlot}>
        <Animated.Text
          key={line}
          entering={FadeIn.duration(motion.loaderPhraseFade)
            .easing(phraseEasing())
            .reduceMotion(ReduceMotion.System)}
          exiting={FadeOut.duration(motion.loaderPhraseFade)
            .easing(phraseEasing())
            .reduceMotion(ReduceMotion.System)}
          style={styles.message}
        >
          {line}
        </Animated.Text>
      </View>
      {/* The constant: a small spinner in its own FIXED slot — deliberately
          not inline with the text (phrase widths differ, a trailing spinner
          would wander). It never fades or moves while the phrases breathe. */}
      <ActivityIndicator
        size="small"
        color={colors.textSecondary}
        style={styles.spinner}
        // Decorative: the block's single progressbar label covers it.
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Span the parent: the absolute phrases centre on the full line width,
    // not inside the wordmark's shrink-wrapped box.
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  wordmark: {
    ...typography.display,
    color: colors.primary,
  },
  messageSlot: {
    // Two body lines of room so a long status never reflows the wordmark;
    // stretched wide so the absolute phrases have a full line to centre in.
    height: typography.body.lineHeight * 2,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  message: {
    // Absolute: cross-fading phrases overlap instead of stacking (the
    // layout snap that read as jank).
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  spinner: {
    marginTop: spacing.lg,
  },
});
