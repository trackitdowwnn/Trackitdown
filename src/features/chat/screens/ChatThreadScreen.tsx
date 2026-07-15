/**
 * WHAT:  ChatThreadScreen — one conversation: header (back, Avatar + first
 *        name), the tappable post-context strip, the inverted message list
 *        (bubbles / system / day separators from messageGroups), the
 *        keyboard-aware composer — removed and replaced by the quiet
 *        ClosedThreadBanner when the post has left 'active' — and the
 *        long-press → report-message sheet.
 * WHY:   The screen stays a composer of tested parts: useThreadMessages owns
 *        realtime + optimistic sending, messageGroups owns ordering, and
 *        the server owns the rules (send_message raises POST_CLOSED even if
 *        a stale client shows the input). PRIVACY: flagging sends the
 *        message ID, never logs content.
 * LINKS: src/features/chat/hooks/useThreadMessages.ts, useThreadMeta.ts;
 *        src/features/chat/lib/messageGroups.ts; docs/DOMAIN.md (Chat).
 */

import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/auth';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  Avatar,
  BottomSheet,
  Button,
  ErrorState,
  SafetyNotice,
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
import { useThreadMeta } from '../hooks/useThreadMeta';
import { useThreadMessages } from '../hooks/useThreadMessages';
import { buildChatList, chatItemKey, type ChatListItem } from '../lib/messageGroups';
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

  const items = useMemo(
    () => buildChatList(messages, outgoing, session.userId ?? ''),
    [messages, outgoing, session.userId],
  );

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
    if (item.type === 'outgoing') return <OutgoingBubble message={item.message} onRetry={retrySend} />;
    if (item.message.kind === 'system') return <SystemMessage message={item.message} />;
    return (
      <MessageBubble
        message={item.message}
        mine={item.mine}
        showTime={item.showTime}
        otherName={otherName}
        onReport={openReport}
      />
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
            their uid, so it isn't returned to the client (see chat types). */}
        <View style={styles.headerIdentity}>
          {meta.thread ? (
            <>
              <Avatar name={meta.thread.other.firstName} />
              <Text style={styles.headerName}>{meta.thread.other.firstName}</Text>
            </>
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
          of a long, paginated thread). */}
      {meta.thread ? (
        <View style={styles.safety}>
          <SafetyNotice />
        </View>
      ) : null}

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
          )}
        </KeyboardAvoidingView>
      )}

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
    gap: spacing.md,
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
