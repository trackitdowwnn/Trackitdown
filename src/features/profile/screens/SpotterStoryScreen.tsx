/**
 * WHAT:  SpotterStoryScreen — the pushed "Your spotter story" page: the
 *        nonzero counters as a horizontal stat strip (the record), then the
 *        full narrative ReputationCard (highlight lines, earned badge
 *        emblems, the one next-goal progress bar) on its own calm screen,
 *        with an on-screen back affordance (headers are hidden app-wide) and
 *        a skeleton while the profile loads.
 * WHY:   The root's hero card is identity ONLY — everything reputational
 *        (counters AND narrative) lives together one push away, so the root
 *        stays shallow and the hero uncrowded. The goal/progress UI lives
 *        HERE (your own motivation), never on the public sheet owners see.
 * LINKS: src/app/spotter-story.tsx (route);
 *        components/ReputationCard.tsx; components/StatColumn.tsx;
 *        screens/ProfileScreen.tsx (the push);
 *        src/shared/ui/Screen.tsx (page wrapper).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRequireAuth } from '@/features/auth';
import {
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

import { ReputationCard } from '../components/ReputationCard';
import { StatColumn } from '../components/StatColumn';
import { useMyProfile } from '../hooks/useMyProfile';
import { passportStats, spotterPoints } from '../lib/reputation';
import type { MyProfile } from '../types';

export function SpotterStoryScreen() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const state = useMyProfile();
  const requireAuth = useRequireAuth();

  return (
    <Screen
      scroll
      // The pushed-screen bottom inset, as on Settings, Legal and Payouts —
      // Screen pads only the top, so the last rung of the ladder sat under the
      // Android navigation buttons.
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
    >
      {/* Pushed page, headers hidden app-wide → an on-screen back control
          (system back/swipe still work; this one is for eyes and rotors). */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          Your spotter story
        </Text>
      </View>

      {state.status === 'loading' ? <StorySkeleton /> : null}

      {state.status === 'error' ? (
        <EmptyState
          title="Couldn't load your story"
          body="Check your connection and try again."
          actionLabel="Try again"
          onAction={state.refresh}
        />
      ) : null}

      {state.status === 'signedOut' ? (
        // Unreachable via the tab (the root gates visually) but deep-linkable.
        <EmptyState
          title="Your spotter story lives here"
          body="Log in to see your sightings, badges, and next goal."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'tab_profile' })}
        />
      ) : null}

      {state.status === 'ready' ? <StoryContent profile={state.profile} /> : null}
    </Screen>
  );
}

/** The record then the story: the nonzero counters as a horizontal
 *  number-over-label strip (degrade by omission — an all-zero account gets
 *  no strip, the narrative card's warm invitation carries the page), then
 *  the full narrative ReputationCard. */
function StoryContent({ profile }: { profile: MyProfile }) {
  const styles = useThemedStyles(makeStyles);
  const stats = passportStats(profile.counters);
  const points = spotterPoints(profile.counters);
  return (
    <>
      {/* ⚠️ THE POINTS ARE THE HERO (2026-08-26). The page opened on a strip of
          three equal counters, so the number that the badges are actually built
          from looked like one statistic among three. `points` IS
          sightingsHelpful — a sighting an owner confirmed — and it is the only
          one that moves the ladder, so it leads and the other two stay below as
          the record.

          ⚠️ ONE accessible node, as on the payouts amount: "Points" / "4" read
          as two stops would deliver the number without the word.

          Shown at zero, unlike the stat strip, because zero points is the
          honest start of a ladder rather than a sad counter — the card below
          carries the warm invitation that goes with it. */}
      <View
        style={styles.pointsCard}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${points} ${points === 1 ? 'point' : 'points'}`}
        testID="story-points"
      >
        <Text style={styles.pointsLabel}>{points === 1 ? 'Point' : 'Points'}</Text>
        <Text style={styles.pointsValue}>{points}</Text>
        <Text style={styles.pointsBody}>
          One for every sighting an owner confirmed.
        </Text>
      </View>

      {stats.length > 0 ? (
        <View style={styles.statsCard}>
          <StatColumn stats={stats} horizontal testID="story-stats" />
        </View>
      ) : null}
      <ReputationCard counters={profile.counters} createdAt={profile.createdAt} />
    </>
  );
}

function BackButton() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="story-back"
    >
      <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
    </Pressable>
  );
}

/** Card-shaped placeholder in the house skeleton idiom (surfaceSubtle lines
 *  on a surface card) — never a spinner. */
function StorySkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.skeletonCard} testID="story-skeleton">
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={styles.skeletonLine} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Full 44pt+ target around the 24pt chevron; the negative margin keeps the
  // glyph optically on the content gutter despite the padding.
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    flexShrink: 1,
  },
  // The page's one inverted block, the same device PayoutsScreen uses for the
  // amount someone is owed: exactly one object per surface may stand out, and
  // here it is the number the ladder is built from.
  pointsCard: {
    backgroundColor: c.surfaceInverse,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  pointsLabel: {
    ...typography.caption,
    color: c.textOnPrimary,
  },
  pointsValue: {
    ...typography.display,
    color: c.textOnPrimary,
  },
  pointsBody: {
    ...typography.body,
    // On the inverse surface secondary grey would fail contrast, as the same
    // card on PayoutsScreen already records.
    color: c.textOnPrimary,
    marginTop: spacing.xs,
  },
  // The record card matches the narrative card's chrome (surface, radii.lg,
  // soft shadow) so the two read as one family.
  statsCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.soft,
  },
  skeletonCard: {
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonLineShort: {
    width: '60%',
  },
});
