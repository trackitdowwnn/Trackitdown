/**
 * WHAT:  Tests for the owner's sighting page (redesigned 2026-10-08): its
 *        load / error / gone states, and a crafted link that never fetches;
 *        the way back, with or without history; the decision — asked as "Is
 *        this your car?", "Yes" confirmed before it is sent (from either
 *        state), "Not my car" straight away and reversible, the spinner on
 *        the answer given; the decision shown honestly afterwards (a rejected
 *        sighting is "Not your car", never "Marked helpful"), with when it was
 *        made; one toast whatever `counted` says; the sections (where, how
 *        exact, what they saw, the marks, the spotter); the safety notice
 *        beside the point and again before the map; Open in Maps dropping a
 *        pin; Message opening the thread.
 * WHY:   This page had no test of its own, and shipped two bugs a test would
 *        have caught: the opposite label on a rejected sighting, and the
 *        irreversible "helpful" on one unconfirmed tap. It is also where
 *        SECURITY_AND_TRUST's safety notice and pin-only maps rules live.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        docs/TESTING.md; docs/SECURITY_AND_TRUST.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { mapPinUrl } from '@/shared/lib';
import { SAFETY_NOTICE_BODY, ToastProvider } from '@/shared/ui';

import type { OwnerSighting } from '../types';
import { SightingDetailScreen } from './SightingDetailScreen';

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

// Sheets show only once presented — so a dialog's text is absent until opened.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

let mockHook: {
  status: 'loading' | 'ready' | 'error';
  sightings: OwnerSighting[];
  photoUrls: Record<string, string>;
  retry: jest.Mock;
};
const mockHookCall = jest.fn();
jest.mock('../hooks/usePostSightings', () => ({
  usePostSightings: (postId: string, enabled: boolean) => {
    mockHookCall(postId, enabled);
    return mockHook;
  },
}));

const mockHelpful = jest.fn();
const mockNotMine = jest.fn();
jest.mock('../api/sightingApi', () => ({
  markSightingHelpful: (id: string) => mockHelpful(id),
  markSightingNotMine: (id: string) => mockNotMine(id),
  SightingVerdictError: class SightingVerdictError extends Error {},
}));
const { SightingVerdictError } = jest.requireMock('../api/sightingApi') as {
  SightingVerdictError: new (message: string) => Error;
};

const mockOpenThread = jest.fn();
// The deferred chat import, stood in for (Jest can't run a dynamic import).
jest.mock('../api/openSpotterThread', () => ({
  openSpotterThread: (id: string) => mockOpenThread(id),
}));

const POST_ID = '11111111-1111-4111-8111-111111111111';
const SIGHTING_ID = '22222222-2222-4222-8222-222222222222';

function sighting(overrides: Partial<OwnerSighting> = {}): OwnerSighting {
  return {
    id: SIGHTING_ID,
    createdAt: '2026-10-08T10:00:00Z',
    status: 'unverified',
    reviewedAt: null,
    contextFlags: ['parked'],
    note: 'Outside the Tesco on Deansgate',
    areaLabel: 'Deansgate, Manchester',
    locationUnavailable: false,
    parkedLikelihood: 'settled',
    direction: null,
    peoplePresence: 'nobody',
    confirmedFeatures: [{ id: 'm1', description: 'Dent on the rear door' }],
    photos: [
      {
        path: 'a.jpg',
        lat: 53.4794,
        lng: -2.2453,
        accuracyM: 8,
        capturedAt: '2026-10-08T09:55:00Z',
        source: 'live',
      },
      {
        path: 'b.jpg',
        lat: null,
        lng: null,
        accuracyM: null,
        capturedAt: '2026-10-08T09:56:00Z',
        source: 'gallery',
      },
    ],
    spotter: {
      firstName: 'Sam',
      sightingsReported: 12,
      sightingsHelpful: 4,
      recoveriesCredited: 1,
      memberSince: '2026-07-01T00:00:00Z',
    },
    ...overrides,
  };
}

function ready(s: OwnerSighting = sighting()) {
  mockHook = {
    status: 'ready',
    sightings: [s],
    photoUrls: { 'a.jpg': 'https://x/a.jpg', 'b.jpg': 'https://x/b.jpg' },
    retry: jest.fn(),
  };
}

const renderScreen = (postId = POST_ID, sightingId = SIGHTING_ID) =>
  render(<SightingDetailScreen postId={postId} sightingId={sightingId} />, {
    wrapper: ToastProvider,
  });

const press = async (node: Parameters<typeof fireEvent.press>[0]) => {
  await act(async () => {
    fireEvent.press(node);
  });
};
/** The last match — the dialog's button, drawn after the bar's. */
const last = <T,>(items: T[]) => items[items.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  ready();
  mockCanGoBack.mockReturnValue(true);
  mockHelpful.mockResolvedValue({
    status: 'helpful',
    changed: true,
    crossedThreshold: null,
    counted: true,
  });
  mockNotMine.mockResolvedValue({ status: 'not_mine', changed: true });
  mockOpenThread.mockResolvedValue({ threadId: 't1' });
});

