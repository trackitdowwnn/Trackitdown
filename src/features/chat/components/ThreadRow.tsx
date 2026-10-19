/**
 * WHAT:  ThreadRow — one inbox conversation: the CAR'S COVER PHOTO leading,
 *        first name + the clock time, a short car line ("Blue BMW · your car",
 *        drawn again since 2026-10-19), a one-line last-message preview, and
 *        the unread badge. The fuller context ("About your Blue BMW" + the
 *        owner's own plate) is spoken in the label.
 * WHY:   Airbnb-style rows anchor a conversation to the THING it's about, and
 *        they give that thing the leading slot at full size — a listing row
 *        leads with the listing. Ours leads with the car, which is how you
 *        actually recognise which conversation this is.
 *
 *        ⚠️ THIS INVERTED THE PREVIOUS STACK ON 2026-08-28, and the old
 *        arrangement was defended in this very comment, so the reversal is
 *        worth stating. The row used to lead with an initial-letter Avatar
 *        wearing a 24pt car badge on its corner — "the Airbnb context-anchor,
 *        made visual". The flaw: at 24pt you cannot tell one silver hatchback
 *        from another, so the anchor anchored nothing and the leading slot was
 *        spent on a letter. The person's identity is now carried by their NAME
 *        in the title line, which identifies them better than an initial did.
 *
 *        No peer photo is possible and none is missing: the other party's
 *        avatar path embeds their uid, so the API never returns it (types.ts).
 *        PRIVACY: the plate is never DRAWN; it is spoken only, and only on
 *        owner rows (their own plate; inboxModel pins the rule). The drawn
 *        car line is colour + model only. The photo is the POST's public cover —
 *        already visible to both parties — never anything of the other
 *        person's.
 *
 *        ⚠️ ONE SILHOUETTE WITH NotificationRowItem — same round tile, gap,
 *        gutter, padding, and the same trailing meta column (time over badge).
 *        See that file's header; change one and change both. The 2026-09-04
 *        row pass changed all of those, and changed them in both files.
 *
 *        ⚠️ THE TWO FACES AGREE AGAIN as of 2026-09-04: both lists went FLAT
 *        (no day headers) and both rows now draw `formatListStamp`, which
 *        degrades from a clock to "Yesterday" to a date. The gap that stood
 *        here — this row on a clock, NotificationRowItem on `timeAgo` — closed
 *        when the headers went, because with nothing above the row to say the
 *        day, one shared ladder had to carry it on both faces. (Since
 *        2026-10-19 Notifications groups by Today / Yesterday / Earlier again;
 *        Messages stays flat. The shared stamp still holds on both.)
 * LINKS: src/features/chat/lib/inboxModel.ts (context/unread maths);
 *        src/features/notifications/components/NotificationRowItem.tsx (the
 *          silhouette twin);
 *        src/shared/ui (CarColourTile, AppImage, UnreadBadge, spellPlate);
 *        docs/DESIGN_SYSTEM.md.
 */

import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { formatDateTimeLabel, formatListStamp } from '@/shared/lib/dateTimeLabel';
import {
  listRowStackFontScale,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, CarColourTile, spellPlate, UnreadBadge } from '@/shared/ui';

import { carLine, contextLine, isUnread, previewText } from '../lib/inboxModel';
import type { InboxThread } from '../types';

export interface ThreadRowProps {
  thread: InboxThread;
  onPress: (thread: InboxThread) => void;
}

