/**
 * WHAT:  AreaInsightsScreen — how many cars have been reported stolen around
 *        here, as a stack of cards: a hero card (the 30-day count over a quiet
 *        stat row — 7 days / 90 days / 12 months — with the radius as a
 *        disclosed "within N miles · Change" line), then one card per
 *        question — a 12-month chart, the makes and models taken most, a
 *        recovery rate, how they were taken, whether the keys went.
 * WHY:   The feed shows what is happening near someone one card at a time.
 *        Nothing told them the SHAPE of it — whether this month is normal for
 *        here, which cars go, whether they come back. All of it already existed
 *        in `posts` and had never been assembled.
 *
 *        REDESIGNED 2026-09-21 (/airbnb-redesign) after the owner found it
 *        "confusing and not easy to read". It opened with a slider labelled
 *        "Alert radius" and four equal grey tiles — no headline, three visual
 *        grammars (tiles, chart, rows), and six caveat captions louder than the
 *        facts. That pass settled the CONTENT order, which still stands: ONE
 *        loud statistic, everything else quiet; values leading their labels;
 *        one quiet caveat per section. Calm and factual — no severity colour,
 *        no trend arrows — because the register Airbnb's own insights pages
 *        use (upbeat, benchmarked) is wrong for a page about crime near
 *        someone's home.
 *
 *        RE-SHAPED 2026-09-22 into CARD SECTIONS at the owner's request ("I'd
 *        like this in sections like it's own card sections"), after research
 *        into how stats pages are drawn on Dribbble and in the apps they
 *        imitate (Apple Health's Summary, Stripe's metric cards). The pattern
 *        that recurs: each question gets its own resting card — a small title,
 *        one headline value or statement, then the supporting chart or rows,
 *        then a caption — and the page is those cards stacked in one column
 *        with the hero card first and biggest. Two lessons from that research
 *        shape the details here:
 *          · Apple Health's summary-first rule: the sentence comes before the
 *            chart, and a screen reader hears the sentence, not the bars. Our
 *            hero sentence and monthlySummary already worked this way.
 *          · The most common complaint about card-based insights pages is
 *            that the cards LOOK tappable and are not. So these are the
 *            house resting card (`cardSurface`: flat, hairline, no shadow —
 *            a shadow means "floats", which is what a tappable sheet does),
 *            with no chevrons and nothing pressable but the radius line.
 *        The previous flat-section layout was itself a decision AGAINST boxes
 *        ("boxes read as a dashboard"); the owner has seen it and asked for
 *        cards, and that is theirs to call. PostStatsScreen stays flat.
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
 * SCOPE (2026-09-21): opened from a feed SECTION's stats button, so it is
 *        told which area to answer for. Three ways in, tried in this order:
 *          · `lat`/`lng` (+ `radiusMiles`) — Near you: the feed's own circle,
 *            so the figures cover exactly the cards the reader just scrolled.
 *          · `area` — a named town ("Recently stolen in St Albans"): forward-
 *            geocoded here, exactly as the map resolves "See all → <area>",
 *            at the shared town-sized AREA_ENTRY_RADIUS_MILES. A geocode miss
 *            is said plainly rather than silently answering for somewhere
 *            else — a number about the wrong place is worse than none.
 *          · neither — the device's default centre, so any older entry (a
 *            deep link, a stale route) still lands somewhere true.
 *        The title names the scope ("Thefts in St Albans" / "Thefts near
 *        you") because a figure with no place attached is not a figure.
 * LINKS: src/app/area-insights.tsx (route + param parsing);
 *        src/features/search-map/screens/HomeFeedScreen.tsx (openStats);
 *        src/features/search-map/lib/feedSections.ts (AREA_ENTRY_RADIUS_MILES);
 *        src/features/search-map/api/areaInsightsApi.ts;
 *        supabase/migrations/20260811160000_area_insights_bucket_floor_owner.sql;
 *        src/features/vehicles/screens/PostStatsScreen.tsx (the pattern).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StatsSparkline } from '@/features/vehicles';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { useDefaultMapCentre } from '@/shared/lib/location/useDefaultMapCentre';
import { metresToMiles, milesToMetres } from '@/shared/lib/distance';
import { createLogger } from '@/shared/lib/logger';
import {
  cardSurface,
  displayFontScaleCap,
  motion,
  opacity,
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
  StatBand,
  type StatBandCell,
  ThemedRefreshControl,
  useToast,
} from '@/shared/ui';

import { fetchAreaInsights, type AreaInsights } from '../api/areaInsightsApi';
import { toMonthlyBars, monthlySummary, recoveryRateLabel } from '../lib/areaInsightsModel';
import { AREA_ENTRY_RADIUS_MILES } from '../lib/feedSections';

const log = createLogger('search-map');

/** The feed's own default. "Round here" is already defined once. */
const DEFAULT_RADIUS_MILES = 20;

