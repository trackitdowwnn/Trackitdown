/**
 * WHAT:  BrandLoader — THE app's one loading visual: the Trackitdown
 *        wordmark with a calm rotating phrase beneath it, lit by a highlight
 *        that sweeps left to right through the letters. Every blocking wait
 *        shows this same face — the cold-start splash (BrandSplash) and the
 *        in-app FullscreenLoader both render it — so loading always looks
 *        like the app opening, never like a component buffering.
 * WHY:   Spinners and dot-waves say "machine busy"; the line says the same
 *        thing in the product's own voice. The shimmer is what carries the
 *        liveness signal BETWEEN phrase swaps (2026-08-06, at the owner's
 *        request, modelled on eBay's upload screen). The spinner underneath
 *        stays: it was briefly removed the same day and the absence was the
 *        first thing noticed, because this loader is usually on screen for
 *        under half a second and a spinner is the fastest-reading "busy" a
 *        glimpse that short can carry. The two do different jobs — the
 *        spinner says SOMETHING IS HAPPENING, the shimmer says what kind of
 *        app it is happening in.
 *
 *        An explicit `message` (an honest operational status like "Uploading
 *        photos…") always beats flavour — phrases only fill silence, and the
 *        message shimmers just the same. The phrase pool is deliberately
 *        small, calm, and on-register: watchful and hopeful, never jokey
 *        (this app exists because something bad happened to the user).
 * LINKS: src/features/auth/components/BrandSplash.tsx and
 *        src/shared/ui/FullscreenLoader.tsx (the two consumers);
 *        docs/DESIGN_SYSTEM.md (Loading, Motion, Tone);
 *        scripts/brand/markSpec.mjs (the mark's geometry, should it land here).
 *
 * DEFERRED (2026-08-20, ADR-0015): the brand mark now EXISTS — the alert rings
 * that ship as the app icon — but it is deliberately not in this component yet,
 * because putting it here is a design decision rather than an asset swap:
 *   * above the wordmark, or replacing it?
 *   * does the shimmer cross the mark, or stop at the type?
 *   * how does it read in the reduced-motion branch, which has no shimmer?
 * When it lands it should be a `<BrandMark/>` built on react-native-svg (already
 * a dependency) driven by the SAME numbers as markSpec.mjs, so it is
 * resolution-independent and takes its colour from `palette.primary` — an
 * expo-image PNG would need a tintColor hack and would be soft at display size.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  ReduceMotion,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  motion,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { easeOut, linear } from '../theme/motionEasing';


/** How much of the line the highlight covers at once, as a fraction of its
 *  length. Narrow enough to have a discernible leading and trailing edge —
 *  a WIDE band lights most of the line at once, which reads as the whole
 *  phrase pulsing rather than as something travelling through it, and that
 *  was half of why the first attempt at this was invisible. */
const SHIMMER_BAND = 0.22;

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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
      // "loading", not a wordmark followed by decorative copy — and certainly
      // not the line spelled out one letter at a time, which is what the
      // shimmer's per-character views would otherwise produce.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={message ? `Trackitdown, ${message}` : 'Trackitdown, loading'}
    >
      {/* The wordmark is literal Text, not a rendered asset, because the
          shimmer animates ONE VIEW PER CHARACTER — see the header. A mark slot
          would sit here; see the DEFERRED note for why it does not yet. */}
      <Text style={styles.wordmark}>Trackitdown</Text>
      {/* Fixed slot; each line is ABSOLUTE within it so the outgoing and
          incoming phrases overlap in place (in-flow siblings would stack and
          snap). The slot CLIPS: phrases rise into it from below and leave
          through the top, so the movement reads as one line replacing another
          on a board rather than as text drifting over the wordmark. */}
      <View style={styles.messageSlot}>
        <Animated.View
          key={line}
          // Up from underneath, out through the top — the two halves of one
          // continuous upward movement. (FadeInDown starts BELOW and rises;
          // FadeOutUp leaves upward. The names describe where the motion comes
          // from, not where it goes.) easeOut because a phrase arriving is a
          // thing settling, which is the design system's one enter curve.
          entering={FadeInDown.duration(motion.loaderPhraseFade)
            .easing(easeOut)
            .reduceMotion(ReduceMotion.System)}
          exiting={FadeOutUp.duration(motion.loaderPhraseFade)
            .easing(easeOut)
            .reduceMotion(ReduceMotion.System)}
          style={styles.line}
        >
          <ShimmerLine text={line} />
        </Animated.View>
      </View>
      {/* The constant, restored at the owner's request 2026-08-06 after a
          build without it. The shimmer is the character of the wait; this is
          the guarantee. The splash frequently lifts inside 500ms, and in a
          glimpse that short a spinner is simply the fastest-reading "busy" a
          screen has — it needs no cycle to complete to be understood. It sits
          in its own FIXED slot, deliberately not inline with the text (phrase
          widths differ, and a trailing spinner would wander). */}
      <ActivityIndicator
        size="small"
        color={palette.textSecondary}
        style={styles.spinner}
        // Decorative: the block's single progressbar label covers it.
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </View>
  );
}

/**
 * The line, lit by a travelling highlight.
 *
 * Every character is its OWN view rather than a nested <Text> span, because
 * animating a nested span's colour re-measures the whole paragraph on the
 * shadow tree each frame; separate views take a plain colour prop update and
 * never re-lay-out (a character's box does not change when its ink does).
 * The cost is that the line is no longer a single queryable text node — hence
 * the block's accessibilityLabel above, which is what both screen readers and
 * the tests read.
 */
