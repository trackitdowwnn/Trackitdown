/**
 * WHAT:  MySightingsScreen — the pushed "My reports" page (reached from
 *        Profile): every sighting the signed-in spotter has filed, newest
 *        first, with what the owner decided and when.
 * WHY:   A spotter could see three cumulative lifetime numbers on their profile
 *        and nothing else — no list, no "pending", no way to learn what became
 *        of report #7. They do the work of this product and then it goes quiet
 *        on them.
 *
 *        It is also where a `sighting_confirmed` push lands: without a screen,
 *        that notification had nowhere to route and stayed switched off.
 *
 * ⚠️ THE ONLY SURFACE ON WHICH A not_mine VERDICT IS VISIBLE, and only to the
 *        spotter themselves. No stranger-facing surface may show a rejection or
 *        derive an accuracy figure from one — a spotter answers a DESCRIPTION,
 *        and "the owner said no" is not the same as "they were wrong". Silver
 *        hatchbacks look like other silver hatchbacks. The copy below is written
 *        to that: a rejection reads as an outcome, never as a mark against them.
 *
 *        The payload carries the car as they already saw it and nothing else —
 *        no owner, no location, no plate, no post id — so this page cannot be
 *        used to reach a listing they were never shown.
 * LINKS: src/app/my-sightings.tsx (route);
 *        src/features/sightings/api/sightingApi.ts (fetchMySightingRecord);
 *        supabase/migrations/20260814110000_sighting_verification_rpcs.sql
 *          (my_sighting_record — read its PRIVACY note before widening this);
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
import { useTimeAgo } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, ErrorState, Screen, ThemedRefreshControl } from '@/shared/ui';

import { type MySightingRecordEntry } from '../api/sightingApi';
import { useMySightingRecord } from '../hooks/useMySightingRecord';

const log = createLogger('sightings');

/**
 * How each verdict reads to THE PERSON WHO REPORTED IT.
 *
 * `not_mine` is the one that matters. It is the absence of a confirmation, not
 * a failure: the owner looked and it was a different car. "Not a match" says
 * that about the CAR. Anything framing it as the spotter being wrong — "not
 * confirmed", "rejected", a red anything — would be both unkind and untrue, and
 * it is the reason this screen exists rather than a status column somewhere
 * public.
 *
 * `unverified` is deliberately "Waiting on the owner", not "Unverified": the
 * spotter has done everything asked of them and the ball is elsewhere.
 */
const VERDICT: Record<MySightingRecordEntry['status'], { label: string; tone: 'good' | 'plain' }> = {
  unverified: { label: 'Waiting on the owner', tone: 'plain' },
  helpful: { label: 'Owner found this helpful', tone: 'good' },
  not_mine: { label: 'Not a match', tone: 'plain' },
  credited: { label: 'Credited — this one led to the recovery', tone: 'good' },
};

export function MySightingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const { status, entries, refreshing, refresh, retry } = useMySightingRecord();

  useEffect(() => {
    log.info('my_sightings_viewed');
  }, []);

  const renderRow = useCallback(
    ({ item }: { item: MySightingRecordEntry }) => <RecordRow entry={item} />,
    [],
  );

  return (
    <Screen>
      {/* Pushed page, headers hidden app-wide → an on-screen back control. */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          My reports
        </Text>
      </View>

      {session.status === 'signedOut' ? (
        <EmptyState
          title="Your reports live here"
          body="Every car you report shows up here, with what the owner decided."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'my_sightings' })}
        />
      ) : status === 'loading' ? (
        <View style={styles.skeletons}>
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
          <View style={styles.skeletonRow} />
        </View>
      ) : status === 'error' ? (
        <ErrorState body="We couldn’t load your reports." onRetry={retry} />
      ) : entries.length === 0 ? (
        <EmptyState
          title="No reports yet"
          body="When you report a car you’ve spotted, it shows up here — and you’ll see when the owner takes a look."
          actionLabel="Find cars near you"
          onAction={() => router.push('/explore')}
        />
      ) : (
        <FlatList
          data={entries}
          renderItem={renderRow}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
        />
      )}
    </Screen>
  );
}

function RecordRow({ entry }: { entry: MySightingRecordEntry }) {
  const styles = useThemedStyles(makeStyles);
  const reported = useTimeAgo(entry.createdAt);
  const ruled = useTimeAgo(entry.reviewedAt ?? entry.createdAt);
  const verdict = VERDICT[entry.status];

  // Either half may be '' on a sparse post (the RPC coalesces rather than
  // nulls), and both blank is a real state — "a car" is the honest sentence
  // there, and the same fallback the confirmation push uses.
  const car = [entry.car.colour, entry.car.make].filter(Boolean).join(' ') || 'a car';

  return (
    <View style={styles.row} testID={`my-sighting-${entry.id}`}>
      <Text style={styles.rowCar} numberOfLines={1}>
        {car}
      </Text>
      <Text style={styles.rowWhen} numberOfLines={1}>
        {entry.areaLabel ? `${entry.areaLabel} · ${reported}` : reported}
      </Text>
      <Text
        style={verdict.tone === 'good' ? [styles.rowVerdict, styles.rowVerdictGood] : styles.rowVerdict}
      >
        {verdict.label}
        {/* WHEN they ruled, only once they have. NULL reviewed_at means nobody
            has looked, which must never be dressed up as a decision. */}
        {entry.reviewedAt ? ` · ${ruled}` : ''}
      </Text>
    </View>
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
      testID="my-sightings-back"
    >
      <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
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
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.sm,
    },
    row: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    rowCar: {
      ...typography.cardTitle,
      color: c.textPrimary,
      // The car is the headline: it is how a spotter recognises which of their
      // own reports this is, with no plate and no photo on the row.
      textTransform: 'capitalize',
    },
    rowWhen: {
      ...typography.caption,
      color: c.textSecondary,
    },
    rowVerdict: {
      ...typography.label,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    /** helpful / credited only. A verdict that went the spotter's way is the
     *  one moment this screen has to give them, so it takes the ink. Nothing
     *  goes red: the other outcomes are not failures. */
    rowVerdictGood: {
      color: c.primary,
    },
    skeletons: {
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
    },
    skeletonRow: {
      height: 96,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
  });
