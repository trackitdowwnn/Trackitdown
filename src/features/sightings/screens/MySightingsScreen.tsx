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
 *        hatchbacks look like other silver hatchbacks. The copy in ReportCard
 *        is written to that: a rejection reads as an outcome, never as a mark
 *        against them.
 *
 *        The payload carries the car as they already saw it and nothing else —
 *        no owner, no location, no plate, no post id — so this page cannot be
 *        used to reach a listing they were never shown.
 *
 *        ⚠️ REDESIGNED 2026-08-27 (owner request, Airbnb language). The rows
 *        were three lines of text in a subtle grey box; they are now the house
 *        card — a leading tile, a title, a meta line and a marked outcome — at
 *        the same 24pt gutter and 12pt rhythm as every other list in the app.
 *        The card itself lives in ../components/ReportCard.tsx.
 *
 *        ⚠️ GROUPED BY DAY 2026-08-28 (owner request). The list is one flat
 *        array of headers and rows from `groupByDay`, not a SectionList — the
 *        inbox already produces exactly this shape, and nesting sections costs
 *        virtualization for nothing.
 *
 *        The owner asked for accordions and this deliberately has none, for two
 *        reasons worth keeping written down. A per-CARD accordion would open
 *        onto nothing: `my_sighting_record` returns six fields and the card
 *        already shows all six, and the payload must not widen. Collapsible
 *        DAY groups would then be a tap to reveal, usually, a single card,
 *        because reports are sparse. Airbnb's own history lists don't collapse
 *        either — they use plain section headers, which is what this is.
 * LINKS: src/app/my-sightings.tsx (route);
 *        src/features/sightings/components/ReportCard.tsx (the row AND its
 *          skeleton — they share styles so the two cannot drift);
 *        src/features/sightings/api/sightingApi.ts (fetchMySightingRecord);
 *        supabase/migrations/20260814110000_sighting_verification_rpcs.sql
 *          (my_sighting_record — read its PRIVACY note before widening this);
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useRequireAuth, useSession } from '@/features/auth';
import { useEntranceGate } from '@/shared/hooks';
import { groupByDay } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { EmptyState, ErrorState, Screen, ThemedRefreshControl } from '@/shared/ui';

import { ReportCard, ReportCardSkeleton } from '../components/ReportCard';
import { useMySightingRecord } from '../hooks/useMySightingRecord';

const log = createLogger('sightings');

/** ITEMS past this one enter together — headers occupy indices too, so in the
 *  sparse case only ~3 cards get distinct delays. Total stays 6 × listStagger =
 *  300ms, the house ceiling for a list. Matches the timeline. */
const STAGGER_CAP = 6;

