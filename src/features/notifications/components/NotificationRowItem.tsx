/**
 * WHAT:  One notification feed row — icon in a neutral tile, title + relative
 *        time, body (2 lines max), the needs-attention label, and the unread
 *        badge.
 * WHY:   The Airbnb-calm row: the icon SHAPE says what happened (hue assists,
 *        never carries alone), unread is a quiet badge and weight rather than a
 *        coloured background, and the two kinds that genuinely need the user
 *        (money waiting, a contest window running) get the one louder
 *        treatment — a warning bar AND its words — that disappears the moment
 *        they're read. The whole row is one pressable ≥ touch-target height;
 *        the tap's destination comes from the row's stored payload through the
 *        same routing pushes use, so a row can never go somewhere its push
 *        wouldn't have.
 *
 *        ⚠️ ONE SILHOUETTE WITH ThreadRow, deliberately and structurally
 *        (2026-08-28, Airbnb inbox pass). The two faces of the inbox are two
 *        lists in one tab, and a reader switching between them must not feel
 *        they changed app. Both are now: a round `inboxRowTile` lead, a flex
 *        text column of title / content / context, and a trailing META COLUMN
 *        holding the time above the `UnreadBadge` — same gutter, same gap, same
 *        padding. Change the box here and the conversation row has to change
 *        with it.
 *
 *        ⚠️ AND THEY AGREE ON TIME AGAIN as of 2026-09-04. This row drew
 *        `timeAgo` ("2h ago") while ThreadRow drew a clock — a gap recorded
 *        here as wanted-but-out-of-scope. Both lists then went FLAT, and with
 *        no header above a row to say the day, both had to move to the shared
 *        `formatListStamp` ladder: the clock today, "Yesterday" yesterday, a
 *        date before that.
 *
 *        ⚠️ A CIRCLE SINCE 2026-09-04, REVERSING THE PARAGRAPH THAT USED TO
 *        STAND HERE. It read: "A ROUNDED SQUARE, NOT A CIRCLE. Circles mean
 *        people; this app's inbox has no photographs of people in it (the peer
 *        avatar is deliberately withheld) and every row is about an event or a
 *        car." That argument is still true as far as it goes, and it was
 *        overridden on purpose: the owner asked for the Messages list to read
 *        as a messaging app, and the round lead is the strongest signal of that
 *        available to a row whose picture can never be a face. The tile follows
 *        ThreadRow here rather than leading — the silhouette rule below is what
 *        forces it, and two faces of one tab disagreeing about the shape of
 *        their lead would be worse than either shape.
 *
 *        What survives from the old reasoning: the lead is still never a
 *        PERSON. It is a car, or an event icon. The circle is borrowed
 *        geometry, not a claim about whose face this is.
 * LINKS: ../lib/centerRowMeta.ts (the one look-up table, and the labels);
 *        ../api/notificationsApi.ts (NotificationRow);
 *        src/features/chat/components/ThreadRow.tsx (the silhouette twin);
 *        ../screens/NotificationCenterScreen.tsx (the only consumer).
 */

import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { formatListStamp } from '@/shared/lib/dateTimeLabel';
import { timeAgo } from '@/shared/lib/timeAgo';
import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, UnreadBadge } from '@/shared/ui';

import type { NotificationRow } from '../api/notificationsApi';
import { CENTER_ROW_META, type NotificationTone } from '../lib/centerRowMeta';

export interface NotificationRowItemProps {
  row: NotificationRow;
  onPress: (row: NotificationRow) => void;
}

/**
 * Tone → hue, against the palette in effect. Lives here rather than in the
 * meta table because the table is a plain module that must not depend on a
 * palette (see ../lib/centerRowMeta.ts) — this is the one place that has a
 * render to resolve it in.
 */
function toneColor(c: Palette, tone: NotificationTone): string {
  switch (tone) {
    case 'success':
      return c.success;
    case 'warning':
      return c.warning;
    case 'danger':
      return c.danger;
    default:
      return c.textSecondary;
  }
}

