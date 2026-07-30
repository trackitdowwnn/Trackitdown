/**
 * WHAT:  Tests for PostSightingsSection — the two faces rendering with the
 *        correct DEPTH from one mount point, the per-viewer empty rules
 *        (owner: warm copy; public: the section vanishes), the owner
 *        preview's View-all doorway, and entry tap-through.
 * WHY:   The face split is the feature's // SAFETY core (ADR-0008): the
 *        public face must render nothing but time + locality — the absence
 *        assertions here (no photos, no spotter name, no note, no owner
 *        testIDs) are the client half of the fence; the SQL suite proves the
 *        server half never sends more.
 * LINKS: src/features/sightings/components/PostSightingsSection.tsx;
 *        supabase/tests/sightings_verification.sql (CHECKs 15–16);
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { OwnerSighting, PublicSightingEntries } from '../types';
import { PostSightingsSection } from './PostSightingsSection';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    useReducedMotion: () => true,
  };
});

// The trail map imports the native map SDK — stub it (house pattern).
jest.mock('@/shared/ui/AppMap', () => ({
  AppMap: 'AppMap',
  AppMapMarker: 'AppMapMarker',
  AppMapPolyline: 'AppMapPolyline',
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The section is presentational over its two hooks — drive both directly.
const mockOwnerHook = jest.fn();
jest.mock('../hooks/usePostSightings', () => ({
  usePostSightings: (postId: string, enabled: boolean) => mockOwnerHook(postId, enabled),
}));
const mockPublicHook = jest.fn();
jest.mock('../hooks/usePublicSightingEntries', () => ({
  usePublicSightingEntries: (postId: string, enabled: boolean) => mockPublicHook(postId, enabled),
}));

const sighting = (id: string, createdAt: string): OwnerSighting => ({
  id,
  createdAt,
  status: 'unverified',
  contextFlags: [],
  note: 'It was parked outside the bakery',
  areaLabel: 'Camden High Street, London',
  locationUnavailable: false,
  parkedLikelihood: null,
  direction: null,
  peoplePresence: null,
  confirmedFeatures: [],
  photos: [{ path: `evidence/${id}.jpg`, lat: 51.55, lng: -0.11, accuracyM: 8, capturedAt: createdAt }],
  spotter: {
    firstName: 'Beth',
    sightingsReported: 3,
    sightingsHelpful: 1,
    recoveriesCredited: 0,
    memberSince: '2026-04-01T00:00:00Z',
  },
});

const ownerReady = (sightings: OwnerSighting[]) => ({
  status: 'ready' as const,
  sightings,
  photoUrls: {},
  retry: jest.fn(),
});

const publicData = (times: string[], earlierCount = 0): PublicSightingEntries => ({
  entries: times.map((sightedAt) => ({
    sightedAt,
    locality: 'Holloway',
    snapLat: 51.55,
    snapLng: -0.11,
  })),
  earlierCount,
});

const renderSection = async (props: { postId: string; isOwner: boolean }) =>
  render(<PostSightingsSection {...props} />);

const press = async (element: unknown) => {
  await act(async () => {
    fireEvent.press(element as never);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOwnerHook.mockReturnValue(ownerReady([]));
  mockPublicHook.mockReturnValue(null);
});

describe('face selection', () => {
  it('the owner face never enables the public RPC fetch', async () => {
    await renderSection({ postId: 'p1', isOwner: true });
    expect(mockOwnerHook).toHaveBeenCalledWith('p1', true);
    expect(mockPublicHook).toHaveBeenCalledWith('p1', false);
  });

  it('the public face never enables the owner RPC fetch', async () => {
    await renderSection({ postId: 'p1', isOwner: false });
    expect(mockOwnerHook).toHaveBeenCalledWith('p1', false);
    expect(mockPublicHook).toHaveBeenCalledWith('p1', true);
  });
});

describe('owner face', () => {
  it('renders the rich timeline and taps through to the sighting detail', async () => {
    mockOwnerHook.mockReturnValue(
      ownerReady([sighting('s1', '2026-07-29T10:00:00Z'), sighting('s2', '2026-07-28T10:00:00Z')]),
    );
    const { getByTestId, getAllByText } = await renderSection({ postId: 'p1', isOwner: true });

    expect(getByTestId('owner-sighting-timeline')).toBeTruthy();
    expect(getAllByText(/Camden High Street/).length).toBeGreaterThan(0);

    await press(getByTestId('timeline-entry-s1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/sighting/[sightingId]',
      params: { sightingId: 's1', postId: 'p1' },
    });
  });

  it('offers View-all only past the preview limit, with an honest count', async () => {
    const four = ['29', '28', '27', '26'].map((d) =>
      sighting(`s${d}`, `2026-07-${d}T10:00:00Z`),
    );
    mockOwnerHook.mockReturnValue(ownerReady(four));
    const { getByText, queryByTestId } = await renderSection({ postId: 'p1', isOwner: true });

    // Preview caps at 3 — the 4th entry is behind the doorway.
    expect(queryByTestId('timeline-entry-s26')).toBeNull();
    await press(getByText('View all 4 sightings'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/post-sightings',
      params: { postId: 'p1' },
    });
  });

  it('shows the warm empty state when no sightings exist yet', async () => {
    const { getByText, queryByText } = await renderSection({ postId: 'p1', isOwner: true });
    expect(getByText(/No sightings yet — spotters in the area have been alerted/)).toBeTruthy();
    expect(queryByText(/View all/)).toBeNull();
  });

  it('shows a skeleton while loading', async () => {
    mockOwnerHook.mockReturnValue({ status: 'loading', sightings: [], photoUrls: {}, retry: jest.fn() });
    const { getByTestId } = await renderSection({ postId: 'p1', isOwner: true });
    expect(getByTestId('sightings-section-skeleton')).toBeTruthy();
  });

  it('offers a retry on error', async () => {
    const retry = jest.fn();
    mockOwnerHook.mockReturnValue({ status: 'error', sightings: [], photoUrls: {}, retry });
    const { getByText } = await renderSection({ postId: 'p1', isOwner: true });
    await press(getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
});

describe('public face', () => {
  it('renders restrained single lines — and NOTHING beyond time + locality', async () => {
    mockPublicHook.mockReturnValue(publicData(['2026-07-29T10:00:00Z', '2026-07-28T09:00:00Z'], 4));
    const { getByTestId, getAllByText, getByText, queryByTestId, queryByText } = await renderSection({
      postId: 'p1',
      isOwner: false,
    });

    expect(getByTestId('public-sighting-timeline')).toBeTruthy();
    expect(getAllByText(/Sighted near Holloway/).length).toBe(2);
    expect(getByText('…and 4 earlier sightings')).toBeTruthy();

    // SAFETY absences (ADR-0008): no owner-face artefacts can exist here.
    expect(queryByTestId('owner-sighting-timeline')).toBeNull();
    expect(queryByText('Beth')).toBeNull(); // no spotter identity
    expect(queryByText(/bakery/)).toBeNull(); // no notes
    expect(queryByText(/Camden High Street/)).toBeNull(); // no street-grain place
    expect(queryByTestId(/timeline-entry-/)).toBeNull(); // nothing tappable
  });

  it('renders NO section while loading — absence, not a skeleton', async () => {
    // The hook returns null until (and unless) entries land.
    const loading = await renderSection({ postId: 'p1', isOwner: false });
    expect(loading.queryByText('Sighting activity')).toBeNull();
  });

  it('renders NO section when the landed payload is empty', async () => {
    // Landed empty — still nothing (an absent section signals nothing).
    mockPublicHook.mockReturnValue(publicData([]));
    const empty = await renderSection({ postId: 'p1', isOwner: false });
    expect(empty.queryByText('Sighting activity')).toBeNull();
    expect(empty.queryByText(/No sightings yet/)).toBeNull(); // no owner empty copy either
  });
});
