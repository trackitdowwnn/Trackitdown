/**
 * WHAT:  The sighting timeline's two faces, one visual language — the refined
 *        rail treatment: a 2px connector carrying meaning-differentiated
 *        nodes (12px ringed sage dots for sightings, a 16px one-time-pulse
 *        newest dot, 24px icon-in-circle ANCHORS fixing the arc's ends), the
 *        owner's quiet entry cards / the public's single lines off the SAME
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
 *        quiet-time-then-bold-place row hierarchy; ✓-marked status chips).
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

import { timeAgo } from '@/shared/lib/timeAgo';
import { colors, motion, radii, shadows, sizes, spacing, typography } from '@/shared/theme';
import { AppImage, Avatar } from '@/shared/ui';

import { contextSummary } from '../lib/contextLabels';
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
 *  owner cards = row margin + card padding + half the label line;
 *  public/tail lines = row padding + half the body line;
 *  anchors = row padding + half the cardTitle line. */
const CARD_NODE_Y = spacing.lg + spacing.lg + typography.caption.lineHeight / 2;
const LINE_NODE_Y = spacing.lg + typography.body.lineHeight / 2;
const ANCHOR_NODE_Y = spacing.lg + typography.cardTitle.lineHeight / 2;
const DASH = [sizes.timelineDash, sizes.timelineDash];
const RAIL_X = sizes.timelineRailColumn / 2;
/** Halo peak opacity for the one-time pulse (drawn emphasis, not a token). */
const PULSE_OPACITY = 0.35;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
            <Stop offset="0" stopColor={colors.border} stopOpacity="1" />
            <Stop offset="1" stopColor={colors.border} stopOpacity="0" />
          </LinearGradient>
          {/* …and re-emerge just above the origin node. */}
          <LinearGradient id="fadeIn" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.border} stopOpacity="0" />
            <Stop offset="1" stopColor={colors.border} stopOpacity="1" />
          </LinearGradient>
        </Defs>
        {!noTop ? (
          <Line
            x1={RAIL_X}
            y1={0}
            x2={RAIL_X}
            y2={gapTop}
            stroke={fadeTop ? 'url(#fadeIn)' : colors.border}
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
            stroke={fadeBottom ? 'url(#fadeOut)' : colors.border}
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
        color={tone === 'celebrate' ? colors.textOnPrimary : colors.textSecondary}
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
  // Hint is computed over ALL sightings even when the list is limited — the
  // preview must not claim a different journey than the full timeline.
  const hint = showHint ? movementHint(sightings) : null;
  const shown = limit
    ? [...sightings]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, limit)
    : sightings;
  const elidedCount = sightings.length - shown.length;
  const items = buildTimelineItems(shown, (s) => s.createdAt);
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
            color={colors.textSecondary}
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
  const when = `${timeAgo(sighting.createdAt)} · ${clockTime(sighting.createdAt)}`;
  // Honest location line (DOMAIN: shown honestly, never papered over). The
  // dashed incoming connector says the same thing decoratively; THIS label
  // is the accessible truth of it.
  const where = sighting.locationUnavailable
    ? 'Location couldn’t be captured'
    : (sighting.areaLabel ?? 'Captured location');
  const pills = contextSummary(sighting);
  const thumbPath = sighting.photos[0]?.path;
  const thumbUrl = thumbPath ? photoUrls[thumbPath] : undefined;

  return (
    <View style={styles.row}>
      <RailCell
        {...flags}
        node={newest ? sizes.timelineDotNewest : sizes.timelineDot}
        centerY={CARD_NODE_Y}
      >
        {newest ? <NewestPulse centerY={CARD_NODE_Y} /> : null}
        <SightingDot newest={newest} centerY={CARD_NODE_Y} />
      </RailCell>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Sighting ${position} of ${count}, ${where}, ${when}, by ${sighting.spotter.firstName}. Opens details.`}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        testID={`timeline-entry-${sighting.id}`}
      >
        {/* Text owns the card's width; the thumb TRAILS (design-refs) so the
            place never fights the photo for room. */}
        <View style={styles.cardTop}>
          <View style={styles.cardBody}>
            <View style={styles.cardTopLine}>
              <Text style={styles.entryWhen} numberOfLines={1}>
                {when}
              </Text>
              {sighting.status !== 'unverified' ? (
                <Text style={styles.statusTag}>
                  {sighting.status === 'credited' ? '✓ Credited' : '✓ Helpful'}
                </Text>
              ) : null}
            </View>
            <Text style={styles.entryWhere} numberOfLines={2}>
              {where}
            </Text>
          </View>
          {thumbUrl ? (
            <AppImage uri={thumbUrl} style={styles.cardThumb} />
          ) : (
            <View style={[styles.cardThumb, styles.cardThumbPending]} />
          )}
        </View>
        {pills.length > 0 ? (
          <View style={styles.pillRow}>
            {pills.map((pill) => (
              <View key={pill} style={styles.pill}>
                <Text style={styles.pillText}>{pill}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={styles.cardBottomLine}>
          <View style={styles.spotterRow}>
            <Avatar name={sighting.spotter.firstName} size="sm" />
            <Text style={styles.spotterText} numberOfLines={1}>
              {sighting.spotter.firstName}
              {sighting.spotter.sightingsHelpful > 0
                ? ` · ${sighting.spotter.sightingsHelpful} helpful`
                : ''}
            </Text>
          </View>
          <Feather name="chevron-right" size={sizes.iconSm} color={colors.textSecondary} />
        </View>
      </Pressable>
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
  const items = buildTimelineItems(data.entries, (entry) => entry.sightedAt);
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
            }, ${timeAgo(item.entry.sightedAt)}`}
          >
            <RailCell
              {...flags[index]}
              node={item.newest ? sizes.timelineDotNewest : sizes.timelineDot}
              centerY={CARD_NODE_Y}
            >
              {item.newest ? <NewestPulse centerY={CARD_NODE_Y} /> : null}
              <SightingDot newest={item.newest} centerY={CARD_NODE_Y} />
            </RailCell>
            {/* The owner face's card surface holding ONLY what the public
                payload carries — the faces read as one family, the fence
                (time + locality, nothing else) is unchanged (ADR-0008). */}
            <View style={styles.publicCard}>
              {/* Same line order as the owner card: quiet time above, the
                  place leading below — one visual language, two depths. */}
              <Text style={styles.publicWhen} numberOfLines={1}>
                {timeAgo(item.entry.sightedAt)} · {clockTime(item.entry.sightedAt)}
              </Text>
              <Text style={styles.publicWhere} numberOfLines={2}>
                {item.entry.locality ? `Sighted near ${item.entry.locality}` : 'Sighted'}
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

const styles = StyleSheet.create({
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  hint: {
    ...typography.label,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    // Rail → content offset: node column + this gap ≈ 44px (researched 40–60).
    gap: spacing.xxl,
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
    color: colors.textSecondary,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  tickRing: {
    position: 'absolute',
    alignSelf: 'center',
    padding: sizes.timelineDotRing,
    borderRadius: radii.full,
    backgroundColor: colors.background,
  },
  tick: {
    width: sizes.timelineTick,
    height: sizes.timelineTick,
    borderRadius: radii.full,
    backgroundColor: colors.border,
  },
  dotRing: {
    position: 'absolute',
    alignSelf: 'center',
    padding: sizes.timelineDotRing,
    borderRadius: radii.full,
    backgroundColor: colors.background,
  },
  dot: {
    borderRadius: radii.full,
    borderWidth: sizes.timelineDotStroke,
    borderColor: colors.success,
    backgroundColor: colors.surface,
  },
  dotNewest: {
    backgroundColor: colors.success,
  },
  pulseHalo: {
    position: 'absolute',
    alignSelf: 'center',
    width: sizes.timelineDotNewest * 2,
    height: sizes.timelineDotNewest * 2,
    borderRadius: radii.full,
    backgroundColor: colors.success,
  },
  anchorCircle: {
    position: 'absolute',
    alignSelf: 'center',
    width: sizes.timelineAnchor,
    height: sizes.timelineAnchor,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorCelebrate: {
    backgroundColor: colors.success,
  },
  anchorBody: {
    flex: 1,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  anchorLabel: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  anchorSublabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // Owner entries: quiet cards off the rail (the shared surface recipe).
  card: {
    flex: 1,
    gap: spacing.sm,
    marginVertical: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  cardPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardThumb: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: radii.md,
  },
  cardThumbPending: {
    backgroundColor: colors.surfaceSubtle,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  entryWhen: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  statusTag: {
    ...typography.caption,
    color: colors.primary,
  },
  entryWhere: {
    // The card's headline (design-refs: quiet time above, the place leading)
    // — label tier: present without shouting, and two lines may wrap.
    ...typography.label,
    color: colors.textPrimary,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    minHeight: sizes.pillHeight,
    justifyContent: 'center',
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
  },
  pillText: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  spotterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  spotterText: {
    ...typography.caption,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  // Public entries: the same quiet card surface, holding only the fenced
  // payload — locality leading, time beneath.
  publicCard: {
    flex: 1,
    gap: spacing.xs,
    marginVertical: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.soft,
  },
  publicWhere: {
    ...typography.label,
    color: colors.textPrimary,
  },
  publicWhen: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  tail: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingVertical: spacing.lg,
  },
});
