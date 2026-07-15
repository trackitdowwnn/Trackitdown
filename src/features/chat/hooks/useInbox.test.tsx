/**
 * WHAT:  Tests for useInbox — load → badge propagation (the unread total
 *        lands on the 'inbox' tab badge), refetch-on-refocus, and the
 *        never-blank rule (a failed focus refetch keeps the shown list).
 * WHY:   The badge is the app-wide unread signal and the never-blank rule
 *        is what makes refetch-on-focus safe as the v1 freshness mechanism.
 * LINKS: src/features/chat/hooks/useInbox.ts, docs/TESTING.md.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { TabBadgeProvider, useTabBadges } from '@/shared/ui';

import type { InboxThread } from '../types';
import { useInbox } from './useInbox';

const mockFetchInbox = jest.fn();
jest.mock('../api/chatApi', () => ({
  fetchInbox: (...args: unknown[]) => mockFetchInbox(...args),
}));

// Focus effect fires once like a mounted, focused tab (the refetch-on-
// REfocus path shares load() with refresh(), which the tests below drive).
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    const { useEffect } = require('react');
    useEffect(() => {
      effect();
    }, [effect]);
  },
}));

const thread = (unread: number, id: string): InboxThread => ({
  threadId: id,
  postId: 'p1',
  role: 'owner',
  lastMessageAt: '2026-07-15T10:00:00Z',
  lastMessagePreview: 'hi',
  unreadCount: unread,
  post: { make: 'BMW', model: '3', colour: null, plate: null, status: 'active', coverPhotoUrl: null },
  other: { firstName: 'Sam' },
});

/** Renders useInbox inside the badge provider and exposes both. */
function useHarness() {
  const inbox = useInbox();
  const { badges } = useTabBadges();
  return { inbox, badges };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TabBadgeProvider>{children}</TabBadgeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useInbox', () => {
  it('loads threads and propagates the unread total to the inbox badge', async () => {
    mockFetchInbox.mockResolvedValue([thread(2, 't1'), thread(3, 't2')]);
    const { result } = await renderHook(useHarness, { wrapper });
    await waitFor(() => expect(result.current.inbox.status).toBe('ready'));
    expect(result.current.inbox.threads).toHaveLength(2);
    expect(result.current.badges.inbox).toBe(5);
  });

  it('a failed refetch NEVER blanks an already-shown list', async () => {
    mockFetchInbox.mockResolvedValueOnce([thread(1, 't1')]);
    const { result } = await renderHook(useHarness, { wrapper });
    await waitFor(() => expect(result.current.inbox.status).toBe('ready'));

    mockFetchInbox.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      result.current.inbox.refresh();
    });
    expect(result.current.inbox.status).toBe('ready'); // list stays
    expect(result.current.inbox.threads).toHaveLength(1);
  });

  it('surfaces error only when there was never anything to show', async () => {
    mockFetchInbox.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(useHarness, { wrapper });
    await waitFor(() => expect(result.current.inbox.status).toBe('error'));
    mockFetchInbox.mockResolvedValue([thread(0, 't1')]);
    await act(async () => {
      result.current.inbox.retry();
    });
    await waitFor(() => expect(result.current.inbox.status).toBe('ready'));
  });
});
