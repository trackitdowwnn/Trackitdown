/**
 * WHAT:  ChatThreadScreen — one conversation: the header BLOCK (back, Avatar,
 *        first name + their role, tappable → the peer's public profile sheet,
 *        and the tappable post-context strip, sharing one surface), the pinned
 *        collapsible SafetyNotice, the message list (grouped bubbles / system /
 *        day separators / the single "Seen" from messageGroups), the
 *        role-aware quick-reply row, the keyboard-aware composer — removed
 *        and replaced by the quiet ClosedThreadBanner when the post has
 *        left 'active' — and the long-press → report-message sheet.
 * WHY:   The screen stays a composer of tested parts: useThreadMessages owns
 *        realtime + optimistic sending, messageGroups owns ordering/Seen
 *        maths, quickReplies owns the copy and its safety rules, and the
 *        server owns the rules (send_message raises POST_CLOSED even if a
 *        stale client shows the input). PRIVACY: flagging sends the message
 *        ID, never logs content; the peer's profile opens through the
 *        narrow PublicProfile boundary only.
 *
 *        The profile feature is loaded at TAP time via a deferred import:
 *        a static `chat → profile` edge would close a require cycle
 *        (profile → garage → vehicles → chat), and Metro's cycle warnings
 *        exist because such values can initialise undefined. Same precedent
 *        as PostSightingsScreen's deferred import of this feature.
 * LINKS: src/features/chat/hooks/useThreadMessages.ts, useThreadMeta.ts,
 *        useThreadPeer.ts; src/features/chat/lib/messageGroups.ts,
 *        quickReplies.ts; docs/DOMAIN.md (Chat).
 */

import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth';
// Type-only: erased at runtime, so it does NOT create the require cycle the
// deferred import below exists to avoid.
import type { PublicProfileSheetProps } from '@/features/profile';
import { useAndroidKeyboardHeight } from '@/shared/hooks';
import {
  motion,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Avatar,
  BottomSheet,
  Button,
  ErrorState,
  SafetyNotice,
  useToast,
  type BottomSheetRef,
} from '@/shared/ui';

import { flagMessage } from '../api/chatApi';
import { ClosedThreadBanner, PostContextStrip } from '../components/PostContextStrip';
import {
  DaySeparator,
  MessageBubble,
  OutgoingBubble,
  SystemMessage,
} from '../components/chatThreadItems';
import { MessageInputBar } from '../components/MessageInputBar';
import { QuickReplyRow } from '../components/QuickReplyRow';
import { useThreadMeta } from '../hooks/useThreadMeta';
import { useThreadMessages } from '../hooks/useThreadMessages';
import { useThreadPeer } from '../hooks/useThreadPeer';
import {
  buildChatList,
  chatItemKey,
  latestSeenOutboundId,
  type ChatListItem,
} from '../lib/messageGroups';
import { quickRepliesFor } from '../lib/quickReplies';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '../types';

export interface ChatThreadScreenProps {
  threadId: string;
}

