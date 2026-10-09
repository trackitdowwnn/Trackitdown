/**
 * WHAT:  The sighting timeline's two faces, one visual language — the refined
 *        rail treatment: a 2px connector carrying meaning-differentiated
 *        nodes (12px ringed sage dots for sightings, a 16px one-time-pulse
 *        newest dot, 24px icon-in-circle ANCHORS fixing the arc's ends), the
 *        owner's photo-first cards (SightingEntryCard: photo, "Seen near …",
 *        when, and "Needs your answer" until the owner decides — the detail
 *        lives on the sighting page since 2026-10-09) / the public's flat
 *        time-and-place cards off the SAME
 *        rail, day-group headers, and the movement hint as the header's one
 *        insight line. NEWEST-FIRST: terminal (when the arc has ended) at the
 *        top, then sightings newest-down, the ORIGIN — the theft — at the
 *        rail's foot.
 * WHY:   The rail now tells the whole arc: theft → sightings → outcome — the
 *        story must read instantly without explanation. Rendering is PLANNED:
 *        each face assembles its rows, then railFlags() styles every
 *        CONNECTOR as one unit across the rows that share it (a connector =
 *        the row above's lower half + any headers between + the row below's
 *        upper half). // SAFETY: the depth difference between faces is THE
 *        rule (ADR-0008). The public face renders ONLY what
 *        PublicSightingEntry can carry — time + locality — and the ANCHORS
 *        render from post data the viewer's post-detail payload already
 *        holds (coarsened server-side for non-owners): they add NOTHING to
 *        any payload. The movement hint stays owner-only by construction.
 *        SEGMENT SEMANTICS (deliberate, not an inconsistency): the whole
 *        connector ARRIVING at a location_unavailable sighting is DASHED —
 *        dashed = uncertainty, used honestly. Owner face only (the public
 *        face never carries location state); the uncertainty is ALSO in the
 *        entry's label ("Location couldn't be captured"), never conveyed by
 *        line style alone (a11y). The connector into the ORIGIN fades — the
 *        rail dissolves across the elapsed gap between report and sightings.
 * LINKS: src/features/sightings/lib/timelineModel.ts (grouping/anchors/hint);
 *        src/features/sightings/types.ts (the two entry shapes);
 *        docs/decisions/ADR-0008-public-sighting-entries.md;
 *        docs/DESIGN_SYSTEM.md (timeline geometry tokens; sage-node sanction);
 *        docs/design-refs/timelime/ (the reference set this treatment draws
 *        on: day-groups as RAIL STOPS so the rail reads as a time axis;
 *        the place leading with the time quiet beneath; a status marker on
 *        each owner card);
 *        src/features/sightings/components/SightingEntryCard.tsx (the
 *        owner's card).
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import Svg, { Defs, Line, LinearGradient, Stop } from 'react-native-svg';

import { formatClock } from '@/shared/lib';
import { timeAgo } from '@/shared/lib/timeAgo';
import {
  cardSurface,
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import { useNow } from '@/shared/hooks';

import { sightingSeenAt } from '../lib/sightingVerdict';
import { SightingEntryCard, useEntryCardFirstLineY } from './SightingEntryCard';
import {
  buildTimelineItems,
  earlierCountLabel,
  movementHint,
  originAnchor,
  terminalAnchor,
  type TimelineAnchorSource,
} from '../lib/timelineModel';
import type { OwnerSighting, PublicSightingEntries } from '../types';

/** Node centres sit on their row's FIRST TEXT LINE centre (optical alignment):
 *  owner cards = useEntryCardFirstLineY() (SightingEntryCard owns its layout);
 *  public cards = row margin + card padding + half the place line, scaled
 *  with the text (computed in PublicSightingTimeline);
 *  tail lines = row padding + half the body line;
 *  anchors = row padding + half the cardTitle line. */
const LINE_NODE_Y = spacing.lg + typography.body.lineHeight / 2;
const ANCHOR_NODE_Y = spacing.lg + typography.cardTitle.lineHeight / 2;
const DASH = [sizes.timelineDash, sizes.timelineDash];
const RAIL_X = sizes.timelineRailColumn / 2;
/** Halo peak opacity for the one-time pulse (drawn emphasis, not a token). */
const PULSE_OPACITY = 0.35;
/** How often the day stops re-check what today is. */
const CLOCK_TICK_MS = 60_000;

/** "2h ago · 14:32" for a public card — the shared clock format, as on the
 *  owner card. An unparseable time costs the clock, never the card. */
