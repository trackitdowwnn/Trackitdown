/**
 * WHAT:  ReportCard — one filed sighting on `My reports`: the car as a colour
 *        tile, what it was, where and when it was reported, and what the owner
 *        decided. Plus `ReportCardSkeleton`, its loading twin.
 * WHY:   ⚠️ REDESIGNED 2026-08-27 (owner request, Airbnb language). It was a
 *        local `RecordRow` inside the screen: three lines of text in a
 *        `surfaceSubtle` box with no border, no picture and no status mark.
 *        The owner's three complaints were that the cards were plain, that the
 *        status was not clear, and that you could not tell which car a report
 *        was about — and the third is what the colour tile answers.
 *
 *        The analogue is Airbnb's Trips list rather than a property card: a
 *        record YOU created, with a title, a meta line and an OUTCOME. Their
 *        register sells anticipation; ours has to carry "the owner said no"
 *        without it landing as a failure, so the outcome is stated and never
 *        coloured against the spotter.
 *
 *        ⚠️ THE GOOD VERDICT WAS INVISIBLE, and that is the real bug this pass
 *        fixes. `rowVerdictGood` set `c.primary` — the same near-black as the
 *        card title — so "Owner found this helpful" differed from "Not a match"
 *        by nothing a reader could name. The emphasis is now a marker beside
 *        `textPrimary` ink, against a `textSecondary` label. The WORD is always
 *        there, so the marker is never the only signal (DESIGN_SYSTEM: never
 *        encode by colour alone).
 *
 *        ⚠️ THE SKELETON LIVES HERE, NOT ON THE SCREEN, and that is the fix for
 *        a bug the screen's own history records. Hand-copied geometry drifts:
 *        the previous skeleton was a `height: 96` literal against a 104pt row,
 *        and the version that replaced it hard-coded the 104 — correct at font
 *        scale 1.0 and wrong from ~1.10, because the card's TEXT scales and a
 *        fixed-height View does not. Sharing the styles and the `stacked` flag
 *        is the only version of this that cannot drift.
 *
 *        ⚠️ NOT PRESSABLE, deliberately. The card has nowhere to go: the
 *        dispute route is reached from a push, and the post itself is not
 *        something this screen is allowed to link to. A card that looks
 *        tappable and is not would be worse than a flat one.
 * LINKS: ./CarColourTile.tsx (the leading visual, and why it exists);
 *        ../screens/MySightingsScreen.tsx (the only consumer);
 *        ../api/sightingApi.ts (MySightingRecordEntry — read its PRIVACY note
 *          before widening what this row shows).
 */