export function NotificationRowItem({ row, onPress }: NotificationRowItemProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // ⚠️ A FALLBACK FOR A KIND THIS BUILD HAS NEVER HEARD OF. The server's CHECK
  // constraint keeps the column inside the known set today, but the set widens
  // server-first (that is how `payout_sent` arrived), so an older client can be
  // handed a newer kind. `CENTER_ROW_META[unknown]` is undefined and the very
  // next line reads `.needsAttention` off it — the whole feed would crash on
  // one unrecognised row rather than degrading to a plain one.
  const meta = CENTER_ROW_META[row.kind] ?? CENTER_ROW_META.alert;
  const unread = row.readAt === null;
  const loud = unread && meta.needsAttention;

  // The badge, the weight and the bar are visual; the LABEL is where a screen-
  // reader user learns the same facts (ThreadRow's precedent).
  // ⚠️ THE SAME WORDS THE ROW SHOWS. This used to append "Needs your
  // attention." — a sentence no sighted user ever saw, describing a stripe
  // rather than the errand. Reader and screen now say the same thing.
  const accessibilityLabel =
    `${row.title}. ${row.body}. ${timeAgo(row.createdAt)}.` +
    (loud ? ` ${meta.attentionLabel}.` : unread ? ' Unread.' : '');

  return (
    <Pressable
      onPress={() => onPress(row)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`notification-${row.id}`}
    >
      {/* The needs-attention bar: warning is allowed as a border/accent, never
          text. Absent entirely for read/ordinary rows so the calm default has
          no ghost gutter. */}
      {loud ? <View style={styles.attentionBar} testID={`attention-${row.id}`} /> : null}
      {/* ⚠️ THE PHOTOGRAPH WHEN THERE IS ONE, the icon when there is not — and
          the icon case is ordinary, not exceptional. `image_url` is null
          whenever the server won't show a photo for that post (the caller has
          no standing on it) or the row references no post at all. It is NOT
          null for the money kinds: `credited`, `payout_sent` and
          `not_credited` go to a spotter with a sighting on that post, so they
          get the car. Both shapes are the same 64pt box, so the list rhythm
          never changes between them — only what is inside it. */}
      {row.imageUrl ? (
        <AppImage
          uri={row.imageUrl}
          recyclingKey={row.id}
          style={styles.lead}
          testID={`notification-photo-${row.id}`}
        />
      ) : (
        <View style={styles.lead}>
          <meta.Icon size={sizes.inboxRowGlyph} color={toneColor(palette, meta.tone)} />
        </View>
      )}
      <View style={styles.textColumn}>
        <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.body} numberOfLines={2}>
          {row.body}
        </Text>
        {/* ⚠️ THE BAR AND THE WORDS TOGETHER. The stripe stays — it is the
            peripheral cue you catch while scrolling — but on its own it was
            status encoded as colour, which the design system forbids and which
            told nobody what to actually do. The mark is a hollow RING rather
            than a filled amber dot for ReportCard's documented reason: filled
            amber and neutral grey are the same mark in greyscale and under
            deuteranopia. Ink on the words, colour only on the ring. */}
        {loud ? (
          <View style={styles.attentionRow}>
            <View style={styles.attentionMark} />
            {/* ⚠️ NO numberOfLines. At 200% the text column is ~238pt and
                "Add your bank details" needs ~255 — it truncated to "Add your
                bank detai…", which puts the ring back to carrying the status
                on its own, i.e. straight back to colour-only. Wrapping is the
                cheaper failure. */}
            <Text style={styles.attentionLabel}>{meta.attentionLabel}</Text>
          </View>
        ) : null}
      </View>
      {/* ⚠️ FOLLOWS ThreadRow (2026-09-04): time above, unread below, as one
          trailing column. The silhouette rule in this file's header is why —
          the conversation face moved its time out of the title line into a
          stacked meta column, and two faces of one tab cannot disagree about
          where a timestamp lives. `topLineStacked` retires with it: the time
          no longer competes with the TITLE, which is what that behaviour
          existed to protect. */}
      <View style={styles.meta}>
        <Text style={styles.time} numberOfLines={1}>
          {formatListStamp(row.createdAt)}
        </Text>
        <UnreadBadge count={unread ? 1 : 0} testID={unread ? `unread-${row.id}` : undefined} />
      </View>
    </Pressable>
  );
}

/**
 * The row's shape while the feed loads.
 *
 * ⚠️ IT SHARES `makeStyles` WITH THE REAL ROW, which is the whole point. The
 * screen used to hand-copy the geometry and got it wrong in three places at
 * once — a 48pt circle against a 64pt tile, two bars where the row has three
 * lines, and `gap: spacing.sm` against the row's `spacing.xs` — so the list
 * visibly resettled the moment data arrived. Anything the row changes, this
 * inherits.
 *
 * Bar heights come from the type they stand in for, multiplied by `fontScale`:
 * `sizes.skeletonLine` is a fixed 12 and stops matching from about 1.10.
 */