function publicWhen(iso: string, now: Date): string {
  const ago = timeAgo(iso, now);
  try {
    return `${ago} · ${formatClock(iso)}`;
  } catch {
    return ago;
  }
}

// --- The rail plan -----------------------------------------------------------------

/** How one row's slice of the rail is drawn. Flags style whole CONNECTORS:
 *  railFlags() marks both halves (and any header rows between) together. */
export interface RailFlags {
  noTop?: boolean;
  noBottom?: boolean;
  dashedTop?: boolean;
  dashedBottom?: boolean;
  fadeTop?: boolean;
  fadeBottom?: boolean;
}

interface PlanRowBase {
  /** Rows without a node (day/elided) carry the rail straight through. */
  kind: 'terminal' | 'day' | 'entry' | 'elided' | 'origin';
  /** The uncertainty semantic: true for a location_unavailable sighting. */
  uncertain?: boolean;
}

/**
 * Compute each row's rail styling so each connector reads as ONE unit:
 * - the connector arriving at an uncertain entry is dashed for its whole run
 *   (the row above's bottom half, headers between, the entry's top half);
 * - the connector arriving at the origin fades for its whole run;
 * - the plan's open ends draw nothing.
 */
export function railFlags(rows: PlanRowBase[]): RailFlags[] {
  const flags: RailFlags[] = rows.map(() => ({}));
  if (rows.length === 0) return flags;
  flags[0].noTop = true;
  flags[rows.length - 1].noBottom = true;

  const styleConnectorInto = (
    target: number,
    mark: (f: RailFlags, half: 'top' | 'bottom' | 'through') => void,
  ) => {
    mark(flags[target], 'top');
    for (let above = target - 1; above >= 0; above -= 1) {
      const row = rows[above];
      if (row.kind === 'day' || row.kind === 'elided') {
        mark(flags[above], 'through');
        continue;
      }
      mark(flags[above], 'bottom');
      break;
    }
  };

  rows.forEach((row, index) => {
    if (row.kind === 'entry' && row.uncertain && index > 0) {
      styleConnectorInto(index, (f, half) => {
        if (half === 'top') f.dashedTop = true;
        else if (half === 'bottom') f.dashedBottom = true;
        else f.dashedTop = f.dashedBottom = true;
      });
    }
    if (row.kind === 'origin' && index > 0) {
      styleConnectorInto(index, (f, half) => {
        if (half === 'top') f.fadeTop = true;
        else if (half === 'bottom') f.fadeBottom = true;
        else f.fadeTop = f.fadeBottom = true;
      });
    }
  });
  return flags;
}

// --- The rail cell -----------------------------------------------------------------

interface RailCellProps extends RailFlags {
  /** Diameter of the node the lines must part around; 0 = rail runs through. */
  node?: number;
  /** Vertical centre of the node — the row type's first-line centre. */
  centerY?: number;
  children?: React.ReactNode;
}

/** One row's slice of the rail. Decorative by declaration — the meaning
 *  lives in the entries' labels. */
