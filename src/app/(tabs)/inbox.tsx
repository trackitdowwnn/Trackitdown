/**
 * WHAT:  Inbox tab — guest-aware route: guests get a friendly invitation
 *        through the auth gate; signed-in users get the chat inbox
 *        (features/chat: thread list, unread badge, refetch-on-focus).
 * WHY:   Guests browse freely (deferred auth), so tabs never wall or
 *        auto-fire the auth sheet — they explain what lives here and offer
 *        "Log in" through the same gate as every action (tab_inbox
 *        context). The route stays thin: all inbox behaviour lives in
 *        ChatInboxScreen.
 * LINKS: src/features/chat (ChatInboxScreen); src/features/auth
 *        (useRequireAuth, useSession); src/app/(tabs)/_layout.tsx.
 */

import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { ChatInboxScreen } from '@/features/chat';
import { colors } from '@/shared/theme';
import { EmptyState } from '@/shared/ui';

export default function InboxScreen() {
  const session = useSession();
  const requireAuth = useRequireAuth();

  if (session.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          title="Your messages live here"
          body="When you report a sighting, you and the owner can chat about it — safely, in the app."
          actionLabel="Log in"
          // No continuation: the tab re-renders signed-in reactively.
          onAction={() => requireAuth({ context: 'tab_inbox' })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ChatInboxScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