export function ThreadRow({ thread, onPress }: ThreadRowProps) {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const scale = fontScale ?? 1;
  const unread = isUnread(thread);
  const context = contextLine(thread);
  // ⚠️ ONE VALUE ANSWERING "WHEN", because nothing above the row does it any
  // more. This was `timeAgo` ("2h ago"), then briefly a bare clock while the
  // list still carried day headers; the headers went on 2026-09-04 and the
  // stamp had to take the whole job. It degrades by precision — the clock
  // today, "Yesterday" yesterday, a date before that — because "14:32" on a
  // thread from July would be worse than the relative stamp it replaced.
  const when = formatListStamp(thread.lastMessageAt);
  // ⚠️ THE LABEL IS STILL RICHER THAN THE ROW, on purpose. The drawn stamp
  // sheds the time as a thread ages; the spoken one keeps day AND time at every
  // age ("Mon 6 Jul, 14:30"), because a screen-reader user cannot glance at the
  // rows above to place this one in a sequence.
  const spokenWhen = formatDateTimeLabel(thread.lastMessageAt);
  // ⚠️ RESTORED 2026-09-05. Deleting this cost the preview ~two thirds of its
  // width at 2x text — see the note at the meta column.
  const stacked = scale > listRowStackFontScale;

  return (
    <Pressable
      onPress={() => onPress(thread)}
      accessibilityRole="button"
      accessibilityLabel={
        `Conversation with ${thread.other.firstName}. ${context.prefix}. ` +
        // ⚠️ THE PLATE IS SPOKEN, NOT JUST DRAWN. A sighted owner saw their
        // registration and a VoiceOver user did not — the label was built from
        // `prefix` alone while the chip rendered from `plate`. Spelled out
        // character-group by character-group, because a screen reader reading
        // "AB12 CDE" as a word is not a registration anyone can write down.
        (context.plate ? `Plate ${spellPlate(context.plate)}. ` : '') +
        `${previewText(thread)}. ${spokenWhen}.` +
        // Pluralised: the old label read "3 unread." as a bare fragment, and
        // "1 unread" for a single message.
        (unread
          ? ` ${thread.unreadCount} unread ${thread.unreadCount === 1 ? 'message' : 'messages'}.`
          : '')
      }
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      testID={`thread-row-${thread.threadId}`}
    >
      {/* ⚠️ THE PHOTO, OR THE PAINT — never an empty grey square.
          `coverPhotoUrl` is nullable, and a row without one used to fall back
          to nothing at all. CarColourTile draws the car's actual colour with a
          silhouette over it, which is the same answer `My reports` reached for
          the same problem — and the reason that component now lives in
          shared/ui. */}
      {thread.post.coverPhotoUrl ? (
        <AppImage
          uri={thread.post.coverPhotoUrl}
          recyclingKey={thread.threadId}
          style={styles.lead}
          testID={`thread-car-photo-${thread.threadId}`}
        />
      ) : (
        <CarColourTile
          colour={thread.post.colour}
          size={sizes.inboxRowTile}
          radius={radii.full}
          glyphSize={sizes.inboxRowGlyph}
          testID={`thread-car-tile-${thread.threadId}`}
        />
      )}
      <View style={styles.body}>
        <Text style={[styles.name, unread && styles.nameUnread]} numberOfLines={1}>
          {thread.other.firstName}
        </Text>
        {/* ⚠️ THE CAR LINE IS DRAWN AGAIN (owner's call, 2026-10-19), reversing
            2026-09-24. With only a 48pt photo saying which car, the list read
            as names and messages with no anchor. A short caption — car, then
            your side of it — and NO plate (the label above still speaks the
            owner's). The row is ONE accessible element, so a reader hears the
            label, not these children — the context is never read twice. */}
        <Text
          style={styles.carLine}
          numberOfLines={1}
          testID={`thread-car-line-${thread.threadId}`}
        >
          {carLine(thread)}
        </Text>
        {/* The message takes `body`, not `caption`: the words someone actually
            sent are the line most worth reading. */}
        <Text
          style={[styles.preview, unread && styles.previewUnread]}
          numberOfLines={1}
          testID={`thread-preview-${thread.threadId}`}
        >
          {previewText(thread)}
        </Text>
        {/* Past `listRowStackFontScale` the stamp lives here instead of in the
            trailing column — see the note below the body. */}
        {stacked ? <Text style={styles.timeStacked}>{when}</Text> : null}
      </View>
      {/* ⚠️ THE TIME AND THE BADGE ARE ONE TRAILING COLUMN (2026-09-04). The
          time used to share the top line with the name and the badge sat in a
          vertically-centred slot at the row's end — two separate right-hand
          objects at two different heights. Stacking them is the messaging-app
          anatomy: when it happened on top, and how much of it is unread,
          reading downward in one place.

          ⚠️ BUT NOT PAST `listRowStackFontScale`, and the first version of this
          got that wrong. It retired the old stacked behaviour on the reasoning
          that the stamp "no longer touches the name — it competes with the body
          as a whole, whose preview and name already truncate at one line by
          design". That is false: truncating at one line does not help when the
          LINE is 150pt. At 2× text the stamp measures ~120pt, and with the body
          on `flex: 1` (basis 0) Yoga hands the trailing column its INTRINSIC
          width first — the exact failure `shared/ui/ListRow` spends a paragraph
          documenting. The preview came out at roughly nine characters, worse
          than before this pass, at the setting where it matters most.

          Above the threshold the stamp drops INTO the text column as its own
          line and only the badge stays trailing. `sizes.unreadSlot` is a fixed
          26, so the right edge holds either way. */}
      <View style={styles.meta} testID={`thread-meta-${thread.threadId}`}>
        {!stacked ? (
          <Text style={styles.time} numberOfLines={1}>
            {when}
          </Text>
        ) : null}
        <UnreadBadge
          count={thread.unreadCount}
          testID={unread ? `thread-unread-${thread.threadId}` : undefined}
        />
      </View>
    </Pressable>
  );
}

/**
 * The row's shape while the inbox loads — shares `makeStyles` with the real
 * row, so the two cannot drift.
 *
 * The screen's old hand-copied skeleton had a 48pt circle where the row then
 * had a 64pt tile, and two bars where the row had three lines, so the list
 * visibly resettled the moment threads arrived.
 */
