/**
 * WHAT:  ChatThreadScreen — one conversation: ThreadHeader (one row: back, the
 *        car's photo, who you're talking to, the car and its state, and an
 *        owner-only way into their profile), the message list (grouped bubbles
 *        / system / day separators / the single "Seen" from messageGroups, and
 *        an empty state for a thread nobody has written in), the role-aware
 *        quick-reply row, the keyboard-aware composer — removed and replaced by
 *        the quiet ClosedThreadBanner when the post has left 'active' — and the
 *        long-press → report-message sheet.
 *
 *        ⚠️ NO SAFETY NOTICE ON THIS SCREEN since 2026-08-29 (owner decision).
 *        See the inline note where it used to render, and DOMAIN.md (Chat) /
 *        SECURITY_AND_TRUST §1, both amended the same day.
 *
 *        ⚠️ THE CHROME WAS 46% OF THE SCREEN (2026-08-29). A person header sat
 *        above a car strip — two rows of identity for one conversation — and
 *        with the keyboard up fewer than four messages were visible. The header
 *        merge, the removed safety strip and a quick-reply row that steps aside
 *        after the first reply take it to roughly 25%. See
 *        docs/design-refs/chat/GAP_ANALYSIS.md for the arithmetic.
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

import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  ReduceMotion,
} from 'react-native-reanimated';
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
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorState,
  useToast,
  type BottomSheetRef,
} from '@/shared/ui';

import { blockThreadPeer, ChatActionError, flagMessage } from '../api/chatApi';
import { ClosedThreadBanner } from '../components/ClosedThreadBanner';
import { ThreadHeader } from '../components/ThreadHeader';
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
  outgoingGroupPos,
  separatorAbove,
  type ChatListItem,
} from '../lib/messageGroups';
import { quickRepliesFor, shouldShowQuickReplies } from '../lib/quickReplies';
import { MAX_MESSAGE_LENGTH, type ChatMessage } from '../types';

export interface ChatThreadScreenProps {
  threadId: string;
}

export function ChatThreadScreen({ threadId }: ChatThreadScreenProps) {
  const styles = useThemedStyles(makeStyles);
  // ⚠️ ANDROID LIFTS THE COMPOSER ITSELF. Expo SDK 57 forces edge-to-edge, so
  // the window no longer resizes for the keyboard and KeyboardAvoidingView has
  // nothing to avoid — `behavior={undefined}` meant the composer sat UNDER the
  // keyboard on every Android send. The hook returns 0 on iOS, where
  // KeyboardAvoidingView's 'padding' still does the work.
  //
  // ⚠️ THE RAW HEIGHT, NOT height - insets.bottom. This shipped for a few hours
  // with the subtraction, on the theory that the edge-to-edge keyboard height
  // includes the nav-bar region this screen's SafeAreaView has already padded.
  // Every other consumer in the app says otherwise, and they are shipped:
  // StickyActionBar uses `insets.bottom + spacing.md + keyboardHeight`,
  // BottomSheet `insets.bottom + spacing.xl + keyboardLift`, WizardScreen
  // `spacing.sm + keyboardHeight`. All three add the raw value; the first two
  // also add insets.bottom on top, which they could not do if the height
  // already contained it.
  //
  // Those three apply insets.bottom themselves where this screen gets it from
  // `SafeAreaView edges={['top','bottom']}` — so matching them means adding the
  // raw height here. Subtracting made this the only surface in the app that
  // lifts a nav-bar SHORT, i.e. the composer partly under the keyboard.
  //
  // Still device-checkable rather than device-checked: gesture nav and
  // 3-button nav differ, and Jest cannot see either.
  const keyboardHeight = useAndroidKeyboardHeight();
  // The header pads the status bar itself, so the chrome is one continuous
  // surface from the top of the screen rather than a tone step under it.
  const insets = useSafeAreaInsets();
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
  const [justBlocked, setJustBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const blockSheetRef = useRef<BottomSheetRef>(null);
  const blockInFlight = useRef(false);
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

  /**
   * Blocks the other participant. Consequential and not undoable from here —
   * unblocking lives in Settings — so it goes through a confirmation rather
   * than firing on a header tap.
   *
   * ⚠️ NOTHING IS SENT TO THE OTHER PERSON. No message, no push, no system
   * line in the thread. ADR-0017 §5: we never announce a block.
   */
  const confirmBlock = useCallback(async () => {
    // ⚠️ A REF, NOT THE `blocking` STATE. Two presses in the same tick both read
    // the value from the render they were dispatched in, so a state guard sees
    // false twice and fires twice — a sibling screen's test caught exactly
    // that. `blocking` still drives the label and the disabled state; this is
    // what actually guards re-entry.
    if (blockInFlight.current) return;
    blockInFlight.current = true;
    setBlocking(true);
    try {
      await blockThreadPeer(threadId);
      setJustBlocked(true);
      blockSheetRef.current?.close();
    } catch (error) {
      // Narrowed, not `error.message`: chatApi maps machine tokens to calm
      // copy, and anything else must not reach a person verbatim.
      toast.show(
        error instanceof ChatActionError ? error.message : 'We couldn’t do that. Please try again.',
        'error',
      );
    } finally {
      blockInFlight.current = false;
      setBlocking(false);
    }
  }, [threadId, toast]);

  const postClosed = meta.thread ? meta.thread.post.status !== 'active' : false;
  /**
   * The composer is gone for either reason, and the two are deliberately one
   * flag: the server refuses a send in both cases, so a screen that let you
   * type in one of them would be lying about a different thing each time.
   *
   * ⚠️ `peer` is null while it loads, so this starts false and the composer is
   * briefly live on a blocked thread. That is the right way round: the send
   * itself is refused server-side (the messages trigger), so the worst case is
   * one wasted message, whereas defaulting to frozen would hide the composer
   * on every thread for a moment on every open.
   */
  // Optimistic, because useThreadPeer has no refresh and the server is the
  // truth on the next open anyway. Blocking is not undoable from this screen,
  // so there is no state to reconcile back — only forward.
  const blocked = (peer?.blocked ?? false) || justBlocked;
  const closed = postClosed || blocked;
  const otherName = meta.thread?.other.firstName;
  // ⚠️ THE PEER'S ROLE WORD IS NO LONGER DRAWN. It used to sit under their name
  // as "Spotter"/"Owner"; the merged header's second line carries the car and
  // its state instead, which is why the conversation exists, and the role went
  // into ThreadHeader's accessibility label. It is derivable anyway — an owner
  // only ever talks to spotters — and it never changes within one person's app.

  // iOS ignores accessibilityLiveRegion, so announce send failures explicitly.
  useEffect(() => {
    if (sendError) AccessibilityInfo.announceForAccessibility(sendError);
  }, [sendError]);

  const renderItem = ({ item, index }: { item: ChatListItem; index: number }) => {
    if (item.type === 'day') return <DaySeparator label={item.label} />;
    if (item.type === 'outgoing') {
      // A burst of unsent messages is a run of mine, so it groups like one —
      // otherwise each bubble visibly reflows when the server confirms it.
      const position = outgoingGroupPos(outgoing, item.message.localId);
      return (
        <Animated.View entering={arrivalEntering(item)}>
          <OutgoingBubble message={item.message} groupPos={position} onRetry={retrySend} />
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
          // A day rule and a system message already pad 16 below themselves;
          // the bubble beneath one adds nothing of its own.
          afterSeparator={separatorAbove(items, index)}
          seen={item.message.id === seenId}
          otherName={otherName}
          onReport={openReport}
        />
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* ⚠️ ONE ROW OF CHROME, and it carries the status bar itself.
          A person header sat above a car strip — two rows of identity for one
          conversation — and this screen was measured at 46% chrome, with fewer
          than four messages visible once the keyboard was up.

          The SafeAreaView no longer claims the top edge; headerBlock pads by
          insets.top instead (AppHeader does the same). Otherwise `background`
          sat behind the status bar and `surface` began below it — a visible
          tone step at the very top, which is part of what made the chrome read
          as a stack of slabs rather than one object. */}
      <View style={[styles.headerBlock, { paddingTop: insets.top }]}>
        <ThreadHeader
          thread={meta.thread}
          status={meta.status}
          profileAvailable={Boolean(peer?.peer)}
          blocked={blocked}
          onBlock={() => blockSheetRef.current?.open()}
          onBack={() => router.back()}
          onOpenPost={(postId) => router.push(`/post/${postId}`)}
          onOpenProfile={() => void openPeerProfile()}
          onRetry={meta.retry}
        />
      </View>

      {/* ⚠️ NO SAFETY NOTICE ON THIS SCREEN as of 2026-08-29 — owner decision,
          and SECURITY_AND_TRUST §1 was amended the same day rather than left to
          contradict the code. It had been pinned here unconditionally, and the
          server's opening system message carried the same rules; the owner
          asked for both to go.

          ⚠️ THE RULE STILL HOLDS EVERYWHERE ELSE — five surfaces: the
          component on the sighting wizard, post sightings, sighting detail and
          post detail, and the COPY on onboarding, which renders
          SAFETY_RULE_LINE as its own pill. Between them they cover the moment
          somebody is deciding whether to go and look at a car, which is the
          decision the rule exists to reach. Do not treat this file as the
          precedent for removing it from those.

          The quick-reply safety register is untouched: no reply may suggest
          meeting, following, waiting, watching or approaching, and
          quickReplies.test.ts still enforces that lexicon. */}

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
            Platform.OS === 'android' && { paddingBottom: keyboardHeight },
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
            // ⚠️ A THREAD CAN NOW BE EMPTY, and before 2026-08-29 it could not:
            // the server opened every one with a system safety message, so this
            // screen never needed an empty state and did not have one. With
            // that message gone, the first thing a spotter saw after tapping
            // "Message the owner" would have been a blank rectangle.
            //
            // Deliberately plain — no illustration, no encouragement. The
            // person is one tap from writing to a stranger about their stolen
            // car; the screen's job here is to say the floor is not broken and
            // then get out of the way.
            ListEmptyComponent={
              <View style={styles.empty} testID="thread-empty">
                {/* ⚠️ THE PRIMITIVE, not a hand-rolled caption. `EmptyState`'s
                    illustration and action are already optional, so "plain" is
                    its default rather than a reason to bypass it — and rolling
                    it by hand had put the screen's only content in `caption`
                    at `textSecondary`, which on THIS screen is also the day
                    label, the time, "Seen", the system message and the delivery
                    state. The one thing that is not metadata was rendered in
                    the metadata style.

                    ⚠️ ROLE-AWARE, because an owner did not see anything. Owners
                    reach empty threads too — the inbox lists them via
                    previewText's "No messages yet" fallback. */}
                <EmptyState
                  title="No messages yet"
                  body={
                    meta.thread?.role === 'owner'
                      ? 'Ask them what they saw, and where.'
                      : 'Say what you saw, and where.'
                  }
                />
              </View>
            }
            testID="thread-list"
          />

          {sendError ? (
            <Text style={styles.sendError} accessibilityLiveRegion="polite">
              {sendError}
            </Text>
          ) : null}

          {closed ? (
            <ClosedThreadBanner
              status={meta.thread?.post.status ?? 'closed'}
              blocked={blocked}
            />
          ) : (
            /* ⚠️ THE COMPOSER SLIDES INSTEAD OF JUMPING. The quick-reply row
               had an entrance and no exit, so the 52pt beneath it vanished in
               one frame and the composer snapped down — on a screen whose whole
               job is typing. LinearTransition on the wrapper is what makes the
               composer travel rather than teleport; ReduceMotion.System honours
               the OS setting on both. */
            <Animated.View
              layout={LinearTransition.duration(motion.fast).reduceMotion(ReduceMotion.System)}
            >
              {/* One-tap openers for the moment the thread opens — while the
                  input is empty AND before you have said anything yourself.
                  Once you are typing, or once you have spoken, you have found
                  your words and the row stops earning its 52pt. Picking one
                  FILLS the draft (editable) — it never sends. */}
              {meta.thread &&
              shouldShowQuickReplies({
                draft,
                messages,
                outgoing,
                myId: session.userId ?? '',
              }) ? (
                <Animated.View
                  exiting={FadeOut.duration(motion.fast).reduceMotion(ReduceMotion.System)}
                >
                  <QuickReplyRow
                    replies={quickRepliesFor(meta.thread.role)}
                    onPick={setDraft}
                  />
                </Animated.View>
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
            </Animated.View>
          )}
        </KeyboardAvoidingView>
      )}

      {/* The peer's public profile — mounted only after its deferred load;
          the narrow PublicProfile boundary is the only thing rendered. */}
      {PeerSheet ? (
        <PeerSheet ref={peerSheetRef} profile={peerProfile} onDismiss={() => setPeerProfile(null)} />
      ) : null}

      {/* Block sheet. Confirmed rather than fired from the header tap: it stops
          a conversation that may be the owner's only lead on their car, and it
          cannot be undone from this screen. */}
      <BottomSheet ref={blockSheetRef} title={`Block ${otherName ?? 'this person'}?`}>
        <View style={styles.sheetBody}>
          <Text style={styles.sheetText}>
            {/* Says exactly what happens, including the two things people
                assume wrongly: the messages do not disappear, and the other
                person is not told. */}
            Neither of you will be able to send messages. You’ll both still be able to read
            this conversation, and they won’t be told.
          </Text>
          <Text style={styles.sheetText}>
            You can undo this in Settings, under Blocked accounts.
          </Text>
          <Button
            label={blocking ? 'Blocking…' : 'Block'}
            variant="danger"
            disabled={blocking}
            onPress={() => void confirmBlock()}
          />
          <Button
            label="Cancel"
            variant="ghost"
            disabled={blocking}
            onPress={() => blockSheetRef.current?.close()}
          />
        </View>
      </BottomSheet>

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
            {/* ⚠️ SHOW WHICH MESSAGE. Bubbles in a run now sit 4pt apart, so a
                mis-aimed long-press flags the neighbour — and until this line
                the sheet gave no way to tell, on the only moderation route a
                person has. On screen only: flagMessage sends the id and logs no
                content, which is unchanged. */}
            {reporting ? (
              <Text style={styles.sheetQuote} numberOfLines={1} testID="report-quote">
                “{reporting.content}”
              </Text>
            ) : null}
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
  //
  // ⚠️ borderStrong, NOT border. `surface` on `background` separates by fill at
  // about 1.07:1 light and 1.10:1 dark, so the edge IS the boundary — and at
  // `border` that edge is only 1.27:1, under the 3:1 graphic floor. This is the
  // same defect this pass fixed on incoming bubbles and on the safety strip,
  // and it became the whole story when the strip was removed: its bottom
  // hairline went with it, leaving one weak stroke to divide chrome from
  // conversation on the entire screen. Precedent: DESIGN_SYSTEM escalates
  // floating map chrome to borderStrong for exactly this reason.
  headerBlock: {
    backgroundColor: c.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.borderStrong,
  },
  body: {
    flex: 1,
  },
  // ⚠️ lg (16), and the loan it was taken for no longer exists. This was cut to
  // `sm` to fund 8pt for the safety strip; the strip has since been removed, so
  // the creditor is gone. It is repaid with interest rather than merely
  // restored, because at 8 the arithmetic was backwards: `blockPaddingTop` puts
  // 12pt BETWEEN TWO TURNS of conversation, so content-to-chrome was tighter
  // than content-to-content. 16 also matches what the day separator and system
  // message claim for themselves, making the ladder 4 (within a run) < 12
  // (between runs) < 16 (separators, and the list's own edges).
  list: {
    paddingVertical: spacing.lg,
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
  /** A thread nobody has written in yet — see the ListEmptyComponent note.
   *  No gutter of its own: EmptyState pads itself by spacing.xl, and the two
   *  other empty faces on this screen (both ErrorState) sit in `centered`. */
  empty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  /** The message being reported, quoted back so you can see you got the right
   *  one. Full-strength ink: it is the subject of the decision, not chrome. */
  sheetQuote: {
    ...typography.body,
    color: c.textPrimary,
  },
});
