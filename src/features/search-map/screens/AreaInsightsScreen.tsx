/**
 * WHAT:  AreaInsightsScreen — how many cars have been reported stolen around
 *        here: four time windows, a 12-month chart, the makes and models taken
 *        most, a recovery rate, and how they were taken.
 * WHY:   The feed shows what is happening near someone one card at a time.
 *        Nothing told them the SHAPE of it — whether this month is normal for
 *        here, which cars go, whether they come back. All of it already existed
 *        in `posts` and had never been assembled.
 *
 * ⚠️ EVERY NUMBER HERE IS A COUNT OVER OTHER PEOPLE'S THEFTS, and the RPC behind
 *        it was rewritten three times to make that safe: membership is tested on
 *        a ~1km-snapped point, the caller's own centre and radius are quantised
 *        before they touch the table, and every floor is measured over listings
 *        the caller does NOT own so nobody can post their way past the
 *        suppression. This screen must not undo any of that by asking finer
 *        questions than the RPC answers — the radius control emits whole miles
 *        because anything else is silently rounded server-side.
 *
 * ⚠️ TWO RENDERING RULES THAT ARE NOT COSMETIC:
 *        1. `enoughData: false` shows a calm "not enough nearby" state and NEVER
 *           a page of zeros. Below the floor the RPC withholds the breakdown
 *           entirely, because a zeroed bucket still tells a prober the bucket
 *           exists.
 *        2. The how-taken and keys blocks are rendered AGAINST THEIR OWN
 *           `recorded` denominator. Neither field is collected by the posting
 *           wizard — both are post-hoc edits, so most listings carry NULL. A
 *           bare "3 driveway" over a silent denominator reads as "3 of the
 *           thefts here" when the truth is "3 of the 6 people who filled this
 *           in".
 * LINKS: src/app/area-insights.tsx (route);
 *        src/features/search-map/api/areaInsightsApi.ts;
 *        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql;
 *        src/features/vehicles/screens/PostStatsScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { StatsSparkline } from '@/features/vehicles';
import { useDefaultMapCentre } from '@/shared/lib/location/useDefaultMapCentre';
import { metresToMiles, milesToMetres } from '@/shared/lib/distance';
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
import {
  EmptyState,
  ErrorState,
  RadiusSlider,
  Screen,
  ThemedRefreshControl,
  useToast,
} from '@/shared/ui';

import { fetchAreaInsights, type AreaInsights } from '../api/areaInsightsApi';
import { toMonthlyBars, monthlySummary, recoveryRateLabel } from '../lib/areaInsightsModel';

const log = createLogger('search-map');

/** The feed's own default. "Round here" is already defined once. */
const DEFAULT_RADIUS_MILES = 20;

