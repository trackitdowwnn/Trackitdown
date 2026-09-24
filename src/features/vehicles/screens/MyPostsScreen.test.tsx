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

import { act, fireEvent, render } from '@testing-library/react-native';

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
    VehicleCard: ({
      post,
      onPress,
      onLongPress,
    }: {
      post: PostSummary;
      onPress: () => void;
      onLongPress?: () => void;
    }) => (
      <Pressable testID={`card-${post.id}`} onPress={onPress} onLongPress={onLongPress}>
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
    // ONE stable object, like the real ToastProvider's memoised value — a fresh
    // object per render would re-run toast effects and hide a repeat-toast bug.
    useToast: () => mockToastApi,
  };
});

const mockToast = jest.fn();
const mockToastApi = { show: (...args: unknown[]) => mockToast(...args) };

// The long-press manager. The real PostOwnerActions (sheet, confirms, editors)
// is covered through PostDetailScreen's suite; here only "is the sheet raised
// over the list, for the right listing" matters — so a stand-in records the
// post it was given and exposes openManage.
const mockOpenManage = jest.fn();
const mockOwnerPost = jest.fn();
const mockIsBusy = jest.fn(() => false);
// The last props the manager handed PostOwnerActions — to fire its onDeleted.
let mockOwnerProps: { onDeleted: () => void; refresh: () => void } | null = null;
jest.mock('../components/PostOwnerActions', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  return {
    PostOwnerActions: React.forwardRef(function MockOwnerActions(
      props: { postId: string; post: unknown; onDeleted: () => void; refresh: () => void },
      ref: unknown,
    ) {
      mockOwnerPost(props.postId, props.post);
      mockOwnerProps = props;
      React.useImperativeHandle(ref, () => ({
        openManage: mockOpenManage,
        requestDeactivate: jest.fn(),
        edit: jest.fn(),
        isBusy: mockIsBusy,
      }));
      return null;
    }),
  };
});

const mockUsePostDetail = jest.fn();
jest.mock('../hooks/usePostDetail', () => ({
  usePostDetail: (id: string) => mockUsePostDetail(id),
}));

