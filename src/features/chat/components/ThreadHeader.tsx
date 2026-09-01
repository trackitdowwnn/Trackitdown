/**
 * WHAT:  ThreadHeader — the whole of a conversation's chrome in ONE row: back,
 *        the car's photo, who you are talking to, which car and its state, and
 *        (owner side only) a way into that person's profile.
 * WHY:   ⚠️ IT REPLACED TWO ROWS WITH ONE, AND THAT WAS THE POINT. A person
 *        header (72pt) sat above a car strip (64pt) — two rows of identity for
 *        one conversation — on a screen that was measured at 46% chrome, where
 *        the keyboard left fewer than four messages visible. One row is 60.5.
 *
 *        ⚠️ THE PERSON IS THE TITLE, the car is the picture and the line
 *        beneath (owner decision, 2026-08-29). An owner with one stolen car and
 *        five sightings has five threads about the SAME car and five different
 *        people, so on the side that matters the person is the only thing that
 *        tells one thread from another. It is also the same anatomy as the
 *        inbox row you tapped to get here — name in the title, car in the
 *        picture and the caption.
 *
 *        ⚠️ TWO TARGETS, AND THE PICTURE IS THE ONE FOR THE CAR. Airbnb splits
 *        a thread header the same way — picture opens the person, words open
 *        the booking — but we cannot have a photograph of the person: their
 *        avatar path embeds their uid, so the API withholds it and always will.
 *        So the currency inverts. A photograph of a car is a self-evident
 *        "open this car", and the profile becomes an explicit trailing button.
 *
 *        That button also fixes something quietly wrong before: the old header
 *        rendered a visually identical block as a Pressable for owners and a
 *        plain View for spotters, so a sighted user could not tell which they
 *        had. A button that is present or absent is honest.
 * LINKS: ../screens/ChatThreadScreen.tsx (the only consumer);
 *        ./ThreadRow.tsx (the inbox row this echoes);
 *        docs/design-refs/chat/REFERENCE_SPEC.md.
 */

import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { AppImage, CarColourTile, statusBadgeLabel } from '@/shared/ui';

import type { InboxThread } from '../types';

/** The car in one phrase — "Blue BMW 3 Series", skipping whatever is missing. */
export function carLabel(post: InboxThread['post']): string {
  return [post.colour, post.make, post.model].filter(Boolean).join(' ');
}

export interface ThreadHeaderProps {
  /** Null while the metadata loads, or when it failed. */
  thread: InboxThread | null;
  status: 'loading' | 'ready' | 'missing' | 'error';
  /** Whether a profile actually exists to open (owner side only). */
  profileAvailable: boolean;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onOpenProfile: () => void;
  onRetry: () => void;
  /**
   * Opens the block confirmation. Present for BOTH roles — an owner may need
   * to block a spotter as readily as the other way round, and guideline 1.2
   * does not care which of them is which.
   */
  onBlock: () => void;
  /** Already blocked: the action becomes unavailable rather than repeating. */
  blocked: boolean;
}

