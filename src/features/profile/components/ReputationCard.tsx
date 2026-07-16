/**
 * WHAT:  ReputationCard — the spotter story as Airbnb-style highlights
 *        (icon + narrative line: "Helped recover 1 car", "4 sightings
 *        helped owners"), earned badges as small emblem circles (family
 *        icon for first badges, the number for 5/25 tiers; recovery emblems
 *        in terracotta — the bounty family), and ONE next-goal line with an
 *        animated progress bar. A brand-new account gets a warm invitation
 *        and the first goal at 0 — never a row of zeros.
 * WHY:   Reputation is social proof (docs/DOMAIN.md: display-only, never
 *        payout-affecting) and story reads as trust where bare counters
 *        read as a dashboard. All copy derives from the server-maintained
 *        counters via lib/reputation's pinned maths; motion is one gentle
 *        card fade-rise + the bar fill (ease-out within the 250ms family,
 *        static under reduced motion) — calm, not gamey.
 * LINKS: src/features/profile/lib/reputation.ts (highlights/badges/goal
 *        maths); docs/DOMAIN.md (Reputation v1); docs/DESIGN_SYSTEM.md.
 */

import { Eye, KeyRound, type LucideIcon, Sparkles, ThumbsUp } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors, motion, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

import {
  type BadgeState,
  earnedBadges,
  type HighlightItem,
  highlights,
  nextBadgeGoal,
  spottingSinceLabel,
} from '../lib/reputation';
import type { ReputationCounters } from '../types';

/** Icon per counter family — shared by highlight rows and emblem circles. */
const FAMILY_ICONS: Record<keyof ReputationCounters, LucideIcon> = {
  sightingsReported: Eye,
  sightingsHelpful: ThumbsUp,
  recoveriesCredited: KeyRound,
};

const HIGHLIGHT_ICONS: Record<HighlightItem['key'], LucideIcon> = {
  recoveries: KeyRound,
  helpful: ThumbsUp,
  reported: Eye,
};

/** Emblem geometry, token-derived: a body-size glyph in a snug circle;
 *  tier stamps pair a caption-size icon with the number. */
const EMBLEM_DIAMETER = sizes.icon + spacing.sm * 2;
const EMBLEM_GLYPH = typography.body.fontSize;
const TIER_GLYPH = typography.caption.fontSize;

export function ReputationCard({
  counters,
  createdAt,
}: {
  counters: ReputationCounters;
  /** Used only for the fresh-account story line. */
  createdAt: string;
}) {
  'use no memo';
  const reduceMotion = useReducedMotion();
  const earned = earnedBadges(counters);
  const next = nextBadgeGoal(counters);
  const story = highlights(counters);
  const fresh = story.length === 0;

  // One gentle fade-rise on first appearance; the bar fills alongside.
  const appear = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    appear.value = withTiming(1, {
      duration: reduceMotion ? 0 : motion.standard,
      easing: easeOut,
    });
  }, [appear, reduceMotion]);
  const appearStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * spacing.sm }],
  }));

  return (
    <Animated.View style={[styles.card, appearStyle]} testID="reputation-card">
      {fresh ? (
        <FreshStory createdAt={createdAt} />
      ) : (
        <View style={styles.storyBlock}>
          {story.map((item) => {
            const Icon = HIGHLIGHT_ICONS[item.key];
            return (
              <View
                key={item.key}
                style={styles.highlightRow}
                accessible
                accessibilityLabel={item.label}
              >
                <View style={styles.highlightIcon}>
                  <Icon size={EMBLEM_GLYPH} color={colors.primary} />
                </View>
                <Text style={styles.highlightText}>{item.label}</Text>
              </View>
            );
          })}
        </View>
      )}

      {earned.length > 0 ? (
        <>
          <View style={styles.rule} />
          <EmblemRail badges={earned} />
        </>
      ) : null}

      {next ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: next.threshold, now: next.achieved }}
          accessibilityLabel={`Next badge: ${next.label}, ${next.achieved} of ${next.threshold}`}
        >
          <Text style={styles.quiet} testID="next-badge">
            Next badge: {next.label}
          </Text>
          <ProgressBar
            achieved={next.achieved}
            threshold={next.threshold}
            reduceMotion={reduceMotion}
          />
        </View>
      ) : null}
    </Animated.View>
  );
}