function RailCell({
  node = 0,
  centerY = LINE_NODE_Y,
  noTop,
  noBottom,
  dashedTop,
  dashedBottom,
  fadeTop,
  fadeBottom,
  children,
}: RailCellProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const ring = node > 0 ? sizes.timelineDotRing : 0;
  const gapTop = centerY - node / 2 - ring;
  const gapBottom = centerY + node / 2 + ring;
  return (
    <View
      style={styles.railCell}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Svg
        width={sizes.timelineRailColumn}
        height="100%"
        style={styles.railSvg}
        pointerEvents="none"
      >
        <Defs>
          {/* Fade INTO the origin: dissolve downward… */}
          <LinearGradient id="fadeOut" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.border} stopOpacity="1" />
            <Stop offset="1" stopColor={palette.border} stopOpacity="0" />
          </LinearGradient>
          {/* …and re-emerge just above the origin node. */}
          <LinearGradient id="fadeIn" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.border} stopOpacity="0" />
            <Stop offset="1" stopColor={palette.border} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        {!noTop ? (
          <Line
            x1={RAIL_X}
            y1={0}
            x2={RAIL_X}
            y2={gapTop}
            stroke={fadeTop ? 'url(#fadeIn)' : palette.border}
            strokeWidth={sizes.timelineRailStroke}
            strokeDasharray={dashedTop ? DASH : undefined}
          />
        ) : null}
        {!noBottom ? (
          <Line
            x1={RAIL_X}
            y1={gapBottom}
            x2={RAIL_X}
            y2="100%"
            stroke={fadeBottom ? 'url(#fadeOut)' : palette.border}
            strokeWidth={sizes.timelineRailStroke}
            strokeDasharray={dashedBottom ? DASH : undefined}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** A sighting node: sage dot in a page-colour ring so it sits crisply ON the
 *  rail (sage on the timeline is the DESIGN_SYSTEM-sanctioned exception —
 *  dots and the recovered-terminal fill only). */
function SightingDot({ newest, centerY }: { newest: boolean; centerY: number }) {
  const styles = useThemedStyles(makeStyles);
  const size = newest ? sizes.timelineDotNewest : sizes.timelineDot;
  return (
    <View style={[styles.dotRing, { top: centerY - size / 2 - sizes.timelineDotRing }]}>
      <View
        style={[styles.dot, { width: size, height: size }, newest ? styles.dotNewest : null]}
      />
    </View>
  );
}

/** The newest dot's pulse: a halo that swells and fades ONCE PER MOUNT (each
 *  surface introduces its newest sighting once; it never loops within a
 *  mount). Reduced motion → nothing — the newest dot's size and fill are the
 *  static emphasis. Invisible to screen readers by construction (inside the
 *  decorative rail cell, no a11y props). */
function NewestPulse({ centerY }: { centerY: number }) {
  const styles = useThemedStyles(makeStyles);
  const reduce = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    progress.value = withDelay(motion.slow, withTiming(1, { duration: motion.timelinePulse }));
  }, [progress, reduce]);
  const halo = useAnimatedStyle(() => ({
    opacity: PULSE_OPACITY * (1 - progress.value),
    transform: [{ scale: 1 + progress.value }],
  }));
  if (reduce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.pulseHalo, { top: centerY - sizes.timelineDotNewest }, halo]}
    />
  );
}

/** A 24px icon-in-circle anchor node. */
function AnchorNode({
  icon,
  tone,
}: {
  icon: keyof typeof Feather.glyphMap;
  tone: 'origin' | 'celebrate' | 'quiet';
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <View
      style={[
        styles.anchorCircle,
        { top: ANCHOR_NODE_Y - sizes.timelineAnchor / 2 },
        tone === 'celebrate' && styles.anchorCelebrate,
      ]}
    >
      <Feather
        name={icon}
        size={sizes.iconSm}
        color={tone === 'celebrate' ? palette.textOnPrimary : palette.textSecondary}
      />
    </View>
  );
}

/** Node centre for a day stop: its caption line's centre. */
const TICK_NODE_Y = spacing.lg + typography.caption.lineHeight / 2;

/** A day-group STOP on the rail (design-refs: dates live ON the axis, so the
 *  rail itself reads as time). The tick is chronology, not evidence — border
 *  ink, never sage. A connector's dash/fade semantics pass straight through. */
function DayHeader({ label, flags }: { label: string; flags: RailFlags }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <RailCell {...flags} node={sizes.timelineTick} centerY={TICK_NODE_Y}>
        <View style={[styles.tickRing, { top: TICK_NODE_Y - sizes.timelineTick / 2 - sizes.timelineDotRing }]}>
          <View style={styles.tick} />
        </View>
      </RailCell>
      <Text style={styles.dayHeader} accessibilityRole="header">
        {label}
      </Text>
    </View>
  );
}

// --- Anchor + elided rows (shared by both faces) -------------------------------------