function ShimmerLine({ text }: { text: string }) {
  const styles = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  // Words, each carrying its own trailing space, so wrapping can only ever
  // break BETWEEN words — a per-character row would happily split "sightings"
  // across two lines.
  const words = useMemo(() => splitIntoWords(text), [text]);
  const total = useMemo(() => Array.from(text).length, [text]);

  useEffect(() => {
    if (reduceMotion) return;
    progress.set(0);
    progress.set(
      withRepeat(withTiming(1, { duration: motion.loaderShimmer, easing: linear }), -1, false),
    );
    return () => cancelAnimation(progress);
    // `text` restarts the sweep at the left edge on every phrase swap, so a
    // new line is never caught mid-pass.
  }, [progress, reduceMotion, text]);

  if (reduceMotion) {
    // WCAG 2.3.3: no sweep, no per-character views — just the line, still.
    // The phrase rotation stays (it is content, not motion) and remains the
    // liveness signal, as it was before the shimmer existed.
    return <Text style={styles.message}>{text}</Text>;
  }

  let cursor = 0;
  return (
    <View style={styles.wordRow} importantForAccessibility="no-hide-descendants">
      {words.map((word, wordIndex) => (
        <View key={`${wordIndex}-${word}`} style={styles.word}>
          {Array.from(word).map((character, characterIndex) => (
            <ShimmerCharacter
              key={characterIndex}
              character={character}
              // Where this character sits along the line, 0 → 1. Computed once
              // during render from a running count; the worklet only compares
              // it against the sweep head.
              position={total > 1 ? cursor++ / (total - 1) : 0}
              progress={progress}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function ShimmerCharacter({
  character,
  position,
  progress,
}: {
  character: string;
  position: number;
  progress: SharedValue<number>;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const style = useAnimatedStyle(() => {
    // The head travels from one band-width BEFORE the line to one band-width
    // AFTER it, so the first and last characters get a full pass rather than
    // being lit at half strength on a clipped edge.
    const head = -SHIMMER_BAND + progress.get() * (1 + 2 * SHIMMER_BAND);
    const distance = Math.abs(position - head);
    const intensity = Math.max(0, 1 - distance / SHIMMER_BAND);
    return {
      // The sweep's two ends, read from the palette INSIDE the worklet — hoist
      // either to a module const or a shared value and the hex freezes on the
      // UI thread, which is the whole bug this migration exists to fix.
      //
      // The resting end is `textSecondary` and CANNOT go lighter (on the light
      // palette): it is the lightest text colour still clearing WCAG AA on the
      // page background (~4.9:1); the next step down, `borderStrong`, is ~2.9:1
      // and fails outright. The waiting phrase is real content — someone reads
      // it — so the shimmer never trades legibility for drama. The "bold" comes
      // from SPEED (motion.loaderShimmer) and a tight band instead.
      //
      // Direction of travel is palette-relative, not absolute: on the light
      // palette grey darkens toward near-black; on dark it brightens toward
      // near-white. Either way the sheen moves AWAY from the page background,
      // which is what stops the letters dissolving into it.
      color: interpolateColor(intensity, [0, 1], [palette.textSecondary, palette.primary]),
    };
  });

  return <Animated.Text style={[styles.message, style]}>{character}</Animated.Text>;
}

/** "Eyes on the streets…" → ["Eyes ", "on ", "the ", "streets…"]. Each space
 *  stays attached to the word it follows so it renders (and shimmers) as part
 *  of that group rather than becoming a stray box at a wrap point.
 *
 *  Exported for its test: this is the ONLY thing standing between the
 *  per-character shimmer and a line that wraps mid-word, and that failure
 *  mode is invisible until a phrase happens to be long enough on a narrow
 *  screen. Concatenating the result must always reproduce the input exactly. */
export function splitIntoWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  for (const character of Array.from(text)) {
    current += character;
    if (character === ' ') {
      words.push(current);
      current = '';
    }
  }
  if (current) words.push(current);
  return words;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      // Span the parent: the absolute lines centre on the full line width,
      // not inside the wordmark's shrink-wrapped box.
      alignSelf: 'stretch',
      alignItems: 'center',
    },
    wordmark: {
      ...typography.display,
      color: c.primary,
    },
    messageSlot: {
      // Two body lines of room so a long status never reflows the wordmark;
      // stretched wide so the absolute lines have a full line to centre in.
      height: typography.body.lineHeight * 2,
      marginTop: spacing.xl,
      alignSelf: 'stretch',
      // The window the phrases travel through. Without this the outgoing line
      // would fade out ON TOP of the wordmark 24pt above it, since the exit
      // translates further than the gap.
      overflow: 'hidden',
    },
    line: {
      // Absolute: cross-fading lines overlap instead of stacking (the layout
      // snap that read as jank).
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.xl,
    },
    wordRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
    },
    word: {
      flexDirection: 'row',
    },
    message: {
      ...typography.body,
      // Bold, not regular (2026-08-06, at the owner's request). Weight is set
      // by FAMILY here as everywhere else in the app — with statically loaded
      // faces, `fontWeight` makes Android synthesize a fake bold on top of a
      // real face (see theme/typography.ts). Heavier type also gives the
      // shimmer more ink to travel through, so the sweep reads harder.
      fontFamily: typography.cardTitle.fontFamily,
      color: c.textSecondary,
      textAlign: 'center',
    },
    spinner: {
      marginTop: spacing.lg,
    },
  });
