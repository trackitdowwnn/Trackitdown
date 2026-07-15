/**
 * WHAT:  Route /chat/[threadId] — thin wrapper mounting ChatThreadScreen
 *        outside the tabs. Also the reserved deep-link target for the
 *        future notify-message push.
 * WHY:   Route files carry no logic (ARCHITECTURE.md); a missing/invalid
 *        param renders the screen's own not-found handling. Deep links pass
 *        through the auth gate like any entry (AuthGate at the root).
 * LINKS: src/features/chat/screens/ChatThreadScreen.tsx;
 *        src/features/chat/README.md (Unread & notifications).
 */

import { useLocalSearchParams } from 'expo-router';

import { ChatThreadScreen } from '@/features/chat';

export default function ChatThreadRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <ChatThreadScreen threadId={threadId ?? ''} />;
}
