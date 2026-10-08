/**
 * WHAT:  Tests for the owner's sighting page (redesigned 2026-10-08): its
 *        load / error / gone states; the decision — asked as "Is this your
 *        car?", "Yes" confirmed before it is sent, "Not my car" straight
 *        away and reversible; the decision shown honestly afterwards (a
 *        rejected sighting is "Not your car", never "Marked helpful"), with
 *        when it was made; the sections (where, how exact, what they saw,
 *        the marks, the spotter); the safety notice; Open in Maps behind its
 *        warning; Message opening the thread.
 * WHY:   This page had no test of its own, and shipped two bugs a test would
 *        have caught: the opposite label on a rejected sighting, and the
 *        irreversible "helpful" on one unconfirmed tap. It is also where
 *        SECURITY_AND_TRUST's safety notice and pin-only maps rules live.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        docs/TESTING.md; docs/SECURITY_AND_TRUST.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ToastProvider } from '@/shared/ui';

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
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

let mockHook: {
  status: 'loading' | 'ready' | 'error';
  sightings: OwnerSighting[];
  photoUrls: Record<string, string>;
  retry: jest.Mock;
};
jest.mock('../hooks/usePostSightings', () => ({
  usePostSightings: () => mockHook,
}));

const mockHelpful = jest.fn();
const mockNotMine = jest.fn();
jest.mock('../api/sightingApi', () => ({
  markSightingHelpful: (id: string) => mockHelpful(id),
  markSightingNotMine: (id: string) => mockNotMine(id),
  SightingVerdictError: class SightingVerdictError extends Error {},
}));

const mockOpenThread = jest.fn();
// The deferred chat import, stood in for (Jest can't run a dynamic import).
jest.mock('../lib/openSpotterThread', () => ({
  openSpotterThread: (id: string) => mockOpenThread(id),
}));

jest.mock('@/features/profile', () => ({
  __esModule: true,
  PublicProfileSheet: () => null,
}));

function sighting(overrides: Partial<OwnerSighting> = {}): OwnerSighting {
  return {
    id: 's1',
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

const renderScreen = () =>
  render(<SightingDetailScreen postId="p1" sightingId="s1" />, { wrapper: ToastProvider });

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
    expect(view.getByText('This sighting isn’t available any more.')).toBeTruthy();
    await press(view.getByText('Go back'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('always has a way back — the header’s back button', async () => {
    const view = await renderScreen();
    await press(view.getByLabelText('Back'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('the decision', () => {
  it('asks "Is this your car?" while undecided', async () => {
    const view = await renderScreen();
    expect(view.getByTestId('sighting-decision-bar')).toBeTruthy();
    expect(view.getByText('Is this your car?')).toBeTruthy();
  });

  it('⚠️ "Yes" asks once more before it is sent — it cannot be undone', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    expect(mockHelpful).not.toHaveBeenCalled(); // only the confirm so far
    expect(view.getByText(/You can’t undo this/)).toBeTruthy();

    await press(last(view.getAllByRole('button', { name: 'Yes, it’s my car' })));
    expect(mockHelpful).toHaveBeenCalledWith('s1');
    expect(view.getByText('Your car')).toBeTruthy();
    expect(view.getByText(/You decided/)).toBeTruthy();
  });

  it('"Not my car" is sent straight away — it is reversible', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(mockNotMine).toHaveBeenCalledWith('s1');
  });

  it('⚠️ a sighting said NOT to be the car reads "Not your car" — never "Marked helpful"', async () => {
    ready(sighting({ status: 'not_mine', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.getByText('Not your car')).toBeTruthy();
    expect(view.queryByText(/helpful/i)).toBeNull();
    expect(view.getByText('You said this isn’t your car.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Actually, it is' })).toBeTruthy();
  });

  it('once confirmed, the bar is just Message', async () => {
    ready(sighting({ status: 'helpful', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.queryByText('Is this your car?')).toBeNull();
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
    expect(view.getByLabelText('Sighting photo, photo 2 of 2, From photo library')).toBeTruthy();
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
  });

  it('labels what they saw, quotes their note, and lists your marks they could see', async () => {
    const view = await renderScreen();
    expect(view.getByLabelText('What it was doing, Parked · Looks parked up')).toBeTruthy();
    expect(view.getByText('“Outside the Tesco on Deansgate”')).toBeTruthy();
    expect(view.getByText('Dent on the rear door')).toBeTruthy();
  });

  it('shows who spotted it, and their record', async () => {
    const view = await renderScreen();
    expect(view.getByText('12 sightings · 4 confirmed · 1 recovery')).toBeTruthy();
    expect(view.getByText('Member since July 2026')).toBeTruthy();
  });

  it('⚠️ always shows the safety notice', async () => {
    const view = await renderScreen();
    expect(view.getByText(/999/)).toBeTruthy();
  });
});

describe('the actions', () => {
  it('⚠️ Open in Maps warns first, then drops a pin', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const view = await renderScreen();
      await press(view.getByTestId('sighting-open-maps'));
      expect(openURL).not.toHaveBeenCalled();
      expect(view.getByText('Opening the map — please don’t approach')).toBeTruthy();

      await press(last(view.getAllByRole('button', { name: 'Open in Maps' })));
      expect(openURL).toHaveBeenCalledTimes(1);
    } finally {
      openURL.mockRestore();
    }
  });

  it('Message opens the conversation by sighting — before deciding, too', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Message Sam' }));
    // Behind a deferred import of the chat feature.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/t1'));
    expect(mockOpenThread).toHaveBeenCalledWith('s1');
  });
});