export function ThreadRowSkeleton() {
  const styles = useThemedStyles(makeStyles);
  const { fontScale } = useWindowDimensions();
  const scale = fontScale ?? 1;

  return (
    <View style={styles.row}>
      <View style={styles.lead} />
      <View style={styles.body}>
        {/* The name alone now — the time moved out to the trailing column with
            the badge, so the skeleton's top line follows it there. */}
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonName,
            { height: typography.body.lineHeight * scale },
          ]}
        />
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonCarLine,
            { height: typography.caption.lineHeight * scale },
          ]}
        />
        <View
          style={[
            styles.skeletonBar,
            styles.skeletonPreview,
            { height: typography.body.lineHeight * scale },
          ]}
        />
      </View>
      {/* The trailing column, matching the real row: a time bar over the
          badge's reserved slot, so the skeleton and the row it stands in for
          are the same shape at the same width. */}
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
    // lg (16) AGAIN since 2026-10-19 (owner: "squashed and hard to read"). The
    // 2026-09-04 cut to md bought density; with the car line back the row has
    // three lines, and the inset dividers between rows need air either side.
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    // Inert — the text column (and the 48pt tile) sit well above it — and kept
    // anyway so the two inbox rows declare the same box; see the header.
    minHeight: sizes.touchTarget,
  },
  // ⚠️ surfaceSubtlePressed, NOT surfaceSubtle — which is the lead tile's own
  // resting fill (and PlateChip's, back when the row drew a plate). Pressing in
  // the same colour erases the tile's edge for the duration of the touch.
  rowPressed: {
    backgroundColor: c.surfaceSubtlePressed,
  },
  // The shared inbox lead — a rounded square, matching the notification face's
  // icon tile exactly.
  // ⚠️ A CIRCLE SINCE 2026-09-04 (`radii.full`, was `radii.md`). It is the
  // strongest single "this is a messaging app" signal available to a list row
  // whose lead can never be a face — and the shape is the one part of that
  // convention we CAN take, since the picture itself has to stay the car.
  //
  // ⚠️ IT CROPS THE PHOTO HARDER, and that is the cost. A 4:3 cover photo loses
  // its corners to a 48pt circle. Accepted because the row's job is to say
  // WHICH conversation this is, and a car's colour and silhouette survive the
  // crop — the reason this slot holds the car at full size rather than a 24pt
  // badge is unchanged. If a future photo crop makes cars unidentifiable here,
  // this is the line to revisit, not the tile size.
  lead: {
    width: sizes.inboxRowTile,
    height: sizes.inboxRowTile,
    borderRadius: radii.full,
    // Clips the photo to the circle; also the resting fill behind a slow load.
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
    // ⚠️ THE RING IS NOT DECORATION. Without it this row had THREE circle
    // treatments in one tab: a bare photo here, a ringed CarColourTile on the
    // fallback branch two lines up, and a ringed one on every notification row.
    // The skeleton was worse — surfaceSubtle on background is 1.08:1, so it
    // drew nothing at all while its twin drew a visible ring.
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  body: {
    flex: 1,
    gap: spacing.xs,
  },
  // Time above, unread below — see the note at the render site. `flexShrink: 0`
  // because a truncated timestamp is worse than a truncated preview, and the
  // preview is already one line. Past `listRowStackFontScale` the time is not
  // in here at all, so the column narrows to the badge's fixed 26.
  meta: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    flexShrink: 0,
    // TOP-aligned since 2026-10-19: with three lines of text, a centred column
    // put the time level with the car line instead of the name.
    alignSelf: 'flex-start',
  },
  // The stamp's large-type home: the last line of the text column, where it has
  // the full column width instead of taking ~120pt of it away.
  timeStacked: {
    ...typography.caption,
    color: c.textSecondary,
  },
  name: {
    ...typography.body,
    color: c.textPrimary,
    flexShrink: 1,
  },
  // Family only (Satoshi-Bold) — keep body's 16/24 metrics so the row height doesn't jump
  // between read and unread neighbours.
  nameUnread: {
    fontFamily: typography.cardTitle.fontFamily,
  },
  time: {
    ...typography.caption,
    color: c.textSecondary,
    // Never shrinks — a truncated timestamp is worse than a truncated name.
    flexShrink: 0,
  },
  // Caption + secondary ink: it labels the row, it isn't the message.
  carLine: {
    ...typography.caption,
    color: c.textSecondary,
  },
  // `body`, not `caption`: the message is what you came to read.
  preview: {
    ...typography.body,
    color: c.textSecondary,
  },
  previewUnread: {
    color: c.textPrimary,
  },
  skeletonBar: {
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonName: {
    width: '45%',
  },
  skeletonTime: {
    width: sizes.skeletonTimeBar,
  },
  skeletonCarLine: {
    width: '40%',
  },
  skeletonPreview: {
    width: '85%',
  },
});