export interface AreaInsightsScreenProps {
  /** A named town to answer for — geocoded here. Wins over nothing; loses
   *  to an explicit point. */
  area?: string;
  /** The feed area's human name, sent alongside an explicit point so the
   *  page can say "Thefts near St Albans". Display only — never a scope. */
  label?: string;
  /** An explicit centre (the feed's own). Wins over `area`. */
  lat?: number;
  lng?: number;
  /** The starting radius. Defaults: town-sized for `area`, the feed's 20 for
   *  everything else. The slider takes over from there. */
  radiusMiles?: number;
}

/** What geocoding the `area` prop produced, or is still producing. */
type GeocodeState =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'resolved'; latitude: number; longitude: number }
  | { status: 'missed' };

export function AreaInsightsScreen({
  area,
  label,
  lat: latProp,
  lng: lngProp,
  radiusMiles: radiusProp,
}: AreaInsightsScreenProps = {}) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  // ⚠️ THE BOTTOM INSET IS ADDED TO THE SCROLL CONTENT, NOT TO THE SCREEN.
  // Screen pads the top only, and at SDK 57 Android is edge-to-edge, so the
  // scroll's fixed 32pt tail ended BEHIND the three-button bar and the last
  // card's caption sat under "back". Padding the content (the way
  // StickyActionBar and BottomSheet add `insets.bottom` themselves) keeps
  // the scroll region running to the screen edge — cards slide under the
  // bar as they scroll past, which is right — while the end of the content
  // still clears it.
  const insets = useSafeAreaInsets();
  // Called unconditionally (hooks rule); its answer is used only when neither
  // a point nor an area came in through the route.
  const defaultCentre = useDefaultMapCentre();
  const toast = useToast();
  // Read by the fetch effect through a ref, NOT as a dependency: the effect's
  // deps are exactly "what changes the question" (centre, radius, a pull), and
  // the toast is not one of them. Listing it would make any re-render that
  // hands back a new toast object refetch — and refetching resets the figures
  // to the skeleton, which is how opening the radius control could blank the
  // page it was opened from.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);
  const hasPoint = latProp !== undefined && lngProp !== undefined;
  const [radiusMiles, setRadiusMiles] = useState(
    radiusProp ?? (area && !hasPoint ? AREA_ENTRY_RADIUS_MILES : DEFAULT_RADIUS_MILES),
  );
  const [geocode, setGeocode] = useState<GeocodeState>({ status: 'idle' });
  // The radius control is disclosed, not pinned: the figure is the hero and
  // "within N miles · Change" beneath it is enough until someone wants to
  // move it. Default closed on every entry.
  const [radiusOpen, setRadiusOpen] = useState(false);
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

  // Resolve the named area to a point, the way the map does for "See all →
  // <area>". Cancelled-guarded: a fast back-and-forth between two sections
  // must not let the slower town's coordinates land under the faster's title.
  // Every write is after the await, so react-hooks/set-state-in-effect is
  // not tripped.
  useEffect(() => {
    if (!area || hasPoint) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) setGeocode({ status: 'resolving' });
        return expoLocationServices.forwardGeocode(area);
      })
      .then((hits) => {
        if (cancelled) return;
        setGeocode(
          hits.length > 0
            ? { status: 'resolved', latitude: hits[0].latitude, longitude: hits[0].longitude }
            : { status: 'missed' },
        );
      })
      .catch(() => {
        // Geocoding is a network call; a failure is the same answer as a
        // miss from the reader's side — we cannot place the town.
        if (!cancelled) setGeocode({ status: 'missed' });
      });
    return () => {
      cancelled = true;
    };
  }, [area, hasPoint]);

  // The centre, by precedence: an explicit point, the geocoded area, the
  // device default. `resolving` covers both the geocode and the default
  // centre's own lookup so the skeleton shows for either.
  const scope: 'feed' | 'area' | 'default' = hasPoint ? 'feed' : area ? 'area' : 'default';
  const resolving =
    scope === 'area'
      ? geocode.status === 'idle' || geocode.status === 'resolving'
      : scope === 'default' && defaultCentre.status === 'resolving';
  const areaMissed = scope === 'area' && geocode.status === 'missed';
  const lat =
    scope === 'feed'
      ? (latProp as number)
      : scope === 'area'
        ? geocode.status === 'resolved'
          ? geocode.latitude
          : null
        : (defaultCentre.centre?.latitude ?? null);
  const lng =
    scope === 'feed'
      ? (lngProp as number)
      : scope === 'area'
        ? geocode.status === 'resolved'
          ? geocode.longitude
          : null
        : (defaultCentre.centre?.longitude ?? null);

  // "Thefts in St Albans" / "Thefts near St Albans" / "Thefts near you": a
  // figure with no place attached is not a figure. Both names are user- or
  // geocoder-authored text (posts.last_seen_area, the feed's addressLabel),
  // rendered as-is here and never logged.
  const title = area
    ? `Thefts in ${area}`
    : label
      ? `Thefts near ${label}`
      : 'Thefts near you';

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
          toastRef.current.show(
            "We couldn’t refresh just now — these are the last figures.",
            'error',
          );
        }
        pulledRef.current = false;
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, radiusMiles, generation]);

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
    // The scope, never the area NAME: last_seen_area is user-authored text.
    log.info('area_insights_viewed', { scope });
  }, [scope]);

  return (
    <Screen>
      <View style={styles.headerRow}>
        <BackButton />
        {/* Uncapped, like PostStatsScreen: "Thefts in Newcastle-under-Lyme"
            must wrap rather than lose the place — a figure with its place
            ellipsised is the same failure as a figure with none. */}
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      </View>

      {resolving ? (
        <StatsSkeleton label={`Loading ${title.toLowerCase()}`} outside />
      ) : areaMissed ? (
        // Honest, not helpful-by-accident: falling back to the device centre
        // here would show a different place's numbers under this town's name.
        // The action DOES the alternative rather than describing it: the map
        // resolves a named area itself, so the reader lands somewhere useful
        // in one tap. `replace`, not push — this screen has nothing to come
        // back to.
        <EmptyState
          title={`We couldn’t place ${area}`}
          body="We couldn’t work out where that is. You can still look for it on the map."
          actionLabel="Show on the map"
          onAction={() => router.replace({ pathname: '/search-map', params: { area } })}
        />
      ) : lat === null || lng === null ? (
        <EmptyState
          title="We need an area first"
          body="Turn on location, or set where you're looking on the Explore map, and this fills in."
          actionLabel="Go to Explore"
          onAction={() => router.push('/explore')}
        />
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: spacing.xxl + insets.bottom },
          ]}
          testID="stats-scroll"
          refreshControl={<ThemedRefreshControl refreshing={showSpinner} onRefresh={refresh} />}
        >
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
              <Card testID="stats-card-empty">
                {/* ⚠️ NEVER a page of zeros. Below the floor the RPC withholds
                    the whole breakdown on purpose, and "0 thefts" would be a
                    claim we have not made — it is "too few to say", which is a
                    different and more honest sentence. Told WHY first, then
                    handed the way out beneath. */}
                <EmptyState
                  title="Not enough nearby to say"
                  body={`We only show this once there are enough reports in an area to be meaningful. Try a wider radius than ${Math.round(metresToMiles(insights.radiusM))} miles.`}
                  // Inside the ScrollView's own xl gutter — EmptyState's default
                  // would stack to 48pt a side and wrap the body to 8 lines.
                  gutter="none"
                />
                <RadiusControl
                  radiusMiles={radiusMiles}
                  open
                  pinned
                  onChangeMiles={setRadiusMiles}
                />
              </Card>
            ) : (
              <Insights
                data={insights}
                radiusMiles={radiusMiles}
                radiusOpen={radiusOpen}
                onToggleRadius={() => setRadiusOpen((open) => !open)}
                onChangeMiles={setRadiusMiles}
              />
            )
          ) : currentFailed ? (
            <ErrorState
              title="We couldn’t load this area"
              body="Check your connection and try again."
              onRetry={refresh}
            />
          ) : (
            <StatsSkeleton label={`Loading ${title.toLowerCase()}`} />
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

/**
 * The page's body: a single column of cards, 16 apart. The hero card first
 * and biggest — the 30-day sentence, the radius line, the stat band under a
 * hairline — then one card per question, each a small title over its
 * content over its caveat. One column, never a grid: the two-up "stat
 * tiles" grid that Dribbble stats pages favour is for figures that are peers
 * of each other, and nothing here is a peer of the hero.
 *
 * MOTION (2026-09-22, owner asked for "some subtle animation"): the cards
 * arrive with the app's one sanctioned list entrance — a staggered
 * `FadeInDown` at `motion.standard`, `listStagger` apart, the same rhythm as
 * AlertsScreen and the inbox — so the page composes itself top-down in
 * under half a second, and the year chart's bars rise from their baseline
 * inside their card as it lands. Nothing counts up, nothing bounces: a
 * number ticking towards a theft total is a slot machine, and `springBouncy`
 * is reserved for reward moments. All of it collapses under reduced motion.
 *
 * Calm and factual throughout (owner decision 2026-09-21): no severity
 * colour, no trend arrows, no "up 40%" badges — a red arrow next to a theft
 * count is an alarm, and the reader is already worried.
 */
function Insights({
  data,
  radiusMiles,
  radiusOpen,
  onToggleRadius,
  onChangeMiles,
}: {
  data: Extract<AreaInsights, { enoughData: true }>;
  radiusMiles: number;
  radiusOpen: boolean;
  onToggleRadius: () => void;
  onChangeMiles: (miles: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const bars = toMonthlyBars(data.monthly);
  const recovery = recoveryRateLabel(data.recovered, data.closedTotal);
  const summary = monthlySummary(data.monthly);

  // Which optional cards render, decided once, so each card's stagger index
  // is its RENDERED position: an absent makes card must not leave a 50ms
  // hole before the recovery card. Hero is 0 and the year chart 1, always.
  const showMakes = data.topMakes.length > 0;
  const showRecovery = Boolean(recovery);
  const showTaken = data.takenFrom.buckets.length > 0;
  const showKeys = data.keysTaken.buckets.length > 0;
  const makesIndex = 2;
  const recoveryIndex = makesIndex + (showMakes ? 1 : 0);
  const takenIndex = recoveryIndex + (showRecovery ? 1 : 0);
  const keysIndex = takenIndex + (showTaken ? 1 : 0);

  // The 30-day count is the hero: "how bad is it here, now" is the question
  // a worried owner opened this page with. The other windows sit in the band.
  const heroCount = data.total30d;
  const band: StatBandCell[] = [
    { key: '7d', value: String(data.total7d), label: 'last 7 days', spoken: `${data.total7d} in the last 7 days` },
    { key: '90d', value: String(data.total90d), label: 'last 90 days', spoken: `${data.total90d} in the last 90 days` },
    { key: '365d', value: String(data.total365d), label: 'last 12 months', spoken: `${data.total365d} in the last 12 months` },
  ];

  return (
    <View style={styles.stack}>
      <Card testID="stats-card-hero">
        {/* A sentence, not a bare number: the count at title size and weight,
            its words in body Regular beside it, so the number leads by both
            size and weight — the reference's grammar for a hero figure — and
            "14" cannot be mistaken for anything else on the page. One text
            node, one baseline, one screen-reader stop.

            The font-scale cap is repeated on the number run: it is not
            reliably inherited across nested Text (OnboardingSlide records
            the same), and an uncapped numeral at 200% would outgrow the
            words it belongs to. Zero reads "No cars" — calmer and truer than
            a "0". */}
        <Text style={styles.hero} accessibilityRole="header" testID="stats-hero">
          <Text style={styles.heroNumber} maxFontSizeMultiplier={displayFontScaleCap}>
            {heroCount === 0 ? 'No' : heroCount}
          </Text>
          {heroCount === 1 ? ' car reported stolen ' : ' cars reported stolen '}
          in the last 30 days
        </Text>
        <RadiusControl
          radiusMiles={radiusMiles}
          open={radiusOpen}
          onToggle={onToggleRadius}
          onChangeMiles={onChangeMiles}
        />
        {/* A hairline between the sentence and the band, INSIDE the card: the
            band's cells are divided by vertical hairlines already, and the
            horizontal one turns them into a footer row of the hero card
            rather than three stray numbers under a paragraph. */}
        <View style={styles.bandFooter}>
          <StatBand cells={band} />
        </View>
      </Card>

      <Card title="Over the last year" index={1} testID="stats-card-year">
        {/* The sparkline draws a zero month as a visible stub, so the old
            "every month is shown, a gap is a real zero" caption is now said
            by the chart itself; it survives as the chart's spoken summary. */}
        <StatsSparkline
          bars={bars}
          summary={`${summary} Every month is shown; a month with no reports is a real zero.`}
          growIn
        />
        <Text style={styles.quiet}>{summary}</Text>
      </Card>

      {showMakes ? (
        <Card title="Taken most often" index={makesIndex} testID="stats-card-makes">
          <View style={styles.rows}>
            {data.topMakes.map((row) => (
              <Row key={row.make} label={row.make} value={String(row.count)} capitalize />
            ))}
            {data.topModels.map((row) => (
              <Row
                key={`${row.make}-${row.model}`}
                label={`${row.make} ${row.model}`}
                value={String(row.count)}
                capitalize
                indented
              />
            ))}
          </View>
          {/* The RPC folds make and model with lower(btrim(...)) and does NOT
              equate VW with Volkswagen. Said out loud rather than left for
              someone to notice in the data. */}
          <Text style={styles.quiet}>
            Counted as owners typed them, so two spellings of one make count separately.
          </Text>
        </Card>
      ) : null}

      {recovery ? (
        <Card title="Do they come back?" index={recoveryIndex} testID="stats-card-recovery">
          <Text style={styles.statement} maxFontSizeMultiplier={displayFontScaleCap}>
            {recovery.headline}
          </Text>
          {/* The denominator is CLOSED listings only. An active listing has not
              failed to be recovered — it is still being looked for — and
              counting it as a miss would drag the rate down by however many
              cars are currently in flight. */}
          <Text style={styles.quiet}>{recovery.caveat}</Text>
        </Card>
      ) : null}

      {showTaken ? (
        <Card title="How they were taken" index={takenIndex} testID="stats-card-taken">
          <View style={styles.rows}>
            {data.takenFrom.buckets.map((bucket) => (
              <Row
                key={bucket.key}
                label={bucket.label}
                value={`${bucket.count} of ${data.takenFrom.recorded}`}
              />
            ))}
          </View>
          <Denominator recorded={data.takenFrom.recorded} aside />
        </Card>
      ) : null}

      {showKeys ? (
        <Card title="Were the keys taken?" index={keysIndex} testID="stats-card-keys">
          <View style={styles.rows}>
            {data.keysTaken.buckets.map((bucket) => (
              <Row
                key={bucket.key}
                label={bucket.label}
                value={`${bucket.count} of ${data.keysTaken.recorded}`}
              />
            ))}
          </View>
          {/* The aside rides on the first block that needs it; if that block
              is absent this one carries it instead. */}
          <Denominator
            recorded={data.keysTaken.recorded}
            aside={!showTaken}
          />
        </Card>
      ) : null}
    </View>
  );
}

/**
 * "within 5 miles · Change" — the radius as one quiet line under the hero,
 * with the slider disclosed beneath it on demand. The figure is the point of
 * the page; a full slider pinned above it made the control look like the
 * point instead (and its default label read "Alert radius", a leak from the
 * alerts feature — this is not an alert).
 *
 * THE WHOLE LINE IS THE TARGET. A Pressable around the word "Change" alone
 * is an 18pt-tall target inside an 18pt row, and Android drops touches in
 * slop that falls outside the parent's bounds (bugWizardSteps records the
 * same lesson). So the line is one Pressable padded to 44pt — pulled back
 * into the 16pt rhythm the way the back glyph is — holding ONE Text with an
 * underlined run: one baseline, one screen-reader stop, one tap.
 *
 * `pinned` (the not-enough state): the slider is the way OUT of that state,
 * so it is shown open with no toggle at all — an underlined "Done" that did
 * nothing would break "underline = tappable" and announce as a dead button.
 *
 * Whole miles only — the RPC quantises the radius, so sending anything else
 * is silently rounded and the number in this line would stop matching the
 * figures above it.
 */
function RadiusControl({
  radiusMiles,
  open,
  pinned = false,
  onToggle,
  onChangeMiles,
}: {
  radiusMiles: number;
  open: boolean;
  pinned?: boolean;
  onToggle?: () => void;
  onChangeMiles: (miles: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const within = `within ${radiusMiles} ${radiusMiles === 1 ? 'mile' : 'miles'}`;
  return (
    <View style={styles.radius}>
      {pinned ? (
        <Text style={styles.quiet}>{within}</Text>
      ) : (
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={`${within}. ${open ? 'Hide the radius control' : 'Change the radius'}`}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.radiusLine, pressed && styles.radiusLinePressed]}
          testID="stats-change-radius"
        >
          <Text style={styles.quiet}>
            {within} ·{' '}
            {/* Underline = tappable (DESIGN_SYSTEM) — the profile's text-action
                idiom; no colour needed. */}
            <Text style={styles.radiusAction}>{open ? 'Done' : 'Change'}</Text>
          </Text>
        </Pressable>
      )}
      {pinned || open ? (
        // A fade, not a slide: the slider appears where the line already
        // pointed, and `fast` is the micro-interaction duration. Pinned open
        // it still fades in — that first paint is a disclosure too.
        <Animated.View entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}>
          <RadiusSlider
            label="Radius"
            valueMiles={radiusMiles}
            onChangeMiles={(miles) => onChangeMiles(Math.round(miles))}
            testID="stats-radius-slider"
          />
        </Animated.View>
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
function Denominator({ recorded, aside = false }: { recorded: number; aside?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  // The rows already say "3 of 6"; this line's only job is to say what 6 is.
  // The "it's optional" aside is said ONCE on the page (the first block that
  // needs it), not under every section — and neutrally: "most owners don't
  // fill it in" read as a nudge at the reader's neighbours.
  return (
    <Text style={styles.quiet}>
      Of the {recorded} {recorded === 1 ? 'listing' : 'listings'} where this was recorded.
      {aside ? ' It’s optional, so most listings leave it blank.' : ''}
    </Text>
  );
}

/**
 * One question, one card: the house resting box (`cardSurface` — surface,
 * `lg` radius, hairline, NO shadow) with 16 inside and a 12 step between
 * title, content and caption. The title is `cardTitle` — the token named for
 * exactly this, body size at Bold — so it labels the card without competing
 * with the hero sentence two cards up. NOT a Pressable and no chevron: the
 * cards hold answers, and a box that looks tappable and is not is the most
 * common complaint about this pattern.
 *
 * `index` is the card's RENDERED position in the column, for the staggered
 * entrance: `listStagger` per step, capped at 6 like every other stagger in
 * the app so a long page never keeps a reader waiting on its tail. The
 * caller computes it (a card cannot know how many siblings rendered), so an
 * absent block leaves no hole in the rhythm.
 */
function Card({
  title,
  index = 0,
  testID,
  children,
}: {
  title?: string;
  index?: number;
  testID?: string;
  children: React.ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Animated.View
      style={styles.card}
      entering={FadeInDown.duration(motion.standard)
        .delay(Math.min(index, 6) * motion.listStagger)
        .reduceMotion(ReduceMotion.System)}
      testID={testID}
    >
      {title ? (
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </Animated.View>
  );
}

/**
 * Label left, value right — and the VALUE leads by weight, because the count
 * is the information and the word beside it is the label for it (the same way
 * round as StatBand and every other number on this page).
 *
 * `capitalize` is for owner-typed text (makes, models) — never for labels we
 * authored, which are already sentence case. `indented` is for the models
 * under their makes.
 */
function Row({
  label,
  value,
  capitalize,
  indented,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
  indented?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    // One accessible node, as StatBand reasons: "Ford: 6" in one stop rather
    // than a label and a bare number the reader has to pair up.
    <View
      style={[styles.row, indented && styles.rowIndented]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      {/* Two lines, not one: an owner-typed "Mercedes-Benz E-Class Estate" at
          large type is a name lost if it ellipsises. The value stays centred
          against a taller row. */}
      <Text
        style={[
          styles.rowLabel,
          indented ? styles.rowLabelSecondary : null,
          capitalize ? styles.rowLabelCapitalized : null,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** The one loading placeholder, used while the town is being placed AND
 *  while the figures load — so both waits are announced the same way. */
function StatsSkeleton({ label, outside = false }: { label: string; outside?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={[styles.skeletons, outside && styles.skeletonOutside]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      testID="area-insights-skeleton"
    >
      <View style={styles.skeletonHead} />
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonBlock} />
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
      // xl, matching the content gutter below (and PostStatsScreen, the
      // pattern): the back glyph and the figures share one left edge.
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      // 16, the same title → content step the sections use (PostStatsScreen's
      // headerRow marginBottom); the first section adds nothing on top.
      paddingBottom: spacing.lg,
    },
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    title: { ...typography.title, color: c.textPrimary, flexShrink: 1 },
    // xl gutter, like every other card stack (AlertsScreen, the notification
    // centre): the page title and the cards share one left edge, and a 16
    // inset inside the card is the Card entry's own padding.
    // paddingBottom is set inline: xxl PLUS the safe-area inset, read at
    // render (see the ScrollView).
    content: { paddingHorizontal: spacing.xl },
    // The column of cards. 16 between them — enough that each reads as its
    // own object, not so much that the page becomes a scroll between islands.
    stack: { gap: spacing.lg },
    // The house resting card; `cardSurface` owns the box, this owns the
    // inside: 16 padding, 12 between title → content → caption.
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.md,
    },
    cardTitle: { ...typography.cardTitle, color: c.textPrimary },
    // The hero card's footer row: a hairline over the band, and the band's own
    // cell padding pushed up to the card's 12 step so the three figures sit
    // clear of the rule.
    bandFooter: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
      paddingTop: spacing.xs,
    },
    // The hero: the words in body Regular, the count at title Bold — the one
    // place the page's number outranks everything else, by size AND weight.
    // NOT display for the numeral: that is the app's celebration size, and a
    // theft count is not a celebration. The paragraph takes the TITLE's
    // leading throughout, so a sentence that wraps (most do, at 342pt) does
    // not set its second line 6pt tighter than its first.
    hero: {
      ...typography.body,
      lineHeight: typography.title.lineHeight,
      color: c.textPrimary,
    },
    heroNumber: { ...typography.title, color: c.textPrimary },
    // A section's one plain statement ("71% came back") — sectionTitle, so it
    // sits between the hero and the headings without a fourth scale.
    statement: { ...typography.sectionTitle, color: c.textPrimary },
    quiet: { ...typography.caption, color: c.textSecondary },
    radius: { gap: spacing.md },
    // The whole line is the 44pt target; the negative margin gives the extra
    // height back so the caption still sits in the 16pt rhythm — the same
    // trick `back` plays horizontally.
    radiusLine: {
      alignSelf: 'flex-start',
      minHeight: sizes.touchTarget,
      justifyContent: 'center',
      marginVertical: -(sizes.touchTarget - typography.caption.lineHeight) / 2,
    },
    radiusLinePressed: { opacity: opacity.pressed },
    radiusAction: {
      ...typography.caption,
      color: c.textPrimary,
      textDecorationLine: 'underline', // underline = tappable (DESIGN_SYSTEM)
    },
    rows: { gap: spacing.sm },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.md,
    },
    rowIndented: { paddingLeft: spacing.lg },
    rowLabel: { ...typography.body, color: c.textPrimary, flexShrink: 1 },
    rowLabelSecondary: { color: c.textSecondary },
    // ⚠️ ONLY for owner-typed makes and models ("bmw" → "Bmw"). The taken-from
    // and keys-taken labels are AUTHORED sentence case and must not pass it.
    rowLabelCapitalized: { textTransform: 'capitalize' },
    // The count is the information and the word beside it is its label, so
    // the emphasis runs value-first — the same way round as StatBand.
    rowValue: { ...typography.cardTitle, color: c.textPrimary },
    // No gutter of its own: it renders inside `content` (already 24) or
    // inside `skeletonOutside` for the pre-fetch waits. Shaped like the real
    // page — hero sentence, the radius line, the band, then the chart — at
    // the stack's own rhythm, so the figures land in place instead of
    // shifting the page under a reader (sizes.ts).
    skeletons: { gap: spacing.lg },
    skeletonOutside: { paddingHorizontal: spacing.xl },
    skeletonHead: {
      height: sizes.statsSkeletonHead,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonLine: {
      height: sizes.skeletonLine,
      width: '45%',
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonBlock: {
      height: sizes.statsSkeletonBlock,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
  });