function OriginRow({ source, flags }: { source: TimelineAnchorSource; flags: RailFlags }) {
  const styles = useThemedStyles(makeStyles);
  const origin = originAnchor(source);
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${origin.label}, ${origin.sublabel}`}
    >
      <RailCell {...flags} node={sizes.timelineAnchor} centerY={ANCHOR_NODE_Y}>
        <AnchorNode icon="flag" tone="origin" />
      </RailCell>
      <View style={styles.anchorBody}>
        <Text style={styles.anchorLabel}>{origin.label}</Text>
        <Text style={styles.anchorSublabel}>{origin.sublabel}</Text>
      </View>
    </View>
  );
}

function TerminalRow({ source, flags }: { source: TimelineAnchorSource; flags: RailFlags }) {
  const styles = useThemedStyles(makeStyles);
  const terminal = terminalAnchor(source.status);
  if (!terminal) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={terminal.label}>
      <RailCell {...flags} node={sizes.timelineAnchor} centerY={ANCHOR_NODE_Y}>
        <AnchorNode
          icon={terminal.tone === 'celebrate' ? 'check' : 'archive'}
          tone={terminal.tone}
        />
      </RailCell>
      <View style={styles.anchorBody}>
        {/* Celebration is carried by the sanctioned sage CIRCLE + the emoji —
            the label stays primary ink (sage text is outside the sanction). */}
        <Text style={styles.anchorLabel}>{terminal.label}</Text>
      </View>
    </View>
  );
}

/** The owner preview's honest history line: what the cap cut, ON the rail so
 *  the origin never claims the theft led straight to the oldest shown card. */
function ElidedRow({ count, flags }: { count: number; flags: RailFlags }) {
  const styles = useThemedStyles(makeStyles);
  const label = earlierCountLabel(count);
  if (!label) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      <RailCell {...flags} />
      <Text style={styles.tail}>{label}</Text>
    </View>
  );
}

// --- Owner face ---------------------------------------------------------------------

export interface OwnerSightingTimelineProps {
  sightings: OwnerSighting[];
  /** Signed URLs keyed by photo path (usePostSightings supplies them). */
  photoUrls: Record<string, string>;
  /** Show only the newest N entries (the detail page's preview). Omit for
   *  the full timeline screen. */
  limit?: number;
  onEntryPress: (sighting: OwnerSighting) => void;
  /** Suppress the movement-hint header (the preview shows it; a caller that
   *  renders its own header may not want it twice). Default true. */
  showHint?: boolean;
  /** Post data for the arc's anchor nodes; omitted (fetch failure) → the
   *  timeline renders sightings-only, gracefully anchor-less. */
  anchors?: TimelineAnchorSource;
}

export function OwnerSightingTimeline({
  sightings,
  photoUrls,
  limit,
  onEntryPress,
  showHint = true,
  anchors,
}: OwnerSightingTimelineProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // Hint is computed over ALL sightings even when the list is limited — the
  // preview must not claim a different journey than the full timeline.
  // The hint (like the trail map) walks the sightings in the order the
  // SERVER received them — a path through space, where server order is the
  // trusted one; the list below orders by when each car was seen. Within
  // sightingSeenAt's one-hour clamp the two rarely differ.
  const hint = showHint ? movementHint(sightings) : null;
  // ONE time for the order, the day stops and the cards: when the car was
  // seen (sightingSeenAt — clamped to the server's clock). Grouping by when
  // it was SENT put a card reading "Yesterday" under a "Today" stop.
  const shown = limit
    ? [...sightings]
        .sort(
          (a, b) =>
            new Date(sightingSeenAt(b)).getTime() - new Date(sightingSeenAt(a)).getTime(),
        )
        .slice(0, limit)
    : sightings;
  const elidedCount = sightings.length - shown.length;
  // A held clock, not buildTimelineItems' default `new Date()`: the React
  // Compiler would freeze that, and "Today" would outlive midnight while the
  // cards beside it (useTimeAgo) moved on.
  const now = useNow(CLOCK_TICK_MS);
  const items = buildTimelineItems(shown, sightingSeenAt, now);
  const hasTerminal = anchors ? terminalAnchor(anchors.status) !== null : false;

  // The render plan, top-down; railFlags styles whole connectors across it.
  const plan: (PlanRowBase & { item?: (typeof items)[number] })[] = [
    ...(hasTerminal && anchors ? [{ kind: 'terminal' as const }] : []),
    ...items.map((item) => ({
      kind: item.kind === 'day' ? ('day' as const) : ('entry' as const),
      uncertain: item.kind === 'entry' && item.entry.locationUnavailable,
      item,
    })),
    ...(anchors && elidedCount > 0 ? [{ kind: 'elided' as const }] : []),
    ...(anchors ? [{ kind: 'origin' as const }] : []),
  ];
  const flags = railFlags(plan);

  let position = 0;
  return (
    <View testID="owner-sighting-timeline">
      {hint ? (
        <View style={styles.hintRow} testID="movement-hint">
          <Feather
            name="navigation"
            size={sizes.iconSm}
            color={palette.textSecondary}
            importantForAccessibility="no"
          />
          <Text style={styles.hint}>{hint}</Text>
        </View>
      ) : null}
      {plan.map((row, index) => {
        if (row.kind === 'terminal' && anchors)
          return <TerminalRow key="terminal" source={anchors} flags={flags[index]} />;
        if (row.kind === 'elided')
          return <ElidedRow key="elided" count={elidedCount} flags={flags[index]} />;
        if (row.kind === 'origin' && anchors)
          return <OriginRow key="origin" source={anchors} flags={flags[index]} />;
        const item = row.item;
        if (!item) return null;
        if (item.kind === 'day')
          return <DayHeader key={item.id} label={item.label} flags={flags[index]} />;
        position += 1;
        return (
          <Animated.View
            key={item.entry.id}
            entering={FadeInDown.duration(motion.standard)
              .delay(Math.min(index, 6) * motion.listStagger)
              .reduceMotion(ReduceMotion.System)}
            layout={LinearTransition.duration(motion.standard).reduceMotion(ReduceMotion.System)}
          >
            <OwnerEntryRow
              sighting={item.entry}
              newest={item.newest}
              position={position}
              count={sightings.length}
              photoUrls={photoUrls}
              flags={flags[index]}
              onPress={() => onEntryPress(item.entry)}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

/** A sighting on the owner's rail: its dot, then the photo-first card
 *  (SightingEntryCard — the card's contents and why live there). */
function OwnerEntryRow({
  sighting,
  newest,
  position,
  count,
  photoUrls,
  flags,
  onPress,
}: {
  sighting: OwnerSighting;
  newest: boolean;
  position: number;
  count: number;
  photoUrls: Record<string, string>;
  flags: RailFlags;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const firstLineY = useEntryCardFirstLineY();
  return (
    <View style={styles.row}>
      <RailCell
        {...flags}
        node={newest ? sizes.timelineDotNewest : sizes.timelineDot}
        centerY={firstLineY}
      >
        {newest ? <NewestPulse centerY={firstLineY} /> : null}
        <SightingDot newest={newest} centerY={firstLineY} />
      </RailCell>
      <SightingEntryCard
        sighting={sighting}
        photoUrls={photoUrls}
        position={position}
        count={count}
        onPress={onPress}
      />
    </View>
  );
}

// --- Public face --------------------------------------------------------------------

export interface PublicSightingTimelineProps {
  data: PublicSightingEntries;
  /** Post data for the anchors — already in the viewer's post payload,
   *  coarsened for their face server-side. Adds NOTHING (ADR-0008). */
  anchors?: TimelineAnchorSource;
}

/** // SAFETY: single lines from the fenced public shape — nothing here is
 *  tappable, and nothing beyond time + locality can render because nothing
 *  beyond time + locality ARRIVES (the type is the fence). The anchors are
 *  post data the page already shows. */
export function PublicSightingTimeline({ data, anchors }: PublicSightingTimelineProps) {
  const styles = useThemedStyles(makeStyles);
  // A held clock for the day stops and each card's age — see
  // OwnerSightingTimeline.
  const now = useNow(CLOCK_TICK_MS);
  // The dot on the place line's centre at every text size (the owner card's
  // useEntryCardFirstLineY rule).
  const { fontScale } = useWindowDimensions();
  const cardNodeY = spacing.lg + spacing.lg + (typography.label.lineHeight * (fontScale ?? 1)) / 2;
  const items = buildTimelineItems(data.entries, (entry) => entry.sightedAt, now);
  const tail = earlierCountLabel(data.earlierCount);
  const entryCount = data.entries.length;
  const hasTerminal = anchors ? terminalAnchor(anchors.status) !== null : false;

  if (data.entries.length === 0) {
    // The section simply doesn't render publicly (spec): no empty state —
    // and therefore no anchors either (an absent section signals nothing).
    return null;
  }

  const plan: (PlanRowBase & { item?: (typeof items)[number] })[] = [
    ...(hasTerminal && anchors ? [{ kind: 'terminal' as const }] : []),
    ...items.map((item) => ({
      kind: item.kind === 'day' ? ('day' as const) : ('entry' as const),
      item,
    })),
    ...(anchors && tail ? [{ kind: 'elided' as const }] : []),
    ...(anchors ? [{ kind: 'origin' as const }] : []),
  ];
  const flags = railFlags(plan);

  let position = 0;
  return (
    <View testID="public-sighting-timeline">
      {plan.map((row, index) => {
        if (row.kind === 'terminal' && anchors)
          return <TerminalRow key="terminal" source={anchors} flags={flags[index]} />;
        if (row.kind === 'elided')
          return <ElidedRow key="elided" count={data.earlierCount} flags={flags[index]} />;
        if (row.kind === 'origin' && anchors)
          return <OriginRow key="origin" source={anchors} flags={flags[index]} />;
        const item = row.item;
        if (!item) return null;
        if (item.kind === 'day')
          return <DayHeader key={item.id} label={item.label} flags={flags[index]} />;
        position += 1;
        return (
          <Animated.View
            key={`${item.entry.sightedAt}-${index}`}
            entering={FadeInDown.duration(motion.standard)
              .delay(Math.min(index, 6) * motion.listStagger)
              .reduceMotion(ReduceMotion.System)}
            style={styles.row}
            accessible
            accessibilityLabel={`Sighting ${position} of ${entryCount}, ${
              item.entry.locality ? `near ${item.entry.locality}` : 'location withheld'
            }, ${timeAgo(item.entry.sightedAt, now)}`}
          >
            <RailCell
              {...flags[index]}
              node={item.newest ? sizes.timelineDotNewest : sizes.timelineDot}
              centerY={cardNodeY}
            >
              {item.newest ? <NewestPulse centerY={cardNodeY} /> : null}
              <SightingDot newest={item.newest} centerY={cardNodeY} />
            </RailCell>
            {/* The owner face's card surface holding ONLY what the public
                payload carries — the faces read as one family, the fence
                (time + locality, nothing else) is unchanged (ADR-0008). */}
            <View style={styles.publicCard}>
              {/* Same line order as the owner card: the place leading, the
                  quiet time beneath — one visual language, two depths. */}
              <Text style={styles.publicWhere} numberOfLines={2}>
                {item.entry.locality ? `Sighted near ${item.entry.locality}` : 'Sighted'}
              </Text>
              <Text style={styles.publicWhen} numberOfLines={1}>
                {publicWhen(item.entry.sightedAt, now)}
              </Text>
            </View>
          </Animated.View>
        );
      })}
      {/* Anchor-less fallback keeps the honest tail as a plain line. */}
      {!anchors && tail ? (
        <View style={styles.row}>
          <RailCell noBottom />
          <Text style={styles.tail}>{tail}</Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  hint: {
    ...typography.label,
    color: c.textPrimary,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    // Rail → content offset: node column + this gap = 40px, the low end of
    // the researched 40–60 — the photo-first cards need the width.
    gap: spacing.lg,
  },
  railCell: {
    width: sizes.timelineRailColumn,
    alignSelf: 'stretch',
  },
  railSvg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  dayHeader: {
    ...typography.caption,
    color: c.textSecondary,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  tickRing: {
    position: 'absolute',
    alignSelf: 'center',
    padding: sizes.timelineDotRing,
    borderRadius: radii.full,
    backgroundColor: c.background,
  },
  tick: {
    width: sizes.timelineTick,
    height: sizes.timelineTick,
    borderRadius: radii.full,
    backgroundColor: c.border,
  },
  dotRing: {
    position: 'absolute',
    alignSelf: 'center',
    padding: sizes.timelineDotRing,
    borderRadius: radii.full,
    backgroundColor: c.background,
  },
  dot: {
    borderRadius: radii.full,
    borderWidth: sizes.timelineDotStroke,
    borderColor: c.success,
    backgroundColor: c.surface,
  },
  dotNewest: {
    backgroundColor: c.success,
  },
  pulseHalo: {
    position: 'absolute',
    alignSelf: 'center',
    width: sizes.timelineDotNewest * 2,
    height: sizes.timelineDotNewest * 2,
    borderRadius: radii.full,
    backgroundColor: c.success,
  },
  anchorCircle: {
    position: 'absolute',
    alignSelf: 'center',
    width: sizes.timelineAnchor,
    height: sizes.timelineAnchor,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorCelebrate: {
    backgroundColor: c.success,
  },
  anchorBody: {
    flex: 1,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  anchorLabel: {
    ...typography.cardTitle,
    color: c.textPrimary,
  },
  anchorSublabel: {
    ...typography.caption,
    color: c.textSecondary,
  },
  // Public entries: the owner card's flat surface (cardSurface — a resting
  // card is a hairline, not a shadow), holding only the fenced payload.
  publicCard: {
    ...cardSurface(c),
    flex: 1,
    gap: spacing.xs,
    marginVertical: spacing.lg,
    padding: spacing.lg,
  },
  publicWhere: {
    ...typography.label,
    color: c.textPrimary,
  },
  publicWhen: {
    ...typography.caption,
    color: c.textSecondary,
  },
  tail: {
    ...typography.caption,
    color: c.textSecondary,
    paddingVertical: spacing.lg,
  },
});
