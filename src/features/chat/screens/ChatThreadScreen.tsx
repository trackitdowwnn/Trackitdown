/**
 * WHAT:  ChatThreadScreen — one conversation: header (back, Avatar + first
 *        name, tappable → the peer's public profile sheet), the tappable
 *        post-context strip, the message list (grouped bubbles / system /
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth';
// Type-only: erased at runtime, so it does NOT create the require cycle the
// deferred import below exists to avoid.
import type { PublicProfileSheetProps } from '@/features/profile';
import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';
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
      {/* Header: back + the other person. */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={spacing.sm}
          style={styles.back}
          testID="chat-back"
        >
          <Feather name="chevron-left" size={sizes.icon} color={colors.textPrimary} />
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
                style={({ pressed }) => [styles.headerPerson, pressed && styles.headerPersonPressed]}
                testID="chat-peer-profile"
              >
                <Avatar name={meta.thread.other.firstName} />
                <Text style={styles.headerName}>{meta.thread.other.firstName}</Text>
              </Pressable>
            ) : (
              <View style={styles.headerPerson}>
                <Avatar name={meta.thread.other.firstName} />
                <Text style={styles.headerName}>{meta.thread.other.firstName}</Text>
              </View>
            )
          ) : null}
        </View>
      </View>

      {meta.thread ? (
        <PostContextStrip
          thread={meta.thread}
          onPress={(postId) => router.push(`/post/${postId}`)}
        />
      ) : null}

      {/* SECURITY_AND_TRUST §1: the SafetyNotice appears on every chat thread —
          pinned here, not only as the system first message (which scrolls out
          of a long, paginated thread). UNCONDITIONAL: meta comes from
          get_inbox while messages load separately, and a transient meta
          failure must never produce a conversation without the notice
          (security review M1). It needs nothing from meta anyway. */}
      <View style={styles.safety}>
        <SafetyNotice />
      </View>

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
          style={styles.body}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: colors.surfaceSubtle,
  },
  headerName: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  safety: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingVertical: spacing.md,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  loading: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  skeletonBubble: {
    height: sizes.avatarLg,
    width: '70%',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonMine: {
    alignSelf: 'flex-end',
  },
  skeletonTheirs: {
    alignSelf: 'flex-start',
  },
  sendError: {
    ...typography.caption,
    color: colors.danger,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xs,
  },
  sheetBody: {
    gap: spacing.md,
  },
  sheetText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