export function AreaInsightsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const centre = useDefaultMapCentre();
  const toast = useToast();
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [insights, setInsights] = useState<AreaInsights | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);
  // The radius the figures on screen were computed for. Kept because it is NOT
  // recoverable from the payload: the RPC quantises the radius it was given, so
  // `insights.radiusM` and what the slider asked for legitimately differ on a
  // perfectly good response, and comparing them would show an error forever.
  const [shownMiles, setShownMiles] = useState<number | null>(null);
  // ⚠️ The radius a failure BELONGS TO, not a bare boolean. A plain `failed`
  // flag is only ever cleared on success, so a blip at 20 miles was still set
  // when the reader dragged to 30 — and the error page appeared instantly, over
  // a request that was in flight and about to succeed. A working fetch
  // presented as a failure.
  const [failedMiles, setFailedMiles] = useState<number | null>(null);

  const lat = centre.centre?.latitude ?? null;
  const lng = centre.centre?.longitude ?? null;

  // Read inside the fetch callbacks to decide whether a failure needs saying
  // out loud. Refs rather than effect deps — depending on either would refetch
  // the moment a pull starts or figures land — and written only from callbacks,
  // never during render.
  const pulledRef = useRef(false);
  const insightsRef = useRef<AreaInsights | null>(null);

  // ⚠️ ONE FETCH PATH, and it is this effect. The pull bumps `generation`
  // rather than fetching for itself, so the single `cancelled` guard covers
  // both. When the pull ran its own request there was no guard on it at all:
  // pull at 20 miles, drag to 30, and the slower 20-mile response landed last
  // and overwrote the 30-mile figures — under a slider reading 30, with nothing
  // marking them stale. That is the exact "not stale, WRONG" failure the render
  // below argues against, arriving by the back door.
  //
  // The catch is not optional either: without it a rejected fetch left
  // `insights` null forever, which renders as the SKELETON — a permanent
  // shimmer that looks like slow loading and never resolves.
  useEffect(() => {
    if (lat === null || lng === null) return;
    let cancelled = false;
    // The radius THIS request asked for, captured so a late response can only
    // ever be recorded against the question it actually answered.
    const forMiles = radiusMiles;
    // Every write is after the await, so this never trips
    // react-hooks/set-state-in-effect.
    fetchAreaInsights(lat, lng, milesToMetres(forMiles))
      .then((next) => {
        if (cancelled) return;
        insightsRef.current = next;
        pulledRef.current = false;
        setInsights(next);
        setShownMiles(forMiles);
        setFailedMiles(null);
        setRefreshing(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailedMiles(forMiles);
        // A failed PULL over figures that are already up renders nothing new —
        // the figures rightly stay, which is the policy. Without this the
        // spinner just retracts and an explicit request is met with silence.
        if (pulledRef.current && insightsRef.current !== null) {
          toast.show("We couldn’t refresh just now — these are the last figures.", 'error');
        }
        pulledRef.current = false;
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, radiusMiles, generation, toast]);

  // The pull: ask the effect again. It owns the spinner and it is how someone
  // gets out of the error state without leaving the screen.
  const refresh = useCallback(() => {
    if (lat === null || lng === null) return;
    // Set in an event handler, so the effect can tell a pull from a radius
    // change or a first load without taking either as a dependency.
    pulledRef.current = true;
    setRefreshing(true);
    setGeneration((value) => value + 1);
  }, [lat, lng]);

  // Everything the render needs, asked ABOUT THE CURRENT RADIUS rather than in
  // general. "Do we have figures" is not a useful question on this screen; "do
  // we have figures for the area the slider is stating" is.
  const haveCurrent = insights !== null && shownMiles === radiusMiles;
  const currentFailed = failedMiles === radiusMiles;
  // A pull spinner over a skeleton is two loading indicators for one fetch, so
  // the spinner only shows when there is real content behind it to refresh.
  const showSpinner = refreshing && haveCurrent;

  useEffect(() => {
    log.info('area_insights_viewed');
  }, []);

  return (
    <Screen>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          Thefts near you
        </Text>
      </View>

      {centre.status === 'resolving' ? (
        <View style={styles.skeletons}>
          <View style={styles.skeletonBlock} />
          <View style={styles.skeletonBlock} />
        </View>
      ) : lat === null || lng === null ? (
        <EmptyState
          title="We need an area first"
          body="Turn on location, or set where you're looking on the Explore map, and this fills in."
          actionLabel="Go to Explore"
          onAction={() => router.push('/explore')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<ThemedRefreshControl refreshing={showSpinner} onRefresh={refresh} />}
        >
          {/* Whole miles only — the RPC quantises the radius, so sending
              anything else is silently rounded and the number under the slider
              would stop matching the figures above it. */}
          <RadiusSlider
            valueMiles={radiusMiles}
            onChangeMiles={(miles) => setRadiusMiles(Math.round(miles))}
          />

          {/* Order matters. Figures for the CURRENT radius win outright — a
              failed refresh over data that is already up must not replace it
              with an error page, because those figures are still true and
              losing them costs more than a minute of staleness.

              ⚠️ Once the radius moves they stop being stale and start being
              WRONG: this screen exists to say how much theft there is in a
              STATED area, and figures for 20 miles under a slider reading 30
              describe a different one. So a moved slider falls through to the
              skeleton (or the error, if this radius is the one that failed)
              rather than holding the old numbers up as an answer. */}
          {haveCurrent ? (
            !insights.enoughData ? (
            /* ⚠️ NEVER a page of zeros. Below the floor the RPC withholds the
               whole breakdown on purpose, and "0 thefts" would be a claim we
               have not made — it is "too few to say", which is a different and
               more honest sentence. */
              <EmptyState
                title="Not enough nearby to say"
                body={`We only show this once there are enough reports in an area to be meaningful. Try a wider radius than ${Math.round(metresToMiles(insights.radiusM))} miles.`}
              />
            ) : (
              <Insights data={insights} />
            )
          ) : currentFailed ? (
            <ErrorState
              title="We couldn’t load this area"
              body="Check your connection and try again."
              onRetry={refresh}
            />
          ) : (
            <View
              style={styles.skeletons}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Loading thefts near you"
              testID="area-insights-skeleton"
            >
              <View style={styles.skeletonHead} />
              <View style={styles.skeletonBlock} />
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Insights({ data }: { data: Extract<AreaInsights, { enoughData: true }> }) {
  const styles = useThemedStyles(makeStyles);
  const bars = toMonthlyBars(data.monthly);
  const recovery = recoveryRateLabel(data.recovered, data.closedTotal);

  return (
    <View style={styles.stack}>
      <Section title="Reported stolen">
        <View style={styles.windows}>
          <Window label="Last 7 days" value={data.total7d} />
          <Window label="30 days" value={data.total30d} />
          <Window label="90 days" value={data.total90d} />
          <Window label="12 months" value={data.total365d} />
        </View>
      </Section>

      <Section title="Over the last year">
        <StatsSparkline bars={bars} summary={monthlySummary(data.monthly)} />
        <Text style={styles.caption}>
          Every month is shown. A month with no reports is a real zero, not a gap.
        </Text>
      </Section>

      {data.topMakes.length > 0 ? (
        <Section title="Taken most often">
          {data.topMakes.map((row) => (
            <Row key={row.make} label={row.make} value={String(row.count)} capitalize />
          ))}
          {data.topModels.map((row) => (
            <Row
              key={`${row.make}-${row.model}`}
              label={`${row.make} ${row.model}`}
              value={String(row.count)}
              muted
            />
          ))}
          {/* The RPC folds make and model with lower(btrim(...)) and does NOT
              equate VW with Volkswagen. Said out loud rather than left for
              someone to notice in the data. */}
          <Text style={styles.caption}>
            Grouped by what owners typed, so spellings of the same make count separately.
          </Text>
        </Section>
      ) : null}

      {recovery ? (
        <Section title="Do they come back?">
          <Text style={styles.headline}>{recovery.headline}</Text>
          {/* The denominator is CLOSED listings only. An active listing has not
              failed to be recovered — it is still being looked for — and
              counting it as a miss would drag the rate down by however many
              cars are currently in flight. */}
          <Text style={styles.caption}>{recovery.caveat}</Text>
        </Section>
      ) : null}

      {data.takenFrom.buckets.length > 0 ? (
        <Section title="How they were taken">
          {data.takenFrom.buckets.map((bucket) => (
            <Row
              key={bucket.key}
              label={bucket.label}
              value={`${bucket.count} of ${data.takenFrom.recorded}`}
            />
          ))}
          <Denominator recorded={data.takenFrom.recorded} />
        </Section>
      ) : null}

      {data.keysTaken.buckets.length > 0 ? (
        <Section title="Were the keys taken?">
          {data.keysTaken.buckets.map((bucket) => (
            <Row
              key={bucket.key}
              label={bucket.label}
              value={`${bucket.count} of ${data.keysTaken.recorded}`}
            />
          ))}
          <Denominator recorded={data.keysTaken.recorded} />
        </Section>
      ) : null}
    </View>
  );
}

/**
 * ⚠️ THE DENOMINATOR IS NOT OPTIONAL. Neither how-taken nor keys-taken is
 * collected by the posting wizard — both are post-hoc edits, so most listings
 * carry NULL. Without this line "3 from a driveway" reads as three of all the
 * thefts here, when it means three of the handful of people who filled it in.
 */
function Denominator({ recorded }: { recorded: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Text style={styles.caption}>
      Based on the {recorded} {recorded === 1 ? 'listing' : 'listings'} where this was recorded —
      most owners don’t fill it in.
    </Text>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Window({ label, value }: { label: string; value: number }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.window}>
      <Text style={styles.windowValue}>{value}</Text>
      <Text style={styles.windowLabel}>{label}</Text>
    </View>
  );
}

/** `capitalize` is for owner-typed text (makes, models) — never for labels we
 *  authored, which are already sentence case. */
function Row({
  label,
  value,
  muted,
  capitalize,
}: {
  label: string;
  value: string;
  muted?: boolean;
  capitalize?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text
        style={[
          styles.rowLabel,
          muted ? styles.rowLabelMuted : null,
          capitalize ? styles.rowLabelCapitalized : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
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
      testID="area-insights-back"
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
    title: { ...typography.title, color: c.textPrimary, flexShrink: 1 },
    content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.xl },
    stack: { gap: spacing.xl },
    section: { gap: spacing.sm },
    sectionTitle: { ...typography.heading, color: c.textPrimary },
    windows: { flexDirection: 'row', gap: spacing.sm },
    window: {
      flex: 1,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      paddingVertical: spacing.md,
      alignItems: 'center',
      gap: spacing.xs,
    },
    windowValue: { ...typography.title, color: c.textPrimary },
    windowLabel: { ...typography.caption, color: c.textSecondary, textAlign: 'center' },
    headline: { ...typography.title, color: c.textPrimary },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    rowLabel: { ...typography.label, color: c.textPrimary, flexShrink: 1 },
    // ⚠️ ONLY for owner-typed makes and models ("bmw" → "Bmw"). It used to sit on
    // rowLabel itself, which the taken-from and keys-taken rows share — and
    // those labels are AUTHORED sentence case, so they rendered as "From A
    // Driveway" and "Keys Not Taken". Sentence case everywhere is the rule
    // (DESIGN_SYSTEM.md).
    rowLabelCapitalized: { textTransform: 'capitalize' },
    rowLabelMuted: { color: c.textSecondary },
    rowValue: { ...typography.label, color: c.textSecondary },
    caption: { ...typography.caption, color: c.textSecondary },
    skeletons: { paddingHorizontal: spacing.xl, gap: spacing.sm },
    // Reserved heights, so the real content lands in place instead of shifting
    // the page under a reader (sizes.ts). Matches PostStatsScreen.
    skeletonBlock: {
      height: sizes.statsSkeletonBlock,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonHead: {
      height: sizes.statsSkeletonHead,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
  });