export function NotificationRowSkeleton() {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const scale = fontScale ?? 1;

  return (
    <View style={styles.row}>
      <View style={styles.lead} />
      <View style={styles.textColumn}>
        {/* Title alone — the time moved to the trailing column with the badge,
            and the skeleton follows it there. */}
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonTitle,
            { height: typography.body.lineHeight * scale },
          ]}
        />
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonBody,
            { height: typography.body.lineHeight * scale },
          ]}
        />
      </View>
      {/* The same trailing column a real row keeps — a time bar over the
          badge's reserved slot — so nothing shifts sideways when it loads. */}
      <View style={styles.meta}>
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonTime,
            { height: typography.caption.lineHeight * scale },
          ]}
        />
        <UnreadBadge count={0} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    // md (12), matching ThreadRow — see its note on row density.
    paddingVertical: spacing.md,
    minHeight: sizes.touchTarget,
  },
  // ⚠️ surfaceSubtlePressed, NOT surfaceSubtle — which is the fill of the tile
  // INSIDE this row. Pressing a row used to repaint it in its own tile's
  // colour, erasing the tile to zero contrast for the duration of the touch.
  // ChoiceChips and PlateChip use the pressed token for exactly this reason.
  rowPressed: {
    backgroundColor: c.surfaceSubtlePressed,
  },
  attentionBar: {
    position: 'absolute',
    left: 0,
    top: spacing.sm,
    bottom: spacing.sm,
    width: sizes.attentionBar,
    borderRadius: radii.full,
    backgroundColor: c.warning,
  },
  // The shared inbox lead: a CIRCLE since 2026-09-04, matching ThreadRow's car
  // photo. See the header for what that reversed and why.
  //
  // ⚠️ IT NEEDS THE EDGE TO EXIST AT ALL. `surfaceSubtle` on `background` is
  // #EEEEEE on #F7F7F7 — 1.08:1 — and #2A2A2A on #141414 in dark, 1.28:1. Both
  // are far under the 3:1 floor for graphics, so without a border the "tile" is
  // not a tile: it is a coloured glyph floating in space, beside a face whose
  // rows lead with a photograph. CarColourTile makes the same argument in the
  // same words — a sample of paint needs an edge at both ends of the range.
  lead: {
    width: sizes.inboxRowTile,
    height: sizes.inboxRowTile,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
    borderWidth: 1,
    borderColor: c.borderStrong,
    // Clips a photo to the circle; harmless on the icon shape.
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  // Time above, unread below — the trailing column ThreadRow uses. Identical
  // style there; see the silhouette note in the header.
  meta: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    flexShrink: 0,
  },
  // ⚠️ `body`, matching ThreadRow's name — NOT `label`. The two faces shared a
  // box but not a type ramp, so switching segments changed every text size on
  // screen, and the notification row came out 10pt shorter than a conversation
  // row. It also made the 64pt tile, not the text, decide the row height, which
  // is the one thing `inboxRowTile`'s own doc comment says it must not do.
  title: {
    ...typography.body,
    color: c.textPrimary,
    // Yields to the time rather than pushing it off the row.
    flexShrink: 1,
  },
  // A HEAVIER FAMILY, never fontWeight — Android fakes bold over the loaded
  // face otherwise (ThreadRow's nameUnread precedent).
  titleUnread: {
    fontFamily: typography.cardTitle.fontFamily,
  },
  // `body` at textSecondary, matching the conversation row's preview line: on
  // both faces the second line is what actually happened.
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
  time: {
    ...typography.caption,
    color: c.textSecondary,
    // Never shrinks: a truncated timestamp is worse than a truncated title.
    flexShrink: 0,
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attentionMark: {
    width: sizes.attentionRing,
    height: sizes.attentionRing,
    borderRadius: radii.full,
    borderWidth: sizes.attentionRingStroke,
    borderColor: c.warning,
    // Never squeezed by a wrapping label beside it.
    flexShrink: 0,
  },
  // ⚠️ textPrimary, NOT warning. DESIGN_SYSTEM: warning is dot/icon/border
  // only, never body text — amber type on the near-white background does not
  // clear AA, and the ring beside it already carries the hue.
  //
  // `label` (14) under a `body` (16) title and message, so the errand is the
  // quietest line in weight while being the only one in full-strength ink.
  attentionLabel: {
    ...typography.label,
    color: c.textPrimary,
    flexShrink: 1,
  },
  skeletonBar: {
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  // Widths chosen to read as a title, a timestamp and a line of body rather
  // than three anonymous bars.
  skeletonTitle: {
    flex: 1,
    maxWidth: '55%',
  },
  skeletonTime: {
    width: sizes.skeletonTimeBar,
  },
  skeletonBody: {
    width: '85%',
  },
});