export function ChatThreadScreen({ threadId }: ChatThreadScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  // ⚠️ ANDROID LIFTS THE COMPOSER ITSELF. Expo SDK 57 forces edge-to-edge, so
  // the window no longer resizes for the keyboard and KeyboardAvoidingView has
  // nothing to avoid — `behavior={undefined}` meant the composer sat UNDER the
  // keyboard on every Android send. The hook returns 0 on iOS, where
  // KeyboardAvoidingView's 'padding' still does the work.
  //
  // ⚠️ MINUS insets.bottom, and the subtraction is load-bearing: this screen's
  // SafeAreaView already applies the bottom inset, while the edge-to-edge
  // keyboard height INCLUDES the nav-bar region. Adding the raw height would
  // float the composer a nav-bar above the keyboard. Needs a real device on
  // both gesture and 3-button navigation — Jest cannot see this.
  const insets = useSafeAreaInsets();
  const keyboardHeight = useAndroidKeyboardHeight();
  const androidKeyboardLift = Math.max(0, keyboardHeight - insets.bottom);
  const router = useRouter();
  const session = useSession();
  const meta = useThreadMeta(threadId);
  const {
    status,
    messages,
    outgoing,
    hasOlder,
    sendError,
    send,
    retrySend,
    loadOlder,
    retry,
  } = useThreadMessages(threadId);

  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [reported, setReported] = useState(false);
  const sheetRef = useRef<BottomSheetRef>(null);
  const toast = useToast();

  const items = useMemo(
    () => buildChatList(messages, outgoing, session.userId ?? ''),
    [messages, outgoing, session.userId],
  );

  // The peer's read marker + (owner side only) their narrow passport, via
  // the get_thread_peer RPC — no uid ever reaches this screen (security
  // review H1). Refreshed on focus. Seen = the newest of MY messages their
  // marker covers — at most one caption in the whole thread.
  const peer = useThreadPeer(threadId);
  const seenId = useMemo(
    () => latestSeenOutboundId(messages, session.userId ?? '', peer?.theirLastReadAt ?? null),
    [messages, session.userId, peer],
  );

  // --- Peer profile sheet (component deferred-loaded; see the cycle note) ---
  // The PROFILE DATA is already here (it rode the RPC); only the sheet
  // component loads lazily. Owner-side only: peer.peer is null for spotters —
  // owner identity is never exposed (DOMAIN.md; security review M2).
  const [PeerSheet, setPeerSheet] = useState<ComponentType<PublicProfileSheetProps> | null>(null);
  const [peerProfile, setPeerProfile] = useState<PublicProfileSheetProps['profile']>(null);
  const peerSheetRef = useRef<BottomSheetRef>(null);

  const openPeerProfile = async () => {
    if (!peer?.peer) return;
    try {
      const profileFeature = await import('@/features/profile');
      setPeerSheet(() => profileFeature.PublicProfileSheet);
      setPeerProfile(peer.peer);
    } catch {
      toast.show('We couldn’t open their profile just now.', 'error');
    }
  };

  // Open once both the lazily-loaded sheet and its data are mounted.
  useEffect(() => {
    if (PeerSheet && peerProfile) {
      peerSheetRef.current?.open();
    }
  }, [PeerSheet, peerProfile]);

  // --- Arrival motion --------------------------------------------------------
  // Keys present at first ready never animate (history must not cascade);
  // later arrivals fade in once, then age out of "new" after the entrance so
  // a recycled cell scrolling back on screen doesn't replay it. My CONFIRMED
  // sends never animate at all — they visually replace the optimistic bubble
  // in place, and animating the swap would read as a double send.
  const initialIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (status === 'ready' && initialIds.current === null) {
      initialIds.current = new Set(items.map(chatItemKey));
    }
  }, [status, items]);
  useEffect(() => {
    const known = initialIds.current;
    if (known === null) return;
    const timer = setTimeout(() => {
      items.forEach((item) => known.add(chatItemKey(item)));
    }, motion.standard);
    return () => clearTimeout(timer);
  }, [items]);

  const arrivalEntering = (item: ChatListItem) => {
    const known = initialIds.current;
    const isNew = known !== null && !known.has(chatItemKey(item));
    const animates =
      isNew && (item.type === 'outgoing' || (item.type === 'message' && !item.mine));
    return animates
      ? FadeInDown.duration(motion.fast).reduceMotion(ReduceMotion.System)
      : undefined;
  };

  const openReport = (message: ChatMessage) => {
    setReporting(message);
    setReported(false);
    sheetRef.current?.open();
  };

  const submitReport = async () => {
    if (!reporting) return;
    try {
      await flagMessage(reporting.id);
      setReported(true);
    } catch {
      // The sheet stays open; the action can simply be tapped again.
    }
  };

  const closed = meta.thread ? meta.thread.post.status !== 'active' : false;
  const otherName = meta.thread?.other.firstName;
  // Who the OTHER person is, in one word under their name. `role` is MINE, so
  // theirs is the opposite — and it is the single most useful thing to know at
  // a glance here: whether you are reading the person who lost the car or the
  // person who spotted it.
  const peerRoleLabel = meta.thread?.role === 'owner' ? 'Spotter' : 'Owner';

  // iOS ignores accessibilityLiveRegion, so announce send failures explicitly.
  useEffect(() => {
    if (sendError) AccessibilityInfo.announceForAccessibility(sendError);
  }, [sendError]);

  const renderItem = ({ item }: { item: ChatListItem }) => {
    if (item.type === 'day') return <DaySeparator label={item.label} />;
    if (item.type === 'outgoing') {
      return (
        <Animated.View entering={arrivalEntering(item)}>
          <OutgoingBubble message={item.message} onRetry={retrySend} />
        </Animated.View>
      );
    }
    if (item.message.kind === 'system') return <SystemMessage message={item.message} />;
    return (
      <Animated.View entering={arrivalEntering(item)}>
        <MessageBubble
          message={item.message}
          mine={item.mine}
          showTime={item.showTime}
          groupPos={item.groupPos}
          seen={item.message.id === seenId}
          otherName={otherName}
          onReport={openReport}
        />
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* ONE header block: the person and the car they're talking about are a
          single unit of context, so they share a surface and end on a single
          hairline. (They used to be two slabs on two different backgrounds
          with a rule between them, which read as unrelated furniture.) */}
      <View style={styles.headerBlock}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={spacing.sm}
            style={styles.back}
            testID="chat-back"
          >
            <Feather name="chevron-left" size={sizes.icon} color={palette.textPrimary} />
          </Pressable>
          {/* Initial-letter avatar only — the other party's avatar path embeds
              their uid, so it isn't returned to the client (see chat types).
              For the OWNER the name is tappable → the spotter's first-name +
              reputation passport (the same one a sighting shows). A spotter's
              header is plain text: owner identity is never exposed. */}
          <View style={styles.headerIdentity}>
            {meta.thread ? (
              peer?.peer ? (
                <Pressable
                  onPress={() => void openPeerProfile()}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${meta.thread.other.firstName}’s profile`}
                  style={({ pressed }) => [
                    styles.headerPerson,
                    pressed && styles.headerPersonPressed,
                  ]}
                  testID="chat-peer-profile"
                >
                  <Avatar name={meta.thread.other.firstName} />
                  <View style={styles.headerText}>
                    <Text style={styles.headerName} numberOfLines={1}>
                      {meta.thread.other.firstName}
                    </Text>
                    <Text style={styles.headerRole}>{peerRoleLabel}</Text>
                  </View>
                </Pressable>
              ) : (
                <View style={styles.headerPerson}>
                  <Avatar name={meta.thread.other.firstName} />
                  <View style={styles.headerText}>
                    <Text style={styles.headerName} numberOfLines={1}>
                      {meta.thread.other.firstName}
                    </Text>
                    <Text style={styles.headerRole}>{peerRoleLabel}</Text>
                  </View>
                </View>
              )
            ) : meta.status === 'error' ? (
              /* ⚠️ THE HEADER'S OWN ERROR STATE. `useThreadMeta` can return
                 'error' as well as 'missing' (a network failure is 'error' —
                 useThreadMeta.test.tsx pins that), and only 'missing' was ever
                 branched below. The result was a header block containing a back
                 button and nothing else, with no way to ask again.

                 NOT a full-screen ErrorState: the MESSAGES load on their own
                 hook and are usually fine, and SafetyNotice must render on
                 every thread regardless (security review M1). Only the identity
                 the failed call would have supplied is missing, so only that
                 slot degrades. */
              <View style={styles.headerFallback}>
                <Text style={styles.headerName} numberOfLines={1}>
                  Conversation
                </Text>
                <Pressable
                  onPress={meta.retry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading the conversation details"
                  hitSlop={spacing.sm}
                  style={({ pressed }) => [pressed && styles.headerPersonPressed]}
                  testID="chat-meta-retry"
                >
                  <Text style={styles.headerRetry}>Try again</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {meta.thread ? (
          <PostContextStrip
            thread={meta.thread}
            onPress={(postId) => router.push(`/post/${postId}`)}
          />
        ) : null}
      </View>

      {/* SECURITY_AND_TRUST §1: the SafetyNotice appears on every chat thread —
          pinned here, not only as the system first message (which scrolls out
          of a long, paginated thread). UNCONDITIONAL: meta comes from
          get_inbox while messages load separately, and a transient meta
          failure must never produce a conversation without the notice
          (security review M1). It needs nothing from meta anyway.

          COLLAPSIBLE here and nowhere else: this is the one surface where the
          notice sits above LIVE content for a whole session rather than being
          read once in a flow, and at full height it cost ~100dp of every
          thread — with the keyboard up, most of the conversation. It is still
          pinned, still undismissable, and still reads in full to a screen
          reader; only the elaboration folds. */}
      <SafetyNotice collapsible />

      {meta.status === 'missing' ? (
        <View style={styles.centered}>
          <ErrorState
            title="This conversation isn’t available"
            body="It may have been closed, or you don’t have access."
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      ) : status === 'error' ? (
        <View style={styles.centered}>
          <ErrorState
            title="We couldn’t load this conversation"
            body="Check your connection and try again."
            onRetry={retry}
          />
        </View>
      ) : status === 'loading' ? (
        <View style={styles.loading} testID="thread-skeleton" accessibilityLabel="Loading messages">
          {[
            { mine: false },
            { mine: true },
            { mine: false },
            { mine: true },
          ].map((row, index) => (
            <View
              key={index}
              style={[
                styles.skeletonBubble,
                row.mine ? styles.skeletonMine : styles.skeletonTheirs,
              ]}
            />
          ))}
        </View>
      ) : (
        <KeyboardAvoidingView
          style={[
            styles.body,
            Platform.OS === 'android' && { paddingBottom: androidKeyboardLift },
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlashList
            data={items}
            keyExtractor={chatItemKey}
            renderItem={renderItem}
            // FlashList v2 chat pattern: natural reading order, rendered
            // from the bottom (no `inverted` in v2). Older pages load when
            // the user scrolls up toward the START of the content.
            maintainVisibleContentPosition={{ startRenderingFromBottom: true }}
            onStartReached={hasOlder ? () => void loadOlder() : undefined}
            onStartReachedThreshold={0.4}
            contentContainerStyle={styles.list}
            testID="thread-list"
          />

          {sendError ? (
            <Text style={styles.sendError} accessibilityLiveRegion="polite">
              {sendError}
            </Text>
          ) : null}

          {closed ? (
            <ClosedThreadBanner status={meta.thread?.post.status ?? 'closed'} />
          ) : (
            <>
              {/* One-tap openers, shown only while the input is EMPTY: once
                  someone is typing they've found their words. Picking one
                  FILLS the draft (editable) — it never sends. */}
              {meta.thread && draft.trim().length === 0 ? (
                <QuickReplyRow
                  replies={quickRepliesFor(meta.thread.role)}
                  onPick={setDraft}
                />
              ) : null}
              <MessageInputBar
                value={draft}
                onChangeText={setDraft}
                onSend={() => {
                  // Clear the draft ONLY when the message was actually queued
                  // (send returns false for empty) — never lose typed text.
                  if (send(draft)) setDraft('');
                }}
                maxLength={MAX_MESSAGE_LENGTH}
              />
            </>
          )}
        </KeyboardAvoidingView>
      )}

      {/* The peer's public profile — mounted only after its deferred load;
          the narrow PublicProfile boundary is the only thing rendered. */}
      {PeerSheet ? (
        <PeerSheet ref={peerSheetRef} profile={peerProfile} onDismiss={() => setPeerProfile(null)} />
      ) : null}

      {/* Report sheet — the flag action (moderation queue reads the table). */}
      <BottomSheet ref={sheetRef} title="Report this message" onDismiss={() => setReporting(null)}>
        {reported ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>
              Reported — thank you. Our team will take a look.
            </Text>
            <Button label="Done" variant="ghost" onPress={() => sheetRef.current?.close()} />
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetText}>
              This sends the message to our moderation team. The other person isn’t told.
            </Text>
            <Button label="Report message" variant="danger" onPress={() => void submitReport()} />
            <Button label="Cancel" variant="ghost" onPress={() => sheetRef.current?.close()} />
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  // Person + car as one surface, closed by one hairline.
  headerBlock: {
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // ⚠️ spacing.xl, matching PostContextStrip directly beneath it. At
    // spacing.md the two halves of ONE surface had two different left edges,
    // 12 and 24, which is visible as a step the moment the strip has a
    // thumbnail.
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the 24pt chevron's optical left edge back to ~22 against the 24pt
    // text gutter — an icon centred in a 44pt box would otherwise sit 10pt
    // inside every other left edge on the screen.
    marginLeft: -spacing.md,
  },
  headerIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    // Breathing room that doubles as the touch target's slack.
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
    borderRadius: radii.md,
  },
  headerPersonPressed: {
    backgroundColor: c.surfaceSubtle,
  },
  // The degraded identity slot — see the 'error' branch in the header.
  headerFallback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  // Underlined because it is tappable; the design system reserves underline
  // for exactly that.
  headerRetry: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  headerText: {
    flex: 1,
  },
  // cardTitle, not heading: with the role line beneath it, 18/24 Bold made the
  // identity block top-heavy against a 13pt caption.
  headerName: {
    ...typography.cardTitle,
    color: c.textPrimary,
  },
  headerRole: {
    ...typography.caption,
    color: c.textSecondary,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingVertical: spacing.md,
  },
  // ⚠️ NO PADDING OF ITS OWN — EmptyState/ErrorState already pad by spacing.xl,
  // and this added a second 24 per side. Same fix as both inbox faces.
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loading: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  skeletonBubble: {
    height: sizes.skeletonBubble,
    width: '70%',
    borderRadius: radii.lg,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonMine: {
    alignSelf: 'flex-end',
  },
  skeletonTheirs: {
    alignSelf: 'flex-start',
  },
  sendError: {
    ...typography.caption,
    color: c.danger,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  sheetBody: {
    gap: spacing.md,
  },
  sheetText: {
    ...typography.body,
    color: c.textSecondary,
  },
});
