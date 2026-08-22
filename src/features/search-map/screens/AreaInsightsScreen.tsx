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
import { useEffect, useState } from 'react';
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
import { EmptyState, RadiusSlider, Screen } from '@/shared/ui';

import { fetchAreaInsights, type AreaInsights } from '../api/areaInsightsApi';
import { toMonthlyBars, monthlySummary, recoveryRateLabel } from '../lib/areaInsightsModel';

const log = createLogger('search-map');

/** The feed's own default. "Round here" is already defined once. */
const DEFAULT_RADIUS_MILES = 20;

export function AreaInsightsScreen() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const centre = useDefaultMapCentre();
  const [radiusMiles, setRadiusMiles] = useState(DEFAULT_RADIUS_MILES);
  const [insights, setInsights] = useState<AreaInsights | null>(null);

  const lat = centre.centre?.latitude ?? null;
  const lng = centre.centre?.longitude ?? null;

  useEffect(() => {
    if (lat === null || lng === null) return;
    let cancelled = false;
    // Every write is after the await, so this never trips
    // react-hooks/set-state-in-effect.
    void fetchAreaInsights(lat, lng, milesToMetres(radiusMiles)).then((next) => {
      if (!cancelled) setInsights(next);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, radiusMiles]);

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
        <ScrollView contentContainerStyle={styles.content}>
          {/* Whole miles only — the RPC quantises the radius, so sending
              anything else is silently rounded and the number under the slider
              would stop matching the figures above it. */}
          <RadiusSlider
            valueMiles={radiusMiles}
            onChangeMiles={(miles) => setRadiusMiles(Math.round(miles))}
          />

          {insights === null ? (
            <View style={styles.skeletons}>
              <View style={styles.skeletonBlock} />
              <View style={styles.skeletonBlock} />
            </View>
          ) : !insights.enoughData ? (
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
            <Row key={row.make} label={row.make} value={String(row.count)} />
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

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Text style={muted ? [styles.rowLabel, styles.rowLabelMuted] : styles.rowLabel} numberOfLines={1}>
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
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
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
    rowLabel: { ...typography.label, color: c.textPrimary, flexShrink: 1, textTransform: 'capitalize' },
    rowLabelMuted: { color: c.textSecondary },
    rowValue: { ...typography.label, color: c.textSecondary },
    caption: { ...typography.caption, color: c.textSecondary },
    skeletons: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    skeletonBlock: { height: 120, borderRadius: radii.lg, backgroundColor: c.surfaceSubtle },
  });
