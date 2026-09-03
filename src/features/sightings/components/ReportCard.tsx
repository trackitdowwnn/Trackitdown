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
 *        ⚠️ THE CARD IS PRESSABLE SINCE 2026-09-03, AND ONLY SOMETIMES. This
 *        header said "the post is not something this screen is allowed to link
 *        to" — half of which stopped being true. The rule was always about
 *        CLOSED posts: a spotter cannot see one, which is why the
 *        `closed_uncredited` push routes to the dispute screen. An ACTIVE post
 *        is public — on the map, in search, anon-readable — so handing a
 *        spotter the id of a car they themselves photographed reveals nothing
 *        that search would not.
 *
 *        So `my_sighting_record` now sends `post_id` for active posts ONLY, and
 *        the text block becomes the press target when it arrives. A closed
 *        report gets no id, no chevron and no press, and stays exactly as flat
 *        as it has always been — the other half of the old reasoning, which
 *        does stand: a card that looks tappable and is not is worse than a flat
 *        one. (Review finding #16: the screen was a dead end.)
 *
 *        The press sits on `main` — the element that already carried
 *        `accessible` — rather than wrapping the card. A Pressable with a label
 *        reads as ONE node and IS the control; a Pressable wrapped around a
 *        grouped child would give VoiceOver two stops for one thing.
 *
 *        ⚠️ WHAT CHANGED 2026-09-01 is that SOME reports now do. `/sighting-
 *        dispute` was reachable only from a push, so a spotter who declined
 *        notifications could never contest a denial (ROADMAP's last open item
 *        on the critical path). Where a refund hold names this sighting, the
 *        card grows ONE labelled row — never a whole-card press — so only the
 *        reports that can actually open something carry a control.
 *
 *        That is also why the card is now a COLUMN wrapping a row: the door has
 *        to be a SIBLING of the text block, because `main` carries the
 *        accessibility grouping and a control inside a grouped element is
 *        unreachable to VoiceOver (AlertCard's header records that bug in
 *        full). The grouping moved from the card onto `main` in the same pass,
 *        so a doorless card reads as one utterance exactly as before.
 * LINKS: src/shared/ui/CarColourTile.tsx (the leading visual, and why it
 *          exists — moved there 2026-08-28 when chat needed it too);
 *        ../screens/MySightingsScreen.tsx (the only consumer);
 *        ../api/sightingApi.ts (MySightingRecordEntry — read its PRIVACY note
 *          before widening what this row shows).
 */

import { Check, ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import {
  cardSurface,
  opacity,
  listRowStackFontScale,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { CarColourTile } from '@/shared/ui';

import type { MySightingRecordEntry } from '../api/sightingApi';

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
  // ⚠️ The only row here that is not a VERDICT — it is the spotter's own act,
  // so the copy says what THEY did rather than what was decided about them.
  // `plain`, never `pending` or a warning tone: taking back a report you know
  // to be wrong is the right thing to do, and the card must not scold anyone
  // for doing it.
  withdrawn: { label: 'You took this back', tone: 'plain' },
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

/**
 * What the dispute door says, per state. Only `available` reports get one.
 *
 * ⚠️ THE COPY FOLLOWS SightingDisputeScreen'S HONESTY RULE: filing is "tell
 * us", never "appeal" — there was no verdict to appeal, the post simply closed
 * without crediting anybody. Anything framed as contesting a decision would
 * promise an adversarial process this product does not have.
 *
 * A filed dispute keeps the door open but stops inviting: the spotter has said
 * their piece and the screen is now where they read the answer.
 */
function disputeDoor(
  dispute: NonNullable<MySightingRecordEntry['dispute']>,
): { label: string; hint: string } | null {
  if (!dispute.available) return null;
  switch (dispute.status) {
    case 'open':
      return { label: 'We’re looking at this', hint: 'Opens what you told us' };
    case 'upheld':
      return { label: 'You were right — see what happens next', hint: 'Opens the outcome' };
    case 'rejected':
      return { label: 'See the outcome', hint: 'Opens the outcome' };
    default:
      return {
        label: 'Tell us if this was your sighting',
        hint: 'Opens a form to tell us what you saw',
      };
  }
}

export interface ReportCardProps {
  entry: MySightingRecordEntry;
  /**
   * Opens /sighting-dispute for this report. Optional: a screen that passes
   * nothing gets today's flat, controlless card, which is still the right
   * shape for every report with no hold against it.
   */
  onOpenDispute?: (sightingId: string) => void;
  /**
   * Takes the report back (review #21). Offered ONLY while nobody has ruled on
   * it — the server permits `unverified` alone, because after a verdict this
   * would erase the owner's decision, and on `credited` one that moved money.
   */
  onWithdraw?: (sightingId: string) => void;
  /**
   * Opens the post this report is about (review #16 — the card used to be a
   * dead end). Rendered ONLY when `entry.postId` is present, which the server
   * sends only while the post is still active: a closed listing stays
   * unreachable from a spotter's history, and a card that looked tappable and
   * was not would be worse than a flat one.
   */
  onOpenPost?: (postId: string) => void;
}

export function ReportCard({ entry, onOpenDispute, onWithdraw, onOpenPost }: ReportCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const stacked = useStackedRow();
  const markerOffset = useMarkerOffset();

  const reported = useTimeAgo(entry.createdAt);
  const ruled = useTimeAgo(entry.reviewedAt ?? entry.createdAt);
  const verdict = VERDICT[entry.status];
  const car = describeReportedCar(entry.car);

  const door = entry.dispute && onOpenDispute ? disputeDoor(entry.dispute) : null;
  // ⚠️ Gated on `unverified` CLIENT-side purely so the control is not offered
  // where it cannot work — the server is the actual gate and refuses anything
  // else with one opaque token. An owner ruling between render and tap is a
  // real race, and the copy for it is written for exactly that.
  const canWithdraw = entry.status === 'unverified' && onWithdraw !== undefined;
  // ⚠️ Null for every CLOSED listing, because the server sends no id for one —
  // that is the privacy rule, enforced where it belongs rather than here. This
  // only asks "did we get an id, and can the screen use it".
  const postId = entry.postId;
  const openPost =
    postId && onOpenPost ? () => onOpenPost(postId) : null;

  const when = entry.areaLabel ? `${entry.areaLabel} · ${reported}` : reported;
  // WHEN they ruled, only once they have. NULL reviewed_at means nobody has
  // looked, which must never be dressed up as a decision.
  const ruledSuffix = entry.reviewedAt ? ` · ${ruled}` : '';

  return (
    <View
      style={styles.card}
      testID={`my-sighting-${entry.id}`}
      // ⚠️ ONE UTTERANCE, NOT THREE. Ungrouped, a screen reader read the car,
      // then a ·-joined fragment, then a verdict, as three unrelated strings
      // with no way to tell which report the verdict belonged to. Grouping is
      // safe here only because the card holds no controls — see the header for
      // why it is not pressable, and AlertCard for what grouping costs when it
      // is.
      // ⚠️ THE GROUPING MOVED OFF THE CARD AND ONTO THE TEXT BLOCK, because the
      // card can now hold a control. iOS groups an `accessible` element's
      // children, so a button in here would be unreachable to VoiceOver while
      // working fine on Android — the exact bug AlertCard's header records, and
      // why its card is a plain View with separately-labelled parts. Custom
      // accessibilityActions would not save it either: Voice Control and Full
      // Keyboard Access navigate the TREE, and a tree of one element gives them
      // nothing to tab to.
      //
      // The one utterance is preserved by grouping `main` instead, so a card
      // with no door reads exactly as it did. The tile is safe to leave outside
      // it: CarColourTile renders no text and sets no accessibility props, so it
      // is not a focus stop.
    >
      <View
        style={[styles.row, stacked && styles.rowStacked]}
        testID={`my-sighting-row-${entry.id}`}
      >
      <CarColourTile colour={entry.car.colour} testID={`my-sighting-tile-${entry.id}`} />

      {/* ⚠️ THE TEXT BLOCK IS THE PRESS TARGET, not the whole card, and it is
          a Pressable ONLY when there is a post to open (review #16). Keeping
          the press on the element that already carried `accessible` preserves
          the single utterance — a Pressable with a label reads as one node AND
          is a control, where a wrapping Pressable around a grouped child would
          give VoiceOver two stops for one thing.

          `openPost` is null whenever the server sent no id, which is every
          closed listing. Those cards stay exactly as flat as they have always
          been, which is the point: a card that looks tappable and is not would
          be worse than a flat one. */}
      <Pressable
        style={({ pressed }) => [
          styles.main,
          stacked && styles.mainStacked,
          openPost && pressed && styles.mainPressed,
        ]}
        accessible
        accessibilityRole={openPost ? 'button' : undefined}
        accessibilityHint={openPost ? 'Opens the listing' : undefined}
        onPress={openPost ?? undefined}
        testID={openPost ? `my-sighting-open-${entry.id}` : undefined}
        accessibilityLabel={`${car}, reported ${
          entry.areaLabel ? `in ${entry.areaLabel} ` : ''
        }${reported}. ${verdict.label}${entry.reviewedAt ? `, ${ruled}` : ''}`}
      >
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
      </Pressable>
      {/* The affordance, so "tappable" is visible and not just true. Outside
          the labelled block: it is decoration, and a screen reader has already
          been told this opens the listing. */}
      {openPost ? (
        <ChevronRight
          size={sizes.iconSm}
          color={palette.textSecondary}
          style={{ marginTop: markerOffset(sizes.iconSm) }}
        />
      ) : null}
      </View>

      {/* ⚠️ THE DOOR, and the reason this card stopped being flat. Until now
          /sighting-dispute was reachable ONLY from a push, so a spotter who
          declined notifications could never contest a denial — the header above
          said the card had "nowhere to go", and this is the somewhere.

          A SEPARATE, LABELLED ELEMENT rather than the whole card being
          pressable: most reports have no hold against them and never will, and
          a card that looks tappable and is not would be worse than a flat one
          (the original reasoning, still true). Only the reports that can
          actually open something gain a control. */}
      {door ? (
        <Pressable
          onPress={() => onOpenDispute?.(entry.id)}
          accessibilityRole="button"
          // The label has to carry WHICH report, because this button sits
          // outside the grouped text block and a screen reader arriving here
          // from below has not heard the car yet.
          accessibilityLabel={`${door.label}. ${car}, reported ${reported}`}
          accessibilityHint={door.hint}
          style={({ pressed }) => [styles.door, pressed && styles.doorPressed]}
          testID={`my-sighting-dispute-${entry.id}`}
        >
          <Text style={styles.doorLabel}>{door.label}</Text>
          <ChevronRight size={sizes.iconSm} color={palette.textSecondary} />
        </Pressable>
      ) : null}

      {/* ⚠️ THE WAY BACK (review #21). Sightings were create-only: a spotter
          who reported the wrong car — which the Terms explicitly call a normal
          outcome, not a failure — had no way to say so, and the report stood in
          front of the owner forever.

          NO CHEVRON, unlike the dispute door: that one opens a screen, this one
          performs an action, and borrowing its affordance would promise a place
          to go. Quiet by design — it sits below the verdict, in secondary ink,
          because most reports are correct and this must not read as an
          invitation to doubt yourself. */}
      {canWithdraw ? (
        <Pressable
          onPress={() => onWithdraw?.(entry.id)}
          accessibilityRole="button"
          // Carries the car for the same reason the door's label does: a screen
          // reader arriving here has not heard which report this is.
          accessibilityLabel={`Take back this report. ${car}, reported ${reported}`}
          accessibilityHint="Withdraws it, so the owner no longer sees it"
          style={({ pressed }) => [styles.door, pressed && styles.doorPressed]}
          testID={`my-sighting-withdraw-${entry.id}`}
        >
          <Text style={styles.doorLabel}>Take this back</Text>
        </Pressable>
      ) : null}
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
    <View style={styles.card} testID="report-card-skeleton">
      <View
        style={[styles.row, stacked && styles.rowStacked]}
        testID="report-card-skeleton-row"
      >
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
    // ⚠️ `cardSurface`, NOT `surfaceSubtle` AND NOTHING. This was the only card
    // in the app filled with the subtle grey, which reads as a well in the page
    // rather than a thing resting on it. The shared box carries the flat-with-a-
    // hairline decision and the reasoning behind it.
    // ⚠️ THE CARD IS A COLUMN AND THE TILE+TEXT ROW IS A CHILD OF IT, since
    // 2026-09-01. It used to BE the row. The dispute door has to be a sibling
    // of the text block rather than inside it — `main` carries the
    // accessibility grouping, and a control inside a grouped element is
    // unreachable to VoiceOver — so the card needed a second slot underneath.
    // With one child the `gap` is inert, so a card with no door is unchanged.
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    rowStacked: {
      flexDirection: 'column',
      alignItems: 'flex-start',
    },
    // The door reads as a row in the card, not a button on it: a filled Button
    // here would shout louder than the verdict above it, and on a screen whose
    // whole job is to state outcomes calmly that is the wrong emphasis. The
    // separator is what makes it a distinct region rather than a fourth line of
    // metadata.
    door: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      // Full-width, and at least a 44pt target — the row is the hit area, so it
      // must clear the floor on its own rather than relying on hitSlop, which
      // the notifications pass proved is claimed by the next sibling in reverse
      // draw order.
      minHeight: sizes.touchTarget,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    doorPressed: {
      opacity: 0.6,
    },
    doorLabel: {
      ...typography.label,
      color: c.textPrimary,
      flex: 1,
    },
    main: { flex: 1, gap: spacing.xs },
    // Opacity, not the 0.98 scale VehicleCard uses: this is a text block inside
    // a row, and scaling it would shift the chevron and the tile beside it.
    mainPressed: { opacity: opacity.pressed },
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
