/**
 * WHAT:  Orchestration tests for PostDetailScreen — the load switch (loading /
 *        error / hidden / visible) and the security-relevant decision: is_owner
 *        drives the owner-vs-spotter bottom bar.
 * WHY:   The units beneath the screen are tested individually; this proves the
 *        screen wires result.post.isOwner to the right bar and renders the warm
 *        closed state for a hidden post rather than any detail.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { ToastProvider } from '@/shared/ui';

import type { PostDetail, PostDetailResult } from '../types';
import { PostDetailScreen } from './PostDetailScreen';

// The hook is the single data source — drive the screen by mocking its return.
const mockUsePostDetail = jest.fn();
jest.mock('../hooks/usePostDetail', () => ({
  usePostDetail: () => mockUsePostDetail(),
}));

// The map SDK and gorhom sheet can't render under jest — stub the leaves.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

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
  sightingCount: 0,
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
});