describe('SightingDetailScreen — states', () => {
  it('shows its skeleton while loading', async () => {
    mockHook = { status: 'loading', sightings: [], photoUrls: {}, retry: jest.fn() };
    const view = await renderScreen();
    expect(view.getByTestId('sighting-detail-skeleton')).toBeTruthy();
  });

  it('offers a retry when it couldn’t load', async () => {
    const retry = jest.fn();
    mockHook = { status: 'error', sightings: [], photoUrls: {}, retry };
    const view = await renderScreen();
    await press(view.getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });

  it('says so, and offers the way back, for a sighting that is gone', async () => {
    mockHook = { status: 'ready', sightings: [], photoUrls: {}, retry: jest.fn() };
    const view = await renderScreen();
    expect(view.getByText('This sighting isn’t available any more')).toBeTruthy();
    await press(view.getByText('Go back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('a sighting the spotter withdrew reads as gone — no decision offered', async () => {
    ready(sighting({ status: 'withdrawn' }));
    const view = await renderScreen();
    expect(view.getByText('This sighting isn’t available any more')).toBeTruthy();
    expect(view.queryByTestId('sighting-decision-bar')).toBeNull();
  });

  it('⚠️ a crafted link with ids that aren’t ids never fetches', async () => {
    const view = await renderScreen('p1', 's1');
    expect(mockHookCall).toHaveBeenCalledWith('p1', false);
    expect(view.getByText('This sighting isn’t available any more')).toBeTruthy();
  });

  it('always has a way back — the header’s back button', async () => {
    const view = await renderScreen();
    await press(view.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('opened from a notification with nothing behind it, back goes to the post', async () => {
    mockCanGoBack.mockReturnValue(false);
    const view = await renderScreen();
    await press(view.getByLabelText('Back'));
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith(`/post/${POST_ID}`);
  });

  it('⚠️ …but never to a post id that isn’t one', async () => {
    mockCanGoBack.mockReturnValue(false);
    const view = await renderScreen('p1', 's1');
    await press(view.getByText('Go back'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('the decision', () => {
  it('asks "Is this your car?" while undecided', async () => {
    const view = await renderScreen();
    expect(view.getByTestId('sighting-decision-bar')).toBeTruthy();
    expect(view.getByText('Is this your car?')).toBeTruthy();
    expect(view.queryByTestId('sighting-decision')).toBeNull();
  });

  it('⚠️ "Yes" asks once more before it is sent — it cannot be undone', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    expect(mockHelpful).not.toHaveBeenCalled(); // only the confirm so far
    expect(view.getByText('Confirm it’s your car?')).toBeTruthy();
    expect(view.getByText(/You can’t undo this/)).toBeTruthy();

    await press(last(view.getAllByRole('button', { name: 'Yes, it’s my car' })));
    expect(mockHelpful).toHaveBeenCalledWith(SIGHTING_ID);
    expect(view.getByText('Confirmed')).toBeTruthy();
    expect(view.getByText(/You decided/)).toBeTruthy();
    expect(view.getByText('Confirmed — we’ve let Sam know.')).toBeTruthy();
  });

  it('⚠️ says the same thing when the confirmation didn’t count — no tell', async () => {
    mockHelpful.mockResolvedValue({
      status: 'helpful',
      changed: true,
      crossedThreshold: null,
      counted: false,
    });
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    await press(last(view.getAllByRole('button', { name: 'Yes, it’s my car' })));
    expect(view.getByText('Confirmed — we’ve let Sam know.')).toBeTruthy();
    expect(view.queryByText(/credit/i)).toBeNull();
  });

  it('"Not my car" is sent straight away — it is reversible', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(mockNotMine).toHaveBeenCalledWith(SIGHTING_ID);
    expect(view.getByText('Not your car')).toBeTruthy();
    expect(view.getByText('Marked as not your car. You can change this.')).toBeTruthy();
  });

  it('a later change on the server wins over the answer just given', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(view.getByText('Not your car')).toBeTruthy();

    // The next fetch: the owner changed it elsewhere and a recovery credited it.
    ready(sighting({ status: 'credited', reviewedAt: '2026-10-08T12:00:00Z' }));
    await act(async () => {
      view.rerender(<SightingDetailScreen postId={POST_ID} sightingId={SIGHTING_ID} />);
    });
    expect(view.getByText('Credited')).toBeTruthy();
    expect(view.queryByText('Not your car')).toBeNull();
  });

  it('the spinner sits on the answer being sent, not the other one', async () => {
    mockNotMine.mockReturnValue(new Promise(() => {})); // still on its way
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(view.getByRole('button', { name: 'Not my car', busy: true })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Yes, it’s my car', busy: false })).toBeDisabled();
  });

  it('a refused "Not my car" says why, in the server’s own calm words', async () => {
    mockNotMine.mockRejectedValue(new SightingVerdictError('You’ve already confirmed this one.'));
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(view.getByText('You’ve already confirmed this one.')).toBeTruthy();
    expect(view.getByText('Is this your car?')).toBeTruthy();
  });

  it('⚠️ a sighting said NOT to be the car reads "Not your car" — never "Marked helpful"', async () => {
    ready(sighting({ status: 'not_mine', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.getByText('Not your car')).toBeTruthy();
    expect(view.getByLabelText(/^Your answer: Not your car, decided /)).toBeTruthy();
    expect(view.queryByText(/helpful/i)).toBeNull();
    expect(view.getByText('You said this isn’t your car.')).toBeTruthy();
  });

  it('⚠️ "Actually, it is" goes through the same confirm', async () => {
    ready(sighting({ status: 'not_mine', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Actually, it is' }));
    expect(mockHelpful).not.toHaveBeenCalled();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    expect(mockHelpful).toHaveBeenCalledWith(SIGHTING_ID);
    expect(view.getByText('Confirmed')).toBeTruthy();
  });

  it('once confirmed, the bar is just Message', async () => {
    ready(sighting({ status: 'helpful', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.queryByText('Is this your car?')).toBeNull();
    expect(view.getByText('Confirmed')).toBeTruthy();
    expect(view.getAllByRole('button', { name: 'Message Sam' })).toHaveLength(1);
  });

  it('a credited sighting says so', async () => {
    ready(sighting({ status: 'credited', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.getByText('Credited')).toBeTruthy();
  });
});

describe('the evidence', () => {
  it('leads with where and when it was seen', async () => {
    const view = await renderScreen();
    expect(view.getByText('Seen near Deansgate, Manchester')).toBeTruthy();
  });

  it('marks a library photo ON the photo — ADR-0003', async () => {
    const view = await renderScreen();
    await act(async () => {
      fireEvent(view.getByTestId('sighting-photos'), 'layout', {
        nativeEvent: { layout: { width: 390 } },
      });
    });
    expect(view.getByLabelText('Sighting, photo 2 of 2, From photo library')).toBeTruthy();
  });

  it('times it by the in-app photo — never a library photo’s date (ADR-0003)', async () => {
    const [live, gallery] = sighting().photos;
    const seenLabel = async (photos: OwnerSighting['photos']) => {
      ready(sighting({ photos }));
      const view = await renderScreen();
      const label = view.getByLabelText(/^Seen /).props.accessibilityLabel as string;
      await act(async () => view.unmount());
      return label;
    };
    const oldLibraryPhoto = { ...gallery, capturedAt: '2026-09-01T08:00:00Z' };
    // A library photo first must not set the time; the live one does.
    expect(await seenLabel([oldLibraryPhoto, live])).toBe(await seenLabel([live]));
    // Library photos only: when it was sent.
    expect(await seenLabel([oldLibraryPhoto])).toBe(await seenLabel([]));
    expect(await seenLabel([oldLibraryPhoto])).not.toBe(await seenLabel([live]));
  });

  it('says when the location is only approximate', async () => {
    ready(
      sighting({
        photos: [{ ...sighting().photos[0], accuracyM: 240 }],
      }),
    );
    const view = await renderScreen();
    expect(view.getByText('Approximate — within about 240 m')).toBeTruthy();
  });

  it('says so when there is no location at all', async () => {
    ready(sighting({ locationUnavailable: true, areaLabel: null, photos: [sighting().photos[1]] }));
    const view = await renderScreen();
    expect(view.getByText('Location couldn’t be captured for this sighting.')).toBeTruthy();
    expect(view.queryByTestId('sighting-open-maps')).toBeNull();
    expect(view.getByText(SAFETY_NOTICE_BODY)).toBeTruthy();
  });

  it('labels what they saw, sets their note apart, and lists your marks they could see', async () => {
    const view = await renderScreen();
    expect(view.getByLabelText('What it was doing, Parked · Looks parked up')).toBeTruthy();
    expect(view.getByText('In their words')).toBeTruthy();
    expect(view.getByText('Outside the Tesco on Deansgate')).toBeTruthy();
    expect(view.getByText('Dent on the rear door')).toBeTruthy();
  });

  it('shows who spotted it, and their record', async () => {
    const view = await renderScreen();
    expect(view.getByText('12 sightings · 4 confirmed by owners · 1 recovery')).toBeTruthy();
    expect(view.getByText('Member since July 2026')).toBeTruthy();
  });
});

describe('the actions', () => {
  it('⚠️ the safety notice stands by the point — and again before the map opens', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const view = await renderScreen();
      expect(view.getAllByText(SAFETY_NOTICE_BODY)).toHaveLength(1);

      await press(view.getByTestId('sighting-open-maps'));
      expect(openURL).not.toHaveBeenCalled();
      expect(view.getByText('Opening the map — please don’t approach')).toBeTruthy();
      expect(view.getAllByText(SAFETY_NOTICE_BODY)).toHaveLength(2);

      // A pin — never directions (§1 bans pursuit features).
      await press(last(view.getAllByRole('button', { name: 'Open in Maps' })));
      expect(openURL).toHaveBeenCalledWith(mapPinUrl(53.4794, -2.2453, 'Car sighted here'));
    } finally {
      openURL.mockRestore();
    }
  });

  it('Message opens the conversation by sighting — before deciding, too', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Message Sam' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/t1'));
    expect(mockOpenThread).toHaveBeenCalledWith(SIGHTING_ID);
  });
});
