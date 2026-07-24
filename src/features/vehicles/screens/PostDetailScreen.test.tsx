/**
 * WHAT:  Orchestration tests for PostDetailScreen — the load switch (loading /
 *        error / hidden / visible) and the security-relevant decision: is_owner
 *        drives the owner-vs-spotter bottom bar.
 * WHY:   The units beneath the screen are tested individually; this proves the
 *        screen wires result.post.isOwner to the right bar and renders the warm
 *        closed state for a hidden post rather than any detail.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { ToastProvider } from '@/shared/ui';

import type { PostDetail, PostDetailResult } from '../types';
import { PostDetailScreen } from './PostDetailScreen';

// The watch toggle drags in the supabase client + gate — out of scope here.
jest.mock('@/features/watchlist', () => ({
  WatchToggle: () => null,
  useWatchToggle: () => ({ watched: false, toggle: jest.fn() }),
}));

// The hook is the single data source — drive the screen by mocking its return.
const mockUsePostDetail = jest.fn();
jest.mock('../hooks/usePostDetail', () => ({
  usePostDetail: () => mockUsePostDetail(),
}));

// The similar-posts rail has its own hook test; empty here so the screen
// tests exercise the detail itself (also keeps supabase out of the import
// graph via the search-map barrel).
jest.mock('../hooks/useSimilarPosts', () => ({
  useSimilarPosts: () => ({ status: 'ready', posts: [] }),
}));

// The map SDK and gorhom sheet can't render under jest — stub the leaves.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

// The auth gate: pass-through (member behaviour) so action handlers run.
// Gate-deferral behaviour is covered by the gate's own tests.
const mockRequireAuth = jest.fn((intent: { run?: () => void }) => intent.run?.());
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
}));

// The chat feature is imported lazily (dynamic import) by the message-owner
// handler — __esModule so `await import()` destructuring resolves the mock.
const mockOpenThread = jest.fn();
jest.mock('@/features/chat', () => ({
  __esModule: true,
  openThread: (...args: unknown[]) => mockOpenThread(...args),
}));

jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'));

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    Extrapolation: actual.Extrapolation ?? actual.Extrapolate ?? { CLAMP: 'clamp' },
    useReducedMotion: () => true,
  };
});

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const post: PostDetail = {
  id: 'p1',
  isOwner: false,
  status: 'active',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  bountyPence: 50000,
  lastSeenAt: '2026-07-10T18:00:00Z',
  lastSeenArea: 'Camden',
  createdAt: '2026-07-08T12:00:00Z',
  photos: [{ uri: 'https://img/1' }],
  owner: { memberSince: '2025-01-05T00:00:00Z', firstName: 'Alex' },
  features: [],
  distinctiveFeatures: [],
  sightingCount: 0,
  viewerHasSighting: false,
};

const setResult = (status: string, result: PostDetailResult | null) =>
  mockUsePostDetail.mockReturnValue({ status, result, retry: jest.fn() });

describe('PostDetailScreen', () => {
  it('spotter mode: shows the "I\'ve seen this car" action', async () => {
    setResult('ready', { kind: 'visible', post });
    const { getByText, queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
    expect(getByText("I've seen this car")).toBeTruthy();
    expect(queryByText('Manage post')).toBeNull();
  });

  it('owner mode (is_owner): shows "Manage post" instead', async () => {
    setResult('ready', { kind: 'visible', post: { ...post, isOwner: true } });
    const { getByText, queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
    expect(getByText('Manage post')).toBeTruthy();
    expect(queryByText("I've seen this car")).toBeNull();
  });

  it('hidden (recovered): shows the warm closed state, no detail or bottom bar', async () => {
    setResult('ready', { kind: 'hidden', closedReason: 'recovered' });
    const { getByText, queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
    expect(getByText(/has been recovered/i)).toBeTruthy();
    expect(queryByText('AB12 CDE')).toBeNull();
    expect(queryByText("I've seen this car")).toBeNull();
  });

  it('error: shows a retry', async () => {
    setResult('error', null);
    const { getByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
    expect(getByText('Try again')).toBeTruthy();
  });

  it('report lives at the page end, not the header', async () => {
    setResult('ready', { kind: 'visible', post });
    const { getByText, queryByLabelText } = await render(<PostDetailScreen postId="p1" />, {
      wrapper: ToastProvider,
    });
    expect(getByText('Report this post')).toBeTruthy();
    // The header keeps share only (redesign B5 — the reference's trust-page grammar).
    expect(queryByLabelText('Report')).toBeNull();
    expect(queryByLabelText('Share')).toBeTruthy();
  });

  describe('message the owner (sighting-gated)', () => {
    beforeEach(() => {
      mockPush.mockClear();
      mockOpenThread.mockClear();
    });

    it('WITHOUT a sighting: routes into the report flow (no cold DM)', async () => {
      setResult('ready', { kind: 'visible', post });
      const { getByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      await act(async () => {
        fireEvent.press(getByText('Report a sighting'));
      });
      expect(mockOpenThread).not.toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/report-sighting', params: expect.objectContaining({ postId: 'p1' }) }),
      );
    });

    it('WITH a sighting: takes the message branch (not the report flow)', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, viewerHasSighting: true } });
      const { getByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      await act(async () => {
        fireEvent.press(getByText('Message the owner'));
      });
      // The screen's decision: the auth gate uses the message_owner context and
      // it does NOT route into the report flow. (Opening the thread itself is
      // covered by the chat API tests; the deferred import() bypasses jest
      // module mocks, so we assert the branch, not the openThread call.)
      expect(mockRequireAuth).toHaveBeenCalledWith(
        expect.objectContaining({ context: 'message_owner' }),
      );
      expect(mockPush).not.toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/report-sighting' }),
      );
    });

    it('is HIDDEN for the owner', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true } });
      const { queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      expect(queryByText('Message the owner')).toBeNull();
      expect(queryByText(/Reporting a sighting opens/)).toBeNull();
    });
  });
});