// Opens synchronously here — the real one waits for a transition that a list
// has not got; its timing is pinned in useOpenOnArrival.test.
jest.mock('../hooks/useOpenOnArrival', () => ({
  useOpenOnArrival: (ready: boolean, open: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
    const { useEffect } = require('react');
    useEffect(() => {
      if (ready) open();
      // `ready` only, like the real hook: a fresh `open` closure per render
      // must not re-open the sheet.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);
  },
}));

jest.mock('@/shared/lib/haptics', () => ({ lightHaptic: jest.fn() }));

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
    expect(getByText('Your listings live here')).toBeTruthy();
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
    expect(getByText('No listings yet')).toBeTruthy();
    fireEvent.press(getByTestId('empty-action'));
    expect(mockPush).toHaveBeenCalledWith('/post-a-car');
  });

  it('renders cards and opens the post on tap', async () => {
    mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post] });
    const { getByTestId } = await render(<MyPostsScreen />);
    fireEvent.press(getByTestId('card-p1'));
    expect(mockPush).toHaveBeenCalledWith('/post/p1');
  });

  // Press and hold → the Manage sheet, RIGHT HERE over the list — not a trip
  // to the listing page (the owner's call, 2026-09-24). It loads that
  // listing's details, then raises the sheet for it.
  describe('press and hold', () => {
    const ownerPost = { id: 'p1', isOwner: true, status: 'draft' };

    const secondPost: PostSummary = { ...post, id: 'p2', make: 'Audi' };
    const ready = (p: { id: string }) => ({
      status: 'ready',
      result: { kind: 'visible', post: p },
      retry: jest.fn(),
    });

    beforeEach(() => {
      mockPush.mockClear();
      mockOpenManage.mockClear();
      mockOwnerPost.mockClear();
      mockToast.mockClear();
      mockIsBusy.mockReset().mockReturnValue(false);
      mockOwnerProps = null;
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post, secondPost] });
    });

    it('raises the Manage sheet over the list, for the held listing — no navigation', async () => {
      mockUsePostDetail.mockReturnValue({
        status: 'ready',
        result: { kind: 'visible', post: ownerPost },
        retry: jest.fn(),
      });
      const { getByTestId } = await render(<MyPostsScreen />);

      await fireEvent(getByTestId('card-p1'), 'longPress');

      expect(mockUsePostDetail).toHaveBeenCalledWith('p1');
      expect(mockOwnerPost).toHaveBeenLastCalledWith('p1', ownerPost);
      expect(mockOpenManage).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('waits for the listing to load before raising the sheet', async () => {
      mockUsePostDetail.mockReturnValue({ status: 'loading', result: null, retry: jest.fn() });
      const { getByTestId } = await render(<MyPostsScreen />);

      await fireEvent(getByTestId('card-p1'), 'longPress');

      expect(mockOpenManage).not.toHaveBeenCalled();
    });

    it('says so when the listing cannot be loaded — the haptic was the only answer', async () => {
      mockUsePostDetail.mockReturnValue({ status: 'error', result: null, retry: jest.fn() });
      const { getByTestId } = await render(<MyPostsScreen />);

      await fireEvent(getByTestId('card-p1'), 'longPress');

      expect(mockOpenManage).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        'We couldn’t open that listing. Please try again.',
        'error',
      );
    });

    // Deleted on another device, auto-deleted after 30 days, or moderated.
    it('says a listing that has gone is not available, and refreshes the list', async () => {
      const refresh = jest.fn();
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post], refresh });
      mockUsePostDetail.mockReturnValue({
        status: 'ready',
        result: { kind: 'notFound' },
        retry: jest.fn(),
      });
      const { getByTestId } = await render(<MyPostsScreen />);

      await fireEvent(getByTestId('card-p1'), 'longPress');

      expect(mockOpenManage).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith('That listing isn’t available any more.', 'error');
      expect(refresh).toHaveBeenCalled();
    });

    // Never replace a manager with a request in flight: the remount would drop
    // its double-tap guard and the post-cancel delete offer.
    it('refuses a new hold while the last action is still running', async () => {
      mockUsePostDetail.mockImplementation((id: string) => ready({ ...ownerPost, id }));
      const { getByTestId } = await render(<MyPostsScreen />);
      await fireEvent(getByTestId('card-p1'), 'longPress');
      mockIsBusy.mockReturnValue(true);
      mockOwnerPost.mockClear();

      await fireEvent(getByTestId('card-p2'), 'longPress');

      expect(mockOwnerPost).not.toHaveBeenCalledWith('p2', expect.anything());
      expect(mockToast).toHaveBeenCalledWith('Just a moment — finishing your last change.');
    });

    it('a delete closes its manager and refreshes the list', async () => {
      const refresh = jest.fn();
      mockUseMyPosts.mockReturnValue({ ...base(), status: 'ready', posts: [post], refresh });
      mockUsePostDetail.mockReturnValue(ready(ownerPost));
      const { getByTestId } = await render(<MyPostsScreen />);
      await fireEvent(getByTestId('card-p1'), 'longPress');
      mockOwnerPost.mockClear();

      await act(async () => {
        mockOwnerProps?.onDeleted();
      });

      expect(refresh).toHaveBeenCalled();
      expect(mockOwnerPost).not.toHaveBeenCalled(); // unmounted, not re-rendered
    });

    // A delete that finishes after the owner has moved on must not close the
    // sheet they have opened since.
    it('a late delete on one listing leaves the next listing’s sheet open', async () => {
      mockUsePostDetail.mockImplementation((id: string) => ready({ ...ownerPost, id }));
      const { getByTestId, rerender } = await render(<MyPostsScreen />);
      await fireEvent(getByTestId('card-p1'), 'longPress');
      const firstOnDeleted = mockOwnerProps?.onDeleted;
      await fireEvent(getByTestId('card-p2'), 'longPress');

      await act(async () => {
        firstOnDeleted?.();
      });
      // The stale delete changes nothing, so nothing re-renders by itself —
      // force a render and see whether p2's manager is still there.
      mockOwnerPost.mockClear();
      await rerender(<MyPostsScreen />);

      expect(mockOwnerPost).toHaveBeenLastCalledWith('p2', expect.anything());
    });

    it('holding again re-opens the sheet', async () => {
      mockUsePostDetail.mockReturnValue({
        status: 'ready',
        result: { kind: 'visible', post: ownerPost },
        retry: jest.fn(),
      });
      const { getByTestId } = await render(<MyPostsScreen />);

      await fireEvent(getByTestId('card-p1'), 'longPress');
      await fireEvent(getByTestId('card-p1'), 'longPress');

      expect(mockOpenManage).toHaveBeenCalledTimes(2);
    });
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
