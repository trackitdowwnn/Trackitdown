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

import { useRequireAuth } from '@/features/auth';
import { colors, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

import { ReputationCard } from '../components/ReputationCard';
import { StatColumn } from '../components/StatColumn';
import { useMyProfile } from '../hooks/useMyProfile';
import { passportStats } from '../lib/reputation';
import type { MyProfile } from '../types';

export function SpotterStoryScreen() {
  const state = useMyProfile();
  const requireAuth = useRequireAuth();

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
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
  const stats = passportStats(profile.counters);
  return (
    <>
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
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="story-back"
    >
      <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
    </Pressable>
  );
}

/** Card-shaped placeholder in the house skeleton idiom (surfaceSubtle lines
 *  on a surface card) — never a spinner. */
function StorySkeleton() {
  return (
    <View style={styles.skeletonCard} testID="story-skeleton">
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={styles.skeletonLine} />
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textPrimary,
    flexShrink: 1,
  },
  // The record card matches the narrative card's chrome (surface, radii.lg,
  // soft shadow) so the two read as one family.
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.soft,
  },
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLineShort: {
    width: '60%',
  },
});
