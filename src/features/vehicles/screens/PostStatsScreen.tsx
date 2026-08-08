/**
 * WHAT:  PostStatsScreen — what has actually happened to ONE of the owner's
 *        listings: how many spotters the alert reached, how long it has been
 *        live and how long is left, the sightings split by status, the per-day
 *        trend, and whether anyone has been in touch.
 * WHY:   The owner can see their post and their sightings, but nothing told
 *        them whether the thing is WORKING. All of this already existed across
 *        four tables and had never been assembled.
 *
 *        REACH LEADS WHEN THERE IS REACH TO REPORT. Most listings show zero
 *        sightings for most of their life, and that is the emotionally worst
 *        number on a screen belonging to someone whose car was stolen this
 *        week. Opening with "128 spotters alerted" states what the app DID,
 *        which is true whatever the outcome. The count is FLOORED to 0 below 5
 *        though, so a zero means "nobody, or too few to say" — leading with
 *        that would be bleak AND imprecise, so the cell is dropped and the
 *        clock leads instead. Every block degrades to a sentence rather than
 *        showing a zero.
 *
 *        NO WATCHER COUNT: DOMAIN.md forbids exposing watcher counts to an
 *        owner, and a first draft of this screen had one. See the migration.
 *
 *        THE LAYOUT IS THE REFERENCE'S, NOT A DASHBOARD'S (2026-08-07). Flat
 *        sections separated by full-width-inset hairlines at the measured
 *        rhythm — divider → 32 → title → 16 → content → 32 — with a stat band
 *        of cells split by vertical hairlines. It was bordered cards; the
 *        reference takes depth from WHITESPACE and sanctions at most one
 *        elevated card per surface (profile/REFERENCE_SPEC §4), so a stack of
 *        boxes read as a performance dashboard. Which is exactly what the true
 *        analogue — Airbnb's Host Insights — is, and precisely the register
 *        this page must NOT borrow: there is no conversion rate to optimise on
 *        a stolen car and no competitor to beat.
 *
 *        Every number arrives pre-aggregated from get_post_stats — nothing is
 *        counted on this thread, and no list of people is ever fetched in order
 *        to be counted client-side.
 * LINKS: src/app/post-stats.tsx (route);
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md (section rhythm; the
 *          stat module, listed there as a missing pattern);
 *        docs/design-refs/profile/REFERENCE_SPEC.md (depth from whitespace;
 *          degrade by omission);
 *        src/features/vehicles/hooks/usePostStats.ts;
 *        src/features/vehicles/lib/postStatsModel.ts (the arithmetic).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { timeAgo } from '@/shared/lib';
import { colors, displayFontScaleCap, radii, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, ErrorState, Screen } from '@/shared/ui';

import { StatBand, type StatBandCell } from '../components/StatBand';
import { StatsSparkline } from '../components/StatsSparkline';
import { usePostStats } from '../hooks/usePostStats';
import { daysRemaining, toSparkline, wholeDaysBetween } from '../lib/postStatsModel';

export interface PostStatsScreenProps {
  postId: string;
}

/**
 * One titled block. The hairline is a TOP border rather than a separate
 * element so sections compose without the caller tracking which is first —
 * `first` drops it, and nothing else has to know the order.
 */
