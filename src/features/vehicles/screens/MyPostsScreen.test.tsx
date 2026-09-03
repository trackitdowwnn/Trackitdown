/**
 * WHAT:  Orchestration tests for MyPostsScreen — the state switch (signed-out
 *        invite / loading / error / empty / populated) and that cards route to
 *        the post. The list data + mapping are tested in myPostsApi; this proves
 *        the screen wires useMyPosts + session to the right surface.
 * WHY:   Each state is a hole if unhandled (an owner with no posts must get a
 *        warm empty state + a way to post, not a blank screen), so the branch is
 *        pinned here.
 * LINKS: src/features/vehicles/screens/MyPostsScreen.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import type { PostSummary } from '@/shared/types';

import { MyPostsScreen } from './MyPostsScreen';

const mockUseMyPosts = jest.fn();
jest.mock('../hooks/useMyPosts', () => ({
  useMyPosts: () => mockUseMyPosts(),
}));

// ADR-0019's nudge. Mocked at the HOOK, so the api module — and with it the
// supabase client — never enters this suite's import graph.
const mockUseStillMissingAsks = jest.fn(() => [] as { postId: string }[]);
jest.mock('../hooks/useStillMissingAsk', () => ({
  useStillMissingAsks: () => mockUseStillMissingAsks(),
}));

const mockUseSession = jest.fn();
const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockUseSession(),
  useRequireAuth: () => mockRequireAuth,
}));

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    VehicleCard: ({ post, onPress }: { post: PostSummary; onPress: () => void }) => (
      <Pressable testID={`card-${post.id}`} onPress={onPress}>
        <Text>{post.make}</Text>
      </Pressable>
    ),
    SkeletonVehicleCard: () => <View testID="skeleton" />,
    EmptyState: ({
      title,
      actionLabel,
      onAction,
    }: {
      title: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => (
      <View testID="empty">
        <Text>{title}</Text>
        {actionLabel ? (
          <Pressable testID="empty-action" onPress={onAction}>
            <Text>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    ),
    ErrorState: ({ onRetry }: { onRetry?: () => void }) => (
      <Pressable testID="error-retry" onPress={onRetry}>
        <Text>error</Text>
      </Pressable>
    ),
    NudgeRow: ({ title, body, onPress }: { title: string; body: string; onPress: () => void }) => (
      <Pressable testID="still-missing-nudge" onPress={onPress}>
        <Text>{title}</Text>
        <Text>{body}</Text>
      </Pressable>
    ),
    ThemedRefreshControl: () => null,
  };
});

const post: PostSummary = {
  id: 'p1',
  photos: [],
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'draft',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 50000,
};

function base() {
  return { status: 'ready', posts: [], refreshing: false, refresh: jest.fn(), retry: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
});

describe('MyPostsScreen', () => {
  it('invites a guest to log in with the my_posts context', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut', userId: null });
    mockUseMyPosts.mockReturnValue(base());
    const { getByText, getByTestId } = await render(<MyPostsScreen />);
    expect(getByText('Your posts live here')).toBeTruthy();
    fireEvent.press(getByTestId('empty-action'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'my_posts' });
  });

  it('shows skeletons while loading', async () => {
    mockUseMyPosts.mockReturnValue({ ...base(), status: 'loading' });
    const { getAllByTestId } = await render(<MyPostsScreen />);
    expect(getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('shows a retryable error', async () => {
    const retry = jest.fn();
    mockUseMyPosts.mockReturnValue({ ...base(), status: 'error', retry });
    const { getByTestId } = await render(<MyPostsScreen />);
    fireEvent.press(getByTestId('error-retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('offers a warm empty state that routes to post-a-car', async () => {
    mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [] });
    const { getByText, getByTestId } = await render(<MyPostsScreen />);
    expect(getByText('No posts yet')).toBeTruthy();
    fireEvent.press(getByTestId('empty-action'));
    expect(mockPush).toHaveBeenCalledWith('/post-a-car');
  });

  it('renders cards and opens the post on tap', async () => {
    mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post] });
    const { getByTestId } = await render(<MyPostsScreen />);
    fireEvent.press(getByTestId('card-p1'));
    expect(mockPush).toHaveBeenCalledWith('/post/p1');
  });

  // ADR-0019's second door: someone who has drifted away from a listing opens
  // this page, not the listing.
  describe('the "still missing?" nudge', () => {
    beforeEach(() => {
      mockPush.mockClear();
      mockUseStillMissingAsks.mockReturnValue([]);
    });

    it('is absent when nothing is outstanding', async () => {
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post] });
      const { queryByTestId } = await render(<MyPostsScreen />);
      expect(queryByTestId('still-missing-nudge')).toBeNull();
    });

    it('opens the post that is being asked about', async () => {
      mockUseStillMissingAsks.mockReturnValue([{ postId: 'p1' }]);
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post] });
      const { getByTestId, getByText } = await render(<MyPostsScreen />);
      expect(getByText('Tap to answer')).toBeTruthy();
      fireEvent.press(getByTestId('still-missing-nudge'));
      expect(mockPush).toHaveBeenCalledWith('/post/p1');
    });

    it('says where the tap lands when more than one is outstanding', async () => {
      // Rare — it needs two live listings AND silence on both — but "2
      // listings" would imply a list this tap does not open.
      mockUseStillMissingAsks.mockReturnValue([{ postId: 'p1' }, { postId: 'p2' }]);
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post] });
      const { getByText, getByTestId } = await render(<MyPostsScreen />);
      expect(getByText('Tap to answer the first of 2')).toBeTruthy();
      fireEvent.press(getByTestId('still-missing-nudge'));
      expect(mockPush).toHaveBeenCalledWith('/post/p1');
    });
  });
});
