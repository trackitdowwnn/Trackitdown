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

// The sighting-activity section owns its own data fetching (both faces hit
// supabase) — stub the feature barrel; the section has its own tests.
jest.mock('@/features/sightings', () => ({ PostSightingsSection: () => null }));

// The per-section editors reach the supabase-backed save API — stub the host +
// pencil (edit-gating is covered in PostDetailBody.test).
jest.mock('../components/editors', () => ({
  PostSectionEditorHost: () => null,
  SectionEditButton: () => null,
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

// The payments barrel pulls the Stripe native module (BountyPaymentProvider) —
// stub it. deactivate returns a 'done' outcome so the deactivate handler runs.
const mockDeactivate = jest.fn(async () => ({
  outcome: 'done' as const,
  result: { refundedPence: 49230, feePence: 770 },
  message: null,
}));
// exitCheck MUST be in this mock. Without it the import is `undefined`, so
// requestDeactivate throws a TypeError that its own catch swallows — every test
// then exercised the DEGRADED path while passing, and a regression to the
// ADR-0011 pre-flight would not have been caught on the deactivate exit.
const mockExitCheck = jest.fn(async () => ({
  requiresAttestation: false,
  sightingIds: [] as string[],
  windowDays: 14,
  holdHours: 72,
}));
jest.mock('@/features/payments', () => ({
  useDeactivatePost: () => ({ deactivate: mockDeactivate, pending: false }),
  exitCheck: (...args: unknown[]) => mockExitCheck(...(args as [])),
}));

// The report path calls the flag_post RPC via flagApi — stub it.
const mockFlagPost = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('../api/flagApi', () => ({
  flagPost: (...args: unknown[]) => mockFlagPost(...args),
}));

// Mocked at the api boundary like flagApi above — importing the real module
// reaches `shared/api`, which throws at load without Supabase env configured.
const mockReleasePayout = jest.fn();
jest.mock('../api/recoveryApi', () => {
  class RecoveryError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'RecoveryError';
      this.code = code;
    }
  }
  return {
    RecoveryError,
    releasePayout: (...args: unknown[]) => mockReleasePayout(...args),
  };
});

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

  it('report is auth-gated and a confirmed report flags the post', async () => {
    mockRequireAuth.mockClear();
    mockFlagPost.mockClear();
    setResult('ready', { kind: 'visible', post });
    const { getByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
    await act(async () => {
      fireEvent.press(getByText('Report this post')); // opens the confirm (auth gate is pass-through)
    });
    await act(async () => {
      fireEvent.press(getByText('Report')); // the destructive confirm
    });
    expect(mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'report_post' }),
    );
    expect(mockFlagPost).toHaveBeenCalledWith('p1');
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

  describe('deactivate + refund (owner, paid)', () => {
    beforeEach(() => mockDeactivate.mockClear());

    it('owner + paid: confirming deactivate calls the refund and toasts the exact amount', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'active' } });
      const { getByText, getAllByText } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      await act(async () => {
        // Two owner entry points share the label (the body's section button and
        // the manage sheet's row); either must open the ONE confirm.
        fireEvent.press(getAllByText('Deactivate & refund')[0]);
      });
      await act(async () => {
        fireEvent.press(getByText('Yes, deactivate'));
      });
      expect(mockDeactivate).toHaveBeenCalledWith('p1');
      // The toast shows the SERVER's exact refunded amount (£492.30), not the estimate.
      expect(getByText(/£492\.30 refunded/)).toBeTruthy();
    });

    it('hides the deactivate control for a spotter', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, status: 'active' } });
      const { queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      expect(queryByText('Deactivate & refund')).toBeNull();
    });

    it('hides the deactivate control on an unpaid draft (nothing to refund)', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'draft' } });
      const { queryByText } = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      expect(queryByText('Deactivate & refund')).toBeNull();
    });
  });

  // A listing whose spotter is credited but not yet paid used to offer the
  // owner NOTHING: deactivate and mark-recovered both require `active`, so
  // crediting someone made every action vanish from the post they cared most
  // about — and, because deletion is blocked while a post holds escrow, it
  // also locked them out of deleting their account for good.
  describe('a credited spotter who has not been paid yet', () => {
    it('offers the owner a way to send the bounty', async () => {
      setResult('ready', {
        kind: 'visible',
        post: { ...post, isOwner: true, status: 'recovery_claimed' },
      });
      const { getByTestId } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      expect(getByTestId('manage-release-payout')).toBeTruthy();
    });

    it('offers it on no other status, and never to a spotter', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'active' } });
      const live = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      expect(live.queryByTestId('manage-release-payout')).toBeNull();

      setResult('ready', { kind: 'visible', post: { ...post, status: 'recovery_claimed' } });
      const spotter = await render(<PostDetailScreen postId="p1" />, { wrapper: ToastProvider });
      expect(spotter.queryByTestId('manage-release-payout')).toBeNull();
    });
  });

  describe('owner editing + "Manage post"', () => {
    beforeEach(() => mockPush.mockClear());

    // Live-on-payment publishes on payment, so `active` is the state an owner
    // actually lives in. The money-neutral sections MUST stay editable there (the
    // server RPCs allow it) — this is the regression that made every pencil
    // vanish the moment a listing went live.
    it('owner + LIVE: the money-neutral sections stay editable, the frozen ones do not', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'active' } });
      const { getByTestId, queryByTestId } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      expect(getByTestId('manage-edit-description')).toBeTruthy();
      expect(getByTestId('manage-edit-theft_context')).toBeTruthy();
      expect(getByTestId('manage-edit-distinctive_features')).toBeTruthy();
      // A wrong colour or model actively harms the search, so identity is
      // correctable on a live post (20260731110000). The plate is not in that RPC.
      expect(getByTestId('manage-edit-car_details')).toBeTruthy();
      // Photos, where-it-was-taken and the escrowed reward stay frozen.
      expect(queryByTestId('manage-edit-photos')).toBeNull();
      expect(queryByTestId('manage-edit-last_seen')).toBeNull();
      expect(queryByTestId('manage-edit-bounty')).toBeNull();
    });

    it('owner + DRAFT: every section is editable (nothing is paid for yet)', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'draft' } });
      const { getByTestId } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      expect(getByTestId('manage-edit-car_details')).toBeTruthy();
      expect(getByTestId('manage-edit-bounty')).toBeTruthy();
      expect(getByTestId('manage-edit-description')).toBeTruthy();
    });

    it('"Manage post" opens the sheet for THIS listing — it never navigates away', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, isOwner: true, status: 'active' } });
      const { getByText, getByTestId } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      await act(async () => {
        fireEvent.press(getByText('Manage post'));
      });
      // The old behaviour pushed /my-posts, bouncing the owner off the post.
      expect(mockPush).not.toHaveBeenCalledWith('/my-posts');
      // Sightings are reachable from the sheet, scoped to this post.
      await act(async () => {
        fireEvent.press(getByTestId('manage-view-sightings'));
      });
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: '/post-sightings', params: { postId: 'p1' } }),
      );
    });

    it('the manage sheet is owner-only', async () => {
      setResult('ready', { kind: 'visible', post: { ...post, status: 'active' } });
      const { queryByTestId } = await render(<PostDetailScreen postId="p1" />, {
        wrapper: ToastProvider,
      });
      expect(queryByTestId('manage-view-sightings')).toBeNull();
    });
  });
});