/** The empty state IS most users' card: a warm start, never sad zeros. */
function FreshStory({ createdAt }: { createdAt: string }) {
  const since = spottingSinceLabel(createdAt);
  return (
    <View style={styles.storyBlock}>
      <Text style={styles.invitation}>Your first sighting starts your spotter story.</Text>
      <View style={styles.highlightRow} accessible accessibilityLabel={since}>
        <View style={styles.highlightIcon}>
          <Sparkles size={EMBLEM_GLYPH} color={colors.primary} />
        </View>
        <Text style={styles.highlightText}>{since}</Text>
      </View>
    </View>
  );
}

/** The earned-badge stamps as a wrapping rail — exported so the public
 *  passport sheet can show earned trust without this card's chrome. */
export function EmblemRail({ badges, testID }: { badges: BadgeState[]; testID?: string }) {
  return (
    <View style={styles.emblemRail} testID={testID}>
      {badges.map((badge) => (
        <Emblem key={badge.key} badge={badge} />
      ))}
    </View>
  );
}

/** First badges: a family-icon circle. 5/25 tiers: a small stamp pairing
 *  the family icon with the number, so families stay tellable apart by
 *  sight, not just by spoken label. Recovery emblems carry terracotta —
 *  the one true bounty family. */
function Emblem({ badge }: { badge: BadgeState }) {
  const tint = badge.counter === 'recoveriesCredited' ? colors.accentText : colors.primary;
  const Icon = FAMILY_ICONS[badge.counter];
  return (
    <View
      style={styles.emblem}
      accessible
      accessibilityLabel={`Badge earned: ${badge.label}`}
      testID={`badge-earned-${badge.key}`}
    >
      {badge.threshold === 1 ? (
        <Icon size={EMBLEM_GLYPH} color={tint} />
      ) : (
        <>
          <Icon size={TIER_GLYPH} color={tint} />
          <Text style={[styles.emblemNumber, { color: tint }]} maxFontSizeMultiplier={1}>
            {badge.threshold}
          </Text>
        </>
      )}
    </View>
  );
}

function ProgressBar({
  achieved,
  threshold,
  reduceMotion,
}: {
  achieved: number;
  threshold: number;
  reduceMotion: boolean;
}) {
  'use no memo';
  const fraction = threshold > 0 ? achieved / threshold : 0;
  const fill = useSharedValue(reduceMotion ? fraction : 0);
  useEffect(() => {
    fill.value = withTiming(fraction, {
      duration: reduceMotion ? 0 : motion.standard,
      easing: easeOut,
    });
  }, [fill, fraction, reduceMotion]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={styles.progressRow}>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, fillStyle]} />
      </View>
      <Text style={styles.quiet}>
        {achieved} of {threshold}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.soft,
  },
  invitation: {
    ...typography.body,
    color: colors.textPrimary,
  },
  storyBlock: {
    gap: spacing.md,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  highlightIcon: {
    width: sizes.icon,
    alignItems: 'center',
  },
  highlightText: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  emblemRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // surface + hairline, not surfaceSubtle: primary/accentText glyphs need
  // the lighter fill to clear AA contrast; the border keeps the stamp shape
  // visible on the white card. Tier stamps widen into pills naturally via
  // minWidth + padding.
  emblem: {
    minWidth: EMBLEM_DIAMETER,
    height: EMBLEM_DIAMETER,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emblemNumber: {
    ...typography.label,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  progressTrack: {
    flex: 1,
    height: sizes.sliderTrack,
    borderRadius: radii.full,
    backgroundColor: colors.borderStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  quiet: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