import { Check } from 'lucide-react-native';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import {
  listRowStackFontScale,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

import type { MySightingRecordEntry } from '../api/sightingApi';

import { CarColourTile } from './CarColourTile';

/**
 * How each verdict reads to THE PERSON WHO REPORTED IT.
 *
 * ⚠️ NOT EXPORTED, deliberately. `not_mine` → "Not a match" may only ever be
 * rendered on `My reports`, to the spotter themselves — no stranger-facing
 * surface may show a rejection or derive an accuracy figure from one. Keeping
 * the map module-private means the neighbouring public-facing components
 * (PostSightingsSection, SightingTimeline) cannot reach it by accident.
 *
 * `not_mine` is the one that matters. It is the absence of a confirmation, not
 * a failure: the owner looked and it was a different car. "Not a match" says
 * that about the CAR. Anything framing it as the spotter being wrong — "not
 * confirmed", "rejected", a red anything — would be both unkind and untrue, and
 * it is the reason this screen exists rather than a status column somewhere
 * public.
 *
 * `unverified` is deliberately "Waiting on the owner", not "Unverified": the
 * spotter has done everything asked of them and the ball is elsewhere. It takes
 * the `pending` marker rather than `not_mine`'s neutral one, because the two
 * are opposite states that used to look identical: one is still live and the
 * other is closed, and "has anyone looked yet" is the thing a spotter opens
 * this screen to scan for. Amber as a DOT ONLY, never as ink, is what
 * DESIGN_SYSTEM reserves for pending — it is not a warning about them.
 */
const VERDICT: Record<
  MySightingRecordEntry['status'],
  { label: string; tone: 'good' | 'plain' | 'pending'; celebrated?: true }
> = {
  unverified: { label: 'Waiting on the owner', tone: 'pending' },
  helpful: { label: 'Owner found this helpful', tone: 'good' },
  not_mine: { label: 'Not a match', tone: 'plain' },
  // The one moment this screen ever has to deliver, so it gets the only mark on
  // the card that is not a dot.
  credited: { label: 'Credited — this one led to the recovery', tone: 'good', celebrated: true },
};

/**
 * The car as a sentence. Either half may be '' on a sparse post (the RPC
 * coalesces rather than nulls), and both blank is a real state — "a car" is the
 * honest sentence there, and the same fallback the confirmation push uses.
 *
 * Module-private for the same reason as VERDICT: nothing off this screen should
 * be describing another owner's car.
 */
function describeReportedCar(car: MySightingRecordEntry['car']): string {
  return [car.colour, car.make].filter(Boolean).join(' ') || 'a car';
}

export interface ReportCardProps {
  entry: MySightingRecordEntry;
}

export function ReportCard({ entry }: ReportCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const stacked = useStackedRow();
  const markerOffset = useMarkerOffset();

  const reported = useTimeAgo(entry.createdAt);
  const ruled = useTimeAgo(entry.reviewedAt ?? entry.createdAt);
  const verdict = VERDICT[entry.status];
  const car = describeReportedCar(entry.car);

  const when = entry.areaLabel ? `${entry.areaLabel} · ${reported}` : reported;
  // WHEN they ruled, only once they have. NULL reviewed_at means nobody has
  // looked, which must never be dressed up as a decision.
  const ruledSuffix = entry.reviewedAt ? ` · ${ruled}` : '';

  return (
    <View
      style={[styles.card, stacked && styles.cardStacked]}
      testID={`my-sighting-${entry.id}`}
      // ⚠️ ONE UTTERANCE, NOT THREE. Ungrouped, a screen reader read the car,
      // then a ·-joined fragment, then a verdict, as three unrelated strings
      // with no way to tell which report the verdict belonged to. Grouping is
      // safe here only because the card holds no controls — see the header for
      // why it is not pressable, and AlertCard for what grouping costs when it
      // is.
      accessible
      accessibilityLabel={`${car}, reported ${
        entry.areaLabel ? `in ${entry.areaLabel} ` : ''
      }${reported}. ${verdict.label}${entry.reviewedAt ? `, ${ruled}` : ''}`}
    >
      <CarColourTile colour={entry.car.colour} testID={`my-sighting-tile-${entry.id}`} />

      <View style={[styles.main, stacked && styles.mainStacked]}>
        <Text style={styles.car} numberOfLines={1}>
          {car}
        </Text>
        <Text style={styles.when} numberOfLines={1}>
          {when}
        </Text>

        {/* ⚠️ A BARE MARKER AND LABEL, NOT StatusPill — which was the obvious
            reuse and is wrong on this surface. StatusPill's badge fills with
            `c.surface` (StatusBadge.tsx), which is exactly this card's colour,
            so it would render as a dot and a label anyway, looking acceptable
            by accident rather than by design. Same conclusion AlertCard reached
            for its "Paused". */}
        <View style={styles.verdict}>
          {verdict.celebrated ? (
            <Check
              size={sizes.iconSm}
              color={palette.success}
              style={{ marginTop: markerOffset(sizes.iconSm) }}
            />
          ) : (
            <View
              style={[
                styles.dot,
                styles[`dot_${verdict.tone}`],
                { marginTop: markerOffset(sizes.progressDot) },
              ]}
              testID={`my-sighting-dot-${entry.id}`}
            />
          )}
          <Text
            style={[styles.verdictLabel, verdict.tone === 'good' && styles.verdictLabelGood]}
          >
            {verdict.label}
            {/* Its own Text so the emphasis stays on the OUTCOME. Inside the
                parent it inherited `textPrimary` at Medium on a good row —
                metadata rendered exactly as loudly as the verdict it dates. */}
            {ruledSuffix ? <Text style={styles.verdictWhen}>{ruledSuffix}</Text> : null}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The card's shape while the record loads — the SAME box, tile and text column,
 * so nothing moves when the reports arrive. See the header for why it is not a
 * fixed height.
 */
export function ReportCardSkeleton() {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const stacked = useStackedRow();
  const scale = fontScale ?? 1;

  return (
    <View style={[styles.card, stacked && styles.cardStacked]} testID="report-card-skeleton">
      <View style={styles.skeletonTile} />
      <View style={[styles.main, stacked && styles.mainStacked]}>
        {/* ⚠️ THE REAL LINE HEIGHTS, SCALED — not `sizes.skeletonLine`, which is
            a fixed 12 and is right for a skeleton that only has to look like a
            line. This one's contract is HEIGHT PARITY with the card beside it,
            and Text grows with the OS font setting while a View does not: at
            iOS's second Larger Text step the card's column already outgrows the
            72pt tile and a fixed skeleton stops matching. */}
        <View style={[styles.skeletonLine, { height: typography.cardTitle.lineHeight * scale }]} />
        <View
          style={[
            styles.skeletonLine,
            styles.skeletonLineNarrow,
            { height: typography.caption.lineHeight * scale },
          ]}
        />
        <View
          style={[
            styles.skeletonLine,
            styles.skeletonLineVerdict,
            { height: typography.label.lineHeight * scale },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * Past the threshold the tile takes its own row, so the verdict — the longest
 * string on the card at 39 characters, or ~48 once a "· 3d ago" is on it — gets
 * the card's full width instead of the ~200pt left beside a 72pt tile.
 */
function useStackedRow(): boolean {
  const { fontScale } = useWindowDimensions();
  return (fontScale ?? 1) > listRowStackFontScale;
}

/**
 * How far to push a marker down so it sits on the optical centre of the verdict
 * label's FIRST line, now that the row aligns to the top rather than the middle.
 *
 * ⚠️ A HOOK, NOT A CONSTANT IN `StyleSheet.create`, and the difference is the
 * same one this file's skeleton exists to record: a `StyleSheet` value is
 * computed once at unscaled token values, but the line box it has to centre
 * against is `lineHeight × fontScale`. Frozen at 5, the dot sits 2.7pt high at
 * the stacking threshold and 9pt high at 200% — riding above the words it
 * marks, at exactly the sizes where accuracy matters most.
 */
function useMarkerOffset(): (markSize: number) => number {
  const { fontScale } = useWindowDimensions();
  const line = typography.label.lineHeight * (fontScale ?? 1);
  return (markSize: number) => (line - markSize) / 2;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // ⚠️ `surface` AND A HAIRLINE, NOT `surfaceSubtle` AND NOTHING. This was
    // the only card in the app filled with the subtle grey, which reads as a
    // well in the page rather than a thing resting on it. No shadow: every
    // Airbnb pass on this app has shipped cards flat, and the hairline is what
    // separates card from page in dark, where `surface` on `background` is
    // #1E1E1E on #141414. (DESIGN_SYSTEM's Card entry still specifies a soft
    // shadow; code and doc now disagree across six screens, which is a doc
    // decision and not one to settle silently here.)
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.lg,
      borderRadius: radii.lg,
      backgroundColor: c.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
    },
    cardStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
    },
    main: { flex: 1, gap: spacing.xs },
    // ⚠️ NEUTRALISE THE BASIS WHEN THE CARD IS A COLUMN. `flex: 1` is
    // `flexBasis: 0`, which works while the card's main axis is its definite
    // WIDTH — but `cardStacked` makes the main axis its auto HEIGHT, where
    // there is no free space to distribute and a basis-0 child resolves to
    // ZERO. The text would then overflow the card's bottom edge, at exactly the
    // font scale this stacking exists to serve. AlertCard walked into the same
    // trap, and DESIGN_SYSTEM records it for the wizard's map step.
    mainStacked: { flexGrow: 0, flexBasis: 'auto', alignSelf: 'stretch' },
    car: {
      ...typography.cardTitle,
      color: c.textPrimary,
      // The car is the headline: it is how a spotter recognises which of their
      // own reports this is, with no plate and no photo on the row.
      //
      // ⚠️ NO `textTransform: 'capitalize'`, which the old row carried. The
      // data is already canonical — posts.colour stores the enum name ("Blue")
      // and makes come from the shared dataset — so it never had anything to
      // fix, and it broke the two rows that are not a car name: the sanctioned
      // "a car" fallback rendered as "A Car", and "Multicolour / wrapped" as
      // "Multicolour / Wrapped". Both are title case against the house
      // sentence-case rule, and neither was visible to a test, because
      // textTransform is paint. The accessibility label used the untransformed
      // string, so VoiceOver said "a car" while the screen said "A Car".
    },
    when: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // ⚠️ `flex-start`, NOT `center`. The label wraps on both good rows — the
    // text column is ~199pt on a 375pt device and "Credited — this one led to
    // the recovery" is 39 characters at 14pt — and a centred 8pt dot then sits
    // in the gutter BETWEEN the two lines instead of beside the first.
    verdict: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    // The same geometry StatusPill draws, so a dot means the same thing here as
    // it does on a post's badge. Its vertical offset is applied by the caller —
    // see `useMarkerOffset` for why it cannot live in here.
    dot: {
      width: sizes.progressDot,
      height: sizes.progressDot,
      borderRadius: radii.sm,
    },
    /** helpful / credited only. A verdict that went the spotter's way is the
     *  one moment this screen has to give them, so it takes the colour and the
     *  ink. Nothing goes red: the other outcomes are not failures. */
    dot_good: { backgroundColor: c.success },
    /**
     * unverified — nobody has looked yet.
     *
     * ⚠️ A RING, NOT A FILL, and that is an accessibility fix rather than a
     * flourish. Amber `#A9762A` against `borderStrong` `#8F8F8F` is a 1.19:1
     * LUMINANCE ratio, so in greyscale or under deuteranopia a filled amber dot
     * and the neutral one are the same mark again — and telling "still open"
     * from "answered and closed" at a glance is the whole reason this tone was
     * added. The ladder is now four SHAPES: hollow ring open, filled grey
     * closed, filled green helpful, tick credited, with colour reinforcing
     * rather than carrying. It also reads calmer at density, which matters —
     * most sightings are never ruled on, so a column of these is the common
     * case.
     */
    dot_pending: {
      borderWidth: sizes.timelineDotStroke,
      borderColor: c.warning,
    },
    /** not_mine — answered, and closed. Neutral by design. */
    dot_plain: { backgroundColor: c.borderStrong },
    verdictLabel: {
      ...typography.label,
      color: c.textSecondary,
      // The verdict is the longest string on the card; it wraps rather than
      // truncating, because the half that would be cut is the half that
      // matters. RN defaults flexShrink to 0, so without this it would overflow.
      flexShrink: 1,
    },
    verdictLabelGood: { color: c.textPrimary },
    verdictWhen: { color: c.textSecondary },
    skeletonTile: {
      width: sizes.carTile,
      height: sizes.carTile,
      borderRadius: radii.lg,
      backgroundColor: c.surfaceSubtle,
    },
    skeletonLine: {
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
      width: '80%',
    },
    skeletonLineNarrow: { width: '55%' },
    // Mirrors the real verdict row's `marginTop`, which sits outside `main`'s
    // gap.
    skeletonLineVerdict: { width: '65%', marginTop: spacing.xs },
  });