export function ThreadHeader({
  thread,
  status,
  profileAvailable,
  onBack,
  onOpenPost,
  onOpenProfile,
  onRetry,
  onBlock,
  blocked,
}: ThreadHeaderProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={spacing.sm}
        style={styles.back}
        testID="chat-back"
      >
        <Feather name="chevron-left" size={sizes.icon} color={palette.textPrimary} />
      </Pressable>

      {thread ? (
        <ReadyIdentity thread={thread} onOpenPost={onOpenPost} />
      ) : status === 'error' || status === 'missing' ? (
        <DegradedIdentity onRetry={status === 'error' ? onRetry : undefined} />
      ) : (
        <LoadingIdentity />
      )}

      {/* ⚠️ THE SLOT IS RESERVED ON ROLE, NOT ON ARRIVAL. `meta` and `peer` are
          two independent requests, so keying the button on the profile landing
          would pop 44pt into the row a beat after the header drew and shove the
          text column sideways mid-read. `role === 'owner'` is known the moment
          meta lands and is exactly the condition under which a profile will
          eventually exist — the same reserved-slot trick the inbox's unread
          badge uses. Non-interactive until it is real. */}
      {thread?.role === 'owner' ? (
        <Pressable
          onPress={profileAvailable ? onOpenProfile : undefined}
          disabled={!profileAvailable}
          accessibilityRole={profileAvailable ? 'button' : undefined}
          accessibilityLabel={
            profileAvailable ? `View ${thread.other.firstName}’s profile` : undefined
          }
          importantForAccessibility={profileAvailable ? 'auto' : 'no-hide-descendants'}
          style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
          testID="chat-peer-profile"
        >
          <Feather
            name="user"
            size={sizes.icon}
            color={profileAvailable ? palette.textPrimary : palette.textSecondary}
          />
        </Pressable>
      ) : null}

      {/* ⚠️ THE BLOCK ENTRY POINT, and the only one — App Store guideline 1.2
          wants a way to block a person, and this is the one screen where the
          two accounts actually meet. It sits in BOTH roles, unlike the profile
          button beside it: an owner may need to block a spotter as readily as
          the reverse.

          Hidden once blocked rather than shown disabled. A greyed "Block" on an
          already-blocked thread reads as a failed action, and the banner below
          the messages is already saying the true thing. */}
      {thread && !blocked ? (
        <Pressable
          onPress={onBlock}
          accessibilityRole="button"
          // Names the person, because "More options" beside a name is a
          // guessing game for a screen reader user, and this action is
          // consequential enough that it should say what it is.
          accessibilityLabel={`Block ${thread.other.firstName}`}
          accessibilityHint="Stops messages between you. You can undo this in Settings."
          style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
          testID="chat-block"
        >
          <Feather name="slash" size={sizes.icon} color={palette.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The normal case: a car you can open, a person you are talking to. */
function ReadyIdentity({
  thread,
  onOpenPost,
}: {
  thread: InboxThread;
  onOpenPost: (postId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const car = carLabel(thread.post);
  // "Still missing" for an active post — the reason this conversation exists —
  // and the shared status word for every closed state, so chat says it exactly
  // as the feed and post detail do.
  const state = statusBadgeLabel(thread.post.status) ?? 'Still missing';

  return (
    <Pressable
      onPress={() => onOpenPost(thread.postId)}
      accessibilityRole="button"
      // ⚠️ THE ROLE WORD LIVES HERE, not on screen — see the subtitle comment.
      accessibilityLabel={
        `View the post: ${car}. ${state}. ` +
        `You are talking to ${thread.other.firstName}, the ${thread.role}.`
      }
      style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      testID="chat-post-context"
    >
      {thread.post.coverPhotoUrl ? (
        <AppImage
          uri={thread.post.coverPhotoUrl}
          recyclingKey={thread.threadId}
          style={styles.tile}
          testID="chat-car-photo"
        />
      ) : (
        <CarColourTile
          colour={thread.post.colour}
          size={sizes.threadHeaderTile}
          radius={radii.md}
          glyphSize={sizes.icon}
          testID="chat-car-tile"
        />
      )}
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {thread.other.firstName}
        </Text>
        {/* ⚠️ CAR + STATE, and the role word is deliberately NOT here. The line
            has room for about 34 characters; "Spotter · Blue BMW 3 Series ·
            Still missing" is 44 and truncates on every phone. The role is
            derivable — an owner only ever talks to spotters — and never changes
            within one person's app, so it is the cheapest of the three to move
            into the accessibility label. "Still missing" is not: it is why the
            conversation is happening. */}
        {/* ⚠️ TWO LINES, not one. At 200% type `caption` renders around 26pt
            and roughly fifteen characters survive on a 390pt phone — "Blue BMW
            3 Se…" — so the state, which the comment above calls the reason the
            conversation exists, disappears at exactly the accessibility setting
            where it matters. The safety strip reached the same conclusion
            earlier today: let it grow rather than truncate the load-bearing
            half. The row is content, not chrome. */}
        <Text style={styles.subtitle} numberOfLines={2}>
          {car} · {state}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Metadata failed. Keeps the row's exact height so nothing resettles, and keeps
 * a way to ask again.
 *
 * The words are pinned by ChatThreadScreen.test.tsx — "Conversation" and
 * "Try again" are asserted verbatim.
 */
function DegradedIdentity({ onRetry }: { onRetry?: () => void }) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.identity}>
      <View style={[styles.tile, styles.tileEmpty]} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          Conversation
        </Text>
        {/* ⚠️ A REAL 44pt BOX, not hitSlop. This was `label` (18pt) plus 8pt of
            slop — 34, under the floor — and the message list is drawn AFTER the
            header block, so the downward half of that slop is claimed by the
            sibling before it ever reaches here. Exactly the defect a review
            caught on the safety strip earlier today, in this same feature. It
            is also the sole route back from a metadata failure. */}
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading the conversation details"
            style={styles.retryTarget}
            testID="chat-meta-retry"
          >
            <Text style={styles.retry}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The header's own shape while metadata loads — the same box, so the real
 * header replaces it without moving anything.
 *
 * Static, per the design system: skeleton placeholders in `surfaceSubtle`, no
 * spinners, no shimmer.
 */
function LoadingIdentity() {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.identity} testID="thread-header-skeleton">
      <View style={[styles.tile, styles.tileEmpty]} />
      <View style={styles.text}>
        <View style={[styles.bar, styles.barName]} />
        <View style={[styles.bar, styles.barSubtitle]} />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
    },
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      // Pulls the 24pt chevron's optical left edge to ~22 against the 24pt
      // gutter; centred in its 44pt box it would sit 10pt inside every other
      // left edge on the screen.
      marginLeft: -spacing.md,
    },
    identity: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingRight: spacing.sm,
      borderRadius: radii.md,
    },
    tile: {
      width: sizes.threadHeaderTile,
      height: sizes.threadHeaderTile,
      borderRadius: radii.md,
      overflow: 'hidden',
    },
    tileEmpty: {
      backgroundColor: c.surfaceSubtle,
    },
    text: {
      flex: 1,
    },
    name: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    subtitle: {
      ...typography.caption,
      color: c.textSecondary,
    },
    retryTarget: {
      minHeight: sizes.touchTarget,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    retry: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
    profile: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.full,
      // Mirrors the back button's optical inset on the trailing edge.
      marginRight: -spacing.md,
    },
    pressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    bar: {
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    barName: {
      height: typography.cardTitle.lineHeight,
      width: '40%',
    },
    barSubtitle: {
      height: typography.caption.lineHeight,
      width: '65%',
      marginTop: spacing.xs,
    },
  });