export function MySightingsScreen() {
  const styles = useThemedStyles(makeStyles);
  const session = useSession();
  const requireAuth = useRequireAuth();
  const router = useRouter();

  const { status, entries, refreshing, refresh, retry } = useMySightingRecord();

  useEffect(() => {
    log.info('my_sightings_viewed');
  }, []);

  // ⚠️ GATED, BECAUSE THIS IS A FlatList. The mapped lists this idiom came from
  // (alerts, the sighting timeline) mount each row once; a virtualized cell is
  // RECYCLED, so an ungated `entering` re-fires every time a row scrolls back
  // into the window — and re-applies its index delay, so a row at index 6 fades
  // in 300ms after it is already on screen. The gate closes a beat after the
  // DATA arrives, so the entrance is confined to the first paint.
  const entranceActive = useEntranceGate(status === 'ready');

  // ⚠️ ONE FLAT ARRAY OF HEADERS AND ROWS, not nested sections — a section list
  // costs virtualization, and `groupByDay` already produces exactly this shape
  // for the inbox. Grouping only inserts a header when the day label changes,
  // so it relies on the RPC's newest-first order, which it has.
  const items = useMemo(() => groupByDay(entries), [entries]);

  const renderRow = useCallback(
    ({ item, index }: { item: (typeof items)[number]; index: number }) => (
      <Animated.View
        entering={
          entranceActive
            ? FadeInDown.duration(motion.standard)
                .delay(Math.min(index, STAGGER_CAP) * motion.listStagger)
                // Declarative, so the OS "reduce motion" setting is honoured
                // without this screen holding the hook — as the timeline does.
                .reduceMotion(ReduceMotion.System)
            : undefined
        }
      >
        {item.type === 'header' ? (
          // The same calendar words the inbox uses — "Today", "Yesterday", then
          // "23 July". A header is a real heading to a screen reader, so
          // rotor navigation can jump between days.
          <Text style={styles.dayHeader} accessibilityRole="header">
            {item.label}
          </Text>
        ) : (
          <ReportCard entry={item.row} />
        )}
      </Animated.View>
    ),
    [entranceActive, styles.dayHeader],
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
        <View
          style={styles.skeletons}
          testID="my-sightings-skeleton"
          accessible
          accessibilityLabel="Loading your reports"
          accessibilityState={{ busy: true }}
        >
          {/* ⚠️ A DAY HEADER LEADS THE LIST, so one leads the skeleton too.
              Grouping made item 0 a header, which put the first real card 46pt
              below where three bare card skeletons had just promised it would
              be — the same jump this skeleton exists to prevent, reintroduced
              by the change that added the headers.

              ⚠️ A BAR, NOT THE WORD "Today". Reports are sparse and the newest
              one usually is not today, so rendering the word would flash a
              claim that is about to be replaced by a different date. */}
          <DayHeaderSkeleton />
          {/* ⚠️ THE CARD'S OWN GEOMETRY, imported rather than copied. The old
              skeleton was a `height: 96` literal against a 104pt row, so three
              rows shifted everything below by 24pt the moment the reports
              landed. Re-deriving the number here would only have moved the
              drift to the font-scale axis; ReportCardSkeleton shares the
              styles instead. */}
          {[0, 1, 2].map((key) => (
            <ReportCardSkeleton key={key} />
          ))}
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
          data={items}
          renderItem={renderRow}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <ThemedRefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
          }
        />
      )}
    </Screen>
  );
}

/**
 * The day label's shape while the record loads — the same box `dayHeader` will
 * occupy, so the first card does not move when the reports arrive.
 *
 * Scales with `fontScale` for the reason ReportCardSkeleton does: the label it
 * stands in for is Text and grows with the OS setting, and a fixed-height View
 * does not.
 */
function DayHeaderSkeleton() {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();

  return (
    <View style={styles.dayHeaderSkeleton}>
      <View
        style={[
          styles.dayHeaderSkeletonBar,
          { height: typography.label.lineHeight * (fontScale ?? 1) },
        ]}
      />
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
      // 24, the house gutter — the list below sets the same, and the two used
      // to disagree with every other screen at 16.
      paddingHorizontal: spacing.xl,
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
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    /**
     * A day's label, in the same words and the same weight the inbox uses —
     * `label` at `textSecondary`, quiet enough that the cards stay the thing
     * you read.
     *
     * ⚠️ NO HORIZONTAL PADDING, unlike NotificationCenterScreen's copy of this
     * style. That list's content container is flush and each row pads itself;
     * ours already sets the 24pt gutter on `listContent`, so repeating it here
     * would indent every date 48pt from the edge. Note this aligns the label
     * with the card's OUTER EDGE, not its text — ReportCard pads itself by 16,
     * so the card's own content starts 16 further in. The inbox's header lands
     * on its row's text instead. Ours is the Airbnb arrangement (section labels
     * align to card edges) and the difference is deliberate.
     *
     * The vertical padding rides ON TOP of the list's 12pt gap: 16 above makes
     * 28 between a card and the next day, and 4 below makes 16 from label to
     * its first card. ⚠️ `lg` NOT `md` above — at 12 the totals were 24/16, an
     * 8pt differential against a 12pt inter-card gap, so three rhythms sat too
     * close to read as "new day" and the label floated between the groups
     * rather than belonging to the one below it. The inbox renders 32/20 for
     * the same reason; this is its 12pt differential on our gapped list.
     */
    dayHeader: {
      ...typography.label,
      color: c.textSecondary,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    /** Mirrors `dayHeader`'s box exactly — see DayHeaderSkeleton. */
    dayHeaderSkeleton: {
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    dayHeaderSkeletonBar: {
      width: '30%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    // No top padding: the list above sets none either, so the skeleton and the
    // real list start at the same y and nothing shifts when the data lands.
    skeletons: {
      paddingHorizontal: spacing.xl,
      gap: spacing.md,
    },
  });
