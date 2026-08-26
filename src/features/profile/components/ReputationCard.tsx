/**
 * WHAT:  ReputationCard — the spotter story as Airbnb-style highlights
 *        (icon + narrative line: "Helped recover 1 car", "4 sightings
 *        helped owners"), earned badges as small emblem circles (family
 *        icon for first badges, the number for 5/25 tiers; recovery emblems
 *        in the accent (near-black) — the bounty family), and ONE next-goal line with an
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

import { Check, Eye, KeyRound, type LucideIcon, Sparkles, ThumbsUp } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

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
} from '@/shared/theme';
import { easeOut } from '@/shared/theme/motionEasing';

import {
  type BadgeState,
  badgeLadder,
  earnedBadges,
  type HighlightItem,
  highlights,
  type LadderRung,
  type NextBadgeGoal,
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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const reduceMotion = useReducedMotion();
  const earned = earnedBadges(counters);
  const next = nextBadgeGoal(counters);
  const ladder = badgeLadder(counters);
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
                  <Icon size={EMBLEM_GLYPH} color={palette.primary} />
                </View>
                <Text style={styles.highlightText}>{item.label}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* ⚠️ THE WHOLE LADDER, NOT ONE GOAL (2026-08-26). This was an emblem
          rail of what had been earned plus a single "Next badge" line, so a
          spotter could see behind them and one step ahead and nothing else —
          they could not tell whether 3 was the end. The reference's lesson
          (Airbnb's Superhost) is PUBLISHED CRITERIA plus progress: the whole
          requirement is visible, and your position in it is marked.

          EmblemRail survives untouched because PublicProfileSheet renders it —
          an owner reading a stranger's passport wants earned trust, not that
          person's private goals. The ladder is own-view only, which is the same
          rule that has always kept the progress bar off the public sheet. */}
      <View style={styles.rule} />
      <BadgeLadder ladder={ladder} next={next} reduceMotion={reduceMotion} />
    </Animated.View>
  );
}

/**
 * The four rungs, earned and not.
 *
 * ⚠️ CALM, NOT GAMEY. DOMAIN.md makes reputation social proof that never
 * touches payouts, and this card's own note asks for one gentle motion rather
 * than celebration. So: no confetti, no tiers-to-unlock language, no trophy
 * iconography — a filled marker for what is done, a hollow one for what is
 * not, and a single progress bar on the rung actually in play.
 */
function BadgeLadder({
  ladder,
  next,
  reduceMotion,
}: {
  ladder: LadderRung[];
  next: NextBadgeGoal | null;
  reduceMotion: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <View style={styles.ladder} testID="badge-ladder">
      {ladder.map((rung) => (
        <View
          key={rung.threshold}
          style={styles.rungRow}
          accessible
          // ⚠️ THE STATE IS IN THE LABEL, because nothing else carries it: the
          // filled/hollow marker is colour and shape only, and "3 confirmed
          // sightings" alone tells a screen-reader user nothing about whether
          // they have it.
          accessibilityLabel={
            rung.earned
              ? `${rung.label}: earned`
              : rung.next && next
                ? `${rung.label}: ${next.achieved} of ${next.threshold}`
                : `${rung.label}: not yet earned`
          }
          testID={`ladder-rung-${rung.threshold}`}
        >
          <View style={[styles.rungMark, rung.earned && styles.rungMarkEarned]}>
            {rung.earned ? <Check size={EMBLEM_GLYPH} color={palette.textOnPrimary} /> : null}
          </View>
          <View style={styles.rungBody}>
            <Text style={rung.earned ? styles.rungLabel : styles.rungLabelQuiet}>
              {rung.label}
            </Text>
            {/* The bar rides ONLY the rung in play. On every other row it would
                be either full or empty, which is what the marker already
                says. */}
            {rung.next && next ? (
              <>
                <ProgressBar
                  achieved={next.achieved}
                  threshold={next.threshold}
                  reduceMotion={reduceMotion}
                />
                <Text style={styles.quiet} testID="next-badge">
                  {next.achieved} of {next.threshold}
                </Text>
              </>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** The empty state IS most users' card: a warm start, never sad zeros. */
function FreshStory({ createdAt }: { createdAt: string }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const since = spottingSinceLabel(createdAt);
  return (
    <View style={styles.storyBlock}>
      <Text style={styles.invitation}>Your first sighting starts your spotter story.</Text>
      <View style={styles.highlightRow} accessible accessibilityLabel={since}>
        <View style={styles.highlightIcon}>
          <Sparkles size={EMBLEM_GLYPH} color={palette.primary} />
        </View>
        <Text style={styles.highlightText}>{since}</Text>
      </View>
    </View>
  );
}

/** The earned-badge stamps as a wrapping rail — exported so the public
 *  passport sheet can show earned trust without this card's chrome. */
export function EmblemRail({ badges, testID }: { badges: BadgeState[]; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
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
 *  sight, not just by spoken label. Recovery emblems carry the accent
 *  (near-black) — the one true bounty family. */
function Emblem({ badge }: { badge: BadgeState }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const tint = badge.counter === 'recoveriesCredited' ? palette.accentText : palette.primary;
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
  const styles = useThemedStyles(makeStyles);
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

const makeStyles = (c: Palette) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.soft,
  },
  invitation: {
    ...typography.body,
    color: c.textPrimary,
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
    color: c.textPrimary,
    flexShrink: 1,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
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
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
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
    backgroundColor: c.borderStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: c.primary,
  },
  quiet: {
    ...typography.caption,
    color: c.textSecondary,
  },
  ladder: {
    gap: spacing.md,
  },
  rungRow: {
    flexDirection: 'row',
    // `flex-start`, not `center`: the rung in play is two lines taller than the
    // others, and centring would float its marker halfway down the row while
    // every other marker sits beside its first line.
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  // A hollow ring for a rung not yet reached. `borderStrong`, not `border` —
  // this is a small graphic carrying meaning, and DESIGN_SYSTEM reserves
  // borderStrong for exactly that (it must clear 3:1, which `border` does not).
  rungMark: {
    width: EMBLEM_DIAMETER,
    height: EMBLEM_DIAMETER,
    borderRadius: EMBLEM_DIAMETER / 2,
    // 2, a literal: the theme has no shared border-WIDTH token (only radii and
    // colours), and inventing one for a single ring would be a token nothing
    // else could honestly reuse. A hairline would vanish here — this ring is
    // the only thing distinguishing an unearned rung from an earned one.
    borderWidth: 2,
    borderColor: c.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rungMarkEarned: {
    backgroundColor: c.primary,
    borderColor: c.primary,
  },
  rungBody: {
    flex: 1,
    gap: spacing.xs,
  },
  rungLabel: {
    ...typography.body,
    color: c.textPrimary,
  },
  // Not-yet-earned rungs recede rather than disappear: they are the published
  // criteria, so they must stay readable — `textSecondary` clears AA at 5.1,
  // where dimming with opacity would not.
  rungLabelQuiet: {
    ...typography.body,
    color: c.textSecondary,
  },
});