function Section({
  title,
  first = false,
  children,
}: {
  title?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.section, first && styles.sectionFirst]}>
      {title ? (
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/**
 * Pushed page, headers hidden app-wide (_layout.tsx `headerShown: false`), so
 * the way back has to be drawn. Android's hardware back and iOS's edge swipe
 * both work, but neither is visible, and this screen is reachable from a sheet
 * two levels deep. Same control, same testID convention, as PostAboutScreen.
 */
function StatsHeader() {
  const router = useRouter();
  return (
    <View style={styles.headerRow}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.back}
        testID="stats-back"
      >
        <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
      </Pressable>
      <Text accessibilityRole="header" style={styles.title}>
        Activity
      </Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function PostStatsScreen({ postId }: PostStatsScreenProps) {
  const { status, stats, retry } = usePostStats(postId);
  const router = useRouter();
  // Captured ONCE, lazily. Date.now() in render is impure (the lint rule says
  // so and it is right): every re-render would re-derive the day buckets, so a
  // focus refresh could silently slide the whole chart by a day. A screen left
  // open across midnight keeps yesterday's anchor until it remounts, which is
  // the correct trade for a secondary read-only page.
  const [now] = useState(() => Date.now());

  if (status === 'loading') {
    // Blocks in the shape of the real content, not a spinner — the numbers
    // land in place rather than shifting the page under a reader.
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <StatsHeader />
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Loading activity"
          testID="stats-skeleton"
          style={styles.stack}
        >
          <View style={styles.skeletonHeadlines} />
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonBlock} />
        </View>
      </Screen>
    );
  }

  if (status === 'error' || status === 'notFound' || !stats) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <StatsHeader />
        {status === 'notFound' ? (
          // Not a retry: nothing about waiting changes the answer. The action
          // is the way out, which on this branch is the only affordance the
          // screen has besides the back chevron.
          <EmptyState
            title="Listing not found"
            body="This listing may have been removed."
            // "Go back", not "Done": everywhere else in the app Done means
            // commit-and-finish, and this is a dead end, not a completion.
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        ) : (
          <ErrorState body="We couldn’t load this listing’s activity." onRetry={retry} />
        )}
      </Screen>
    );
  }

  const daysLive = wholeDaysBetween(stats.createdAt, now);
  const left = daysRemaining(stats.expiresAt, now);
  const bars = toSparkline(stats.sightingsByDay, now);

  // Degrade by omission: only the cells that have something to say. The alert
  // count is dropped at 0 rather than shown — see the header.
  const cells: StatBandCell[] = [
    ...(stats.spottersAlerted > 0
      ? [
          {
            key: 'alerted',
            value: stats.spottersAlerted.toLocaleString('en-GB'),
            label: 'spotters alerted',
            spoken: `${stats.spottersAlerted} spotters alerted`,
          },
        ]
      : []),
    {
      key: 'live',
      value: String(daysLive),
      label: daysLive === 1 ? 'day live' : 'days live',
      spoken:
        daysLive === 0
          ? 'Live since today'
          : `Live for ${daysLive} ${daysLive === 1 ? 'day' : 'days'}`,
    },
  ];

  const split = [
    stats.sightingsCredited > 0 ? `${stats.sightingsCredited} credited` : null,
    stats.sightingsHelpful > 0 ? `${stats.sightingsHelpful} helpful` : null,
    stats.sightingsUnverified > 0 ? `${stats.sightingsUnverified} unverified` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <StatsHeader />

      <Section first>
        <StatBand cells={cells} />
        {/* The deadline nobody is otherwise shown. Omitted entirely when there
            is no clock (a draft never went live) — "0 days left" would read as
            "about to be deleted" to someone whose car is still missing. */}
        {left === null ? null : (
          <Text style={styles.quiet}>
            {left === 1 ? '1 day left on this listing' : `${left} days left on this listing`}
          </Text>
        )}
      </Section>

      <Section title="Sightings">
        {stats.sightingsTotal === 0 ? (
          // NOT a wall of zeros. One sentence that says what is true and what
          // happens next.
          <Text style={styles.absence}>
            {stats.spottersAlerted > 0
              ? 'No sightings reported yet. Spotters in the area have been alerted — if anyone sees your car, their report will appear here.'
              : 'No sightings reported yet. If anyone sees your car, their report will appear here.'}
          </Text>
        ) : (
          <>
            <Text
              style={styles.bigNumber}
              maxFontSizeMultiplier={displayFontScaleCap}
              testID="stats-sightings-total"
            >
              {stats.sightingsTotal}
            </Text>
            {split ? <Text style={styles.quiet}>{split}</Text> : null}
            {stats.firstSightingAt && stats.lastSightingAt ? (
              <Text style={styles.quiet}>
                {stats.sightingsTotal === 1
                  ? `Reported ${timeAgo(stats.firstSightingAt)}`
                  : `First ${timeAgo(stats.firstSightingAt)} · latest ${timeAgo(stats.lastSightingAt)}`}
              </Text>
            ) : null}
            {/* Dropped entirely when every sighting predates the window —
                a flat row of empty bars would claim there was never any. */}
            {bars.length > 0 ? (
              <View style={styles.chart}>
                <StatsSparkline bars={bars} />
                <Text style={styles.quiet}>Last {bars.length} days</Text>
              </View>
            ) : null}
          </>
        )}
      </Section>

      <Section title="Contact">
        {/* Same rule as the sightings block: two rows reading "0" is the wall
            of zeros this screen exists to avoid. Nobody has been in touch is
            one fact, so it gets one sentence. */}
        {stats.conversations === 0 ? (
          <Text style={styles.absence}>No one has messaged you about this listing yet.</Text>
        ) : (
          <>
            <Row label="Conversations" value={String(stats.conversations)} />
            <Row label="Messages" value={String(stats.messages)} />
          </>
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // No `gap`: the rhythm lives on the sections themselves, so a hairline sits
  // midway between two 32pt spans rather than at the edge of one.
  content: {
    padding: spacing.xl,
  },
  stack: {
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // 16, the same title → content step the sections use; 12 was the tightest
    // gap on a page whose whole argument is depth from whitespace.
    marginBottom: spacing.lg,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the glyph to the content gutter while the tap target stays 44pt.
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    // Uncapped, so it must be allowed to wrap rather than shove the chevron.
    flexShrink: 1,
  },
  // The measured rhythm: divider → 32 → title → 16 → content → 32 → divider.
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: spacing.xxl,
    gap: spacing.lg,
  },
  // The first section sits under the page title, which is its own separator.
  sectionFirst: {
    borderTopWidth: 0,
    paddingTop: 0,
  },
  // heading, NOT cardTitle: cardTitle is body-size at heavier weight and is
  // documented for feed-card titles, so it set "Sightings" at exactly the size
  // of the body sentence beneath it — the section header separated from its own
  // content by weight alone, on a layout whose whole structure is the rhythm
  // between them. heading is the step below the page title.
  sectionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  // sectionTitle, NOT title: title is the page's own size, and at 24 the
  // sightings total outranked the "Sightings" heading directly above it while
  // tying the screen title — three competing scales on one page. This matches
  // StatBand's value, so both hero numbers now read at one size.
  bigNumber: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
  },
  quiet: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // The absence sentence IS the content on the majority of listings, so it is
  // set in body. caption (the metadata role) whispered the one thing the page
  // had to say.
  absence: {
    ...typography.body,
    color: colors.textPrimary,
  },
  chart: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  // The count is the information and the word "Conversations" is the label for
  // it, so the emphasis runs value-first — the same way round as every other
  // number on this page (StatBand) and as profile's StatColumn.
  rowValue: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  // Loading blocks sized like the real content so nothing jumps on arrival.
  skeletonHeadlines: {
    height: sizes.statsSkeletonHead,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    width: '60%',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonBlock: {
    height: sizes.statsSkeletonBlock,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSubtle,
  },
});
