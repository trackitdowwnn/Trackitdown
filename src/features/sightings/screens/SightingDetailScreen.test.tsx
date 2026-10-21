/**
 * WHAT:  Tests for the owner's sighting page (redesigned 2026-10-08): its
 *        load / error / gone states, and a crafted link that never fetches;
 *        the way back, with or without history; the decision — asked as "Is
 *        this your car?", "Yes" confirmed before it is sent (from either
 *        state), "Not my car" straight away and reversible, the spinner on
 *        the answer given; the decision shown honestly afterwards (a rejected
 *        sighting is "Not your car", never "Marked helpful"), with when it was
 *        made; one toast whatever `counted` says; the sections (what they
 *        saw, the marks, the damage seen and their words about it, which
 *        parts were missing and their words about that, where with
 *        its street address, the spotter); the
 *        safety notice beside the point and again before the map; Google Maps
 *        or Waze dropping a pin; Message opening the thread.
 * WHY:   This page had no test of its own, and shipped two bugs a test would
 *        have caught: the opposite label on a rejected sighting, and the
 *        irreversible "helpful" on one unconfirmed tap. It is also where
 *        SECURITY_AND_TRUST's safety notice and pin-only maps rules live.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        docs/TESTING.md; docs/SECURITY_AND_TRUST.md.
 */

import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { Linking, StyleSheet } from 'react-native';

import { googleMapsPinUrl, wazePinUrl } from '@/shared/lib';
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

// What the page reads from the LISTING — its own deferred fetch, stood in for
// here (tested in useSightingPost.test): the owner's marks and the "Got your
// car back?" door. Both null = the listing not read (yet, or at all).
let mockDoor: { noReward: boolean; bounty: string } | null = null;
let mockListingMarks: { id: string; description: string; photoUrl?: string }[] | null = null;
const mockListingCall = jest.fn();
// The street address — a device lookup, stood in for here (its rules are in
// useSightingAddress.test). Null = the lookup hasn't answered: the hook then
// hands back the fallback it was given, as the real one does.
let mockAddress: string | null = null;
const mockAddressCall = jest.fn();
jest.mock('../hooks/useSightingAddress', () => ({
  useSightingAddress: (point: unknown, fallback: string | null) => {
    mockAddressCall(point, fallback);
    return mockAddress ?? fallback;
  },
}));

jest.mock('../hooks/useSightingPost', () => ({
  useSightingPost: (postId: string, enabled: boolean) => {
    mockListingCall(postId, enabled);
    if (!enabled || (mockDoor === null && mockListingMarks === null)) return null;
    return { marks: mockListingMarks ?? [], recovery: mockDoor };
  },
}));

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
/** Every plain-string Text on screen, in tree (reading) order. */
const textsInOrder = (view: Awaited<ReturnType<typeof renderScreen>>) =>
  view
    .getAllByText(/./)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === 'string');
/** The last match — the dialog's button, drawn after the bar's. */
const last = <T,>(items: T[]) => items[items.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  ready();
  mockDoor = null;
  mockListingMarks = null;
  mockAddress = null;
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

  it('⚠️ a poll that still has the OLD status keeps the answer just given', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));

    // The 30s poll lands before the server's copy has caught up — a NEW
    // payload (another field moved), still carrying the old status.
    ready(sighting({ status: 'unverified', note: 'Still outside the Tesco' }));
    await act(async () => {
      view.rerender(<SightingDetailScreen postId={POST_ID} sightingId={SIGHTING_ID} />);
    });
    expect(view.getByText('Still outside the Tesco')).toBeTruthy();
    expect(view.getByText('Not your car')).toBeTruthy();
    expect(view.queryByText('Is this your car?')).toBeNull();
  });

  it('⚠️ a double tap on the confirm sends "Yes" once — it cannot be undone', async () => {
    mockHelpful.mockReturnValue(new Promise(() => {})); // still on its way
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    const confirm = last(view.getAllByRole('button', { name: 'Yes, it’s my car' }));
    // Both taps inside ONE act: they land before any re-render, so both see
    // the same render's state — exactly a fast double tap on a device.
    await act(async () => {
      fireEvent.press(confirm);
      fireEvent.press(confirm);
    });
    expect(mockHelpful).toHaveBeenCalledTimes(1);
  });

  it('a double tap on "Not my car" sends it once', async () => {
    mockNotMine.mockReturnValue(new Promise(() => {}));
    const view = await renderScreen();
    const notMine = view.getByRole('button', { name: 'Not my car' });
    await act(async () => {
      fireEvent.press(notMine);
      fireEvent.press(notMine);
    });
    expect(mockNotMine).toHaveBeenCalledTimes(1);
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
  });

  it.each(['not_mine', 'helpful', 'credited'] as const)(
    '⚠️ once answered (%s) there is no bar — the answer is said ONCE',
    async (status) => {
      ready(sighting({ status, reviewedAt: '2026-10-08T11:00:00Z' }));
      const view = await renderScreen();
      expect(view.queryByTestId('sighting-decision-bar')).toBeNull();
      expect(view.queryByText('Is this your car?')).toBeNull();
      expect(view.queryByText('You said this isn’t your car.')).toBeNull();
      expect(view.getAllByTestId('sighting-decision')).toHaveLength(1);
    },
  );

  it('the bar goes as soon as the owner answers', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Not my car' }));
    expect(view.queryByTestId('sighting-decision-bar')).toBeNull();
  });

  it('⚠️ "Change" on "Not your car" goes through the same confirm', async () => {
    ready(sighting({ status: 'not_mine', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Change your answer' }));
    expect(mockHelpful).not.toHaveBeenCalled();
    expect(view.getByText('Confirm it’s your car?')).toBeTruthy();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    expect(mockHelpful).toHaveBeenCalledWith(SIGHTING_ID);
    expect(view.getByText('Confirmed')).toBeTruthy();
    // "Yes" can't be undone, so there is nothing left to change.
    expect(view.queryByRole('button', { name: 'Change your answer' })).toBeNull();
  });

  it('while the changed answer is on its way, "Change" says so and can’t be pressed', async () => {
    mockHelpful.mockReturnValue(new Promise(() => {})); // still on its way
    ready(sighting({ status: 'not_mine', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Change your answer' }));
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    expect(view.getByRole('button', { name: 'Saving your answer', busy: true })).toBeDisabled();
  });

  it.each(['unverified', 'helpful', 'credited'] as const)(
    'offers no "Change" unless the answer is "Not your car" (%s)',
    async (status) => {
      ready(
        sighting({ status, reviewedAt: status === 'unverified' ? null : '2026-10-08T11:00:00Z' }),
      );
      const view = await renderScreen();
      expect(view.queryByTestId('sighting-change-answer')).toBeNull();
    },
  );

  it('a credited sighting says so', async () => {
    ready(sighting({ status: 'credited', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.getByText('Credited')).toBeTruthy();
  });
});

describe('"Got your car back?"', () => {
  it('⚠️ under a confirmation, leads to the recovery with the listing’s pricing mode', async () => {
    mockDoor = { noReward: false, bounty: '5000' };
    ready(sighting({ status: 'helpful', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(mockListingCall).toHaveBeenLastCalledWith(POST_ID, true);
    expect(view.getByText('Got your car back?', { includeHiddenElements: true })).toBeTruthy();
    await press(view.getByRole('button', { name: 'Got your car back? Send the reward' }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recover-post',
      params: { postId: POST_ID, bounty: '5000' },
    });
  });

  it('on a no-reward listing, offers the credit — never "the reward"', async () => {
    mockDoor = { noReward: true, bounty: 'none' };
    ready(sighting({ status: 'helpful', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.getByText('Credit the spotter')).toBeTruthy();
    expect(view.queryByText('Send the reward')).toBeNull();
  });

  it('appears right after the owner confirms', async () => {
    mockDoor = { noReward: false, bounty: '5000' };
    const view = await renderScreen();
    expect(view.queryByTestId('sighting-recovery')).toBeNull();
    await press(view.getByRole('button', { name: 'Yes, it’s my car' }));
    await press(last(view.getAllByRole('button', { name: 'Yes, it’s my car' })));
    expect(view.getByTestId('sighting-recovery')).toBeTruthy();
  });

  it.each(['unverified', 'not_mine', 'credited'] as const)(
    'is not offered for a %s sighting — even on a recoverable listing',
    async (status) => {
      mockDoor = { noReward: false, bounty: '5000' };
      ready(
        sighting({ status, reviewedAt: status === 'unverified' ? null : '2026-10-08T11:00:00Z' }),
      );
      const view = await renderScreen();
      expect(view.queryByTestId('sighting-recovery')).toBeNull();
    },
  );

  it('is not offered when the listing can’t be recovered', async () => {
    mockDoor = null;
    ready(sighting({ status: 'helpful', reviewedAt: '2026-10-08T11:00:00Z' }));
    const view = await renderScreen();
    expect(view.queryByTestId('sighting-recovery')).toBeNull();
  });
});

describe('the evidence', () => {
  it('leads with where and when it was seen', async () => {
    const view = await renderScreen();
    expect(view.getByText('Seen near Deansgate, Manchester')).toBeTruthy();
  });

  it('with no area, the title says when — never just "Sighting" again', async () => {
    ready(sighting({ locationUnavailable: true, areaLabel: null }));
    const view = await renderScreen();
    expect(view.getByRole('header', { name: /^Seen (?!near)/ })).toBeTruthy();
    // The header bar's "Sighting" is the only one.
    expect(view.getAllByText('Sighting')).toHaveLength(1);
  });

  it('⚠️ reads evidence first: What they saw → Details → Where → Spotted by', async () => {
    const view = await renderScreen();
    const sections = textsInOrder(view).filter((text) =>
      ['What they saw', 'Details', 'Where', 'Spotted by'].includes(text),
    );
    expect(sections).toEqual(['What they saw', 'Details', 'Where', 'Spotted by']);
  });

  it('puts the answers table and the note under a "Details" title of their own', async () => {
    const view = await renderScreen();
    const texts = textsInOrder(view);
    const at = (text: string) => texts.indexOf(text);
    // A heading like the other sections' (owner, 2026-10-20).
    expect(view.getByRole('header', { name: 'Details' })).toBeTruthy();
    expect(
      at('Seen 1 of 1') === -1 ? at('Your marks they could see') : at('Seen 1 of 1'),
    ).toBeLessThan(at('Details'));
    expect(at('Details')).toBeLessThan(at('Doing'));
    expect(at('Doing')).toBeLessThan(at('In their words'));
  });

  it('shows no "Details" when they answered nothing and left no note', async () => {
    ready(sighting({ contextFlags: [], parkedLikelihood: null, peoplePresence: null, note: null }));
    const view = await renderScreen();
    expect(view.queryByText('Details')).toBeNull();
    expect(view.getByText('What they saw')).toBeTruthy(); // the marks still have theirs
  });

  it('shows no "What they saw" when there are no marks to list', async () => {
    ready(sighting({ confirmedFeatures: [] }));
    const view = await renderScreen();
    expect(view.queryByText('What they saw')).toBeNull();
    expect(view.getByText('Details')).toBeTruthy();
  });

  it('lists your marks before their answers and note', async () => {
    const view = await renderScreen();
    const texts = textsInOrder(view);
    const at = (text: string) => texts.indexOf(text);
    // An older report (no "asked about" record): the seen ones, no total.
    expect(at('Your marks they could see')).toBeGreaterThan(-1);
    expect(at('Your marks they could see')).toBeLessThan(at('Doing'));
    expect(at('Doing')).toBeLessThan(at('In their words'));
  });

  it('⚠️ lists ALL the marks they were asked about, ticking the ones they saw', async () => {
    mockListingMarks = [
      { id: 'm1', description: 'Dent on the rear door' },
      { id: 'm2', description: 'Roof box' },
      { id: 'm3', description: 'Bee sticker' },
    ];
    ready(sighting({ offeredFeatureIds: ['m1', 'm2', 'm3'] })); // saw m1 only
    const view = await renderScreen();
    expect(view.getByText('Seen 1 of 3')).toBeTruthy();
    expect(view.getByLabelText('Dent on the rear door, seen')).toBeTruthy();
    expect(view.getByLabelText('Roof box, not seen')).toBeTruthy();
    expect(view.getByLabelText('Bee sticker, not seen')).toBeTruthy();
    // Read-only: nothing here to tick.
    expect(view.queryByRole('checkbox')).toBeNull();
  });

  it('lists the marks even when they saw none — "none seen" is an answer', async () => {
    mockListingMarks = [{ id: 'm2', description: 'Roof box' }];
    ready(
      sighting({
        offeredFeatureIds: ['m2'],
        confirmedFeatures: [],
        contextFlags: [],
        note: null,
        parkedLikelihood: null,
        peoplePresence: null,
      }),
    );
    const view = await renderScreen();
    expect(view.getByText('What they saw')).toBeTruthy();
    expect(view.getByText('Seen 0 of 1')).toBeTruthy();
    expect(view.getByLabelText('Roof box, not seen')).toBeTruthy();
  });

  it('⚠️ an older report lists only what they saw — never "not seen" of a mark not asked', async () => {
    mockListingMarks = [
      { id: 'm1', description: 'Dent on the rear door' },
      { id: 'm2', description: 'Roof box' },
    ];
    ready(sighting({ offeredFeatureIds: null })); // reported before marks were recorded
    const view = await renderScreen();
    expect(view.getByText('Your marks they could see')).toBeTruthy();
    expect(view.getByLabelText('Dent on the rear door, seen')).toBeTruthy();
    expect(view.queryByLabelText('Roof box, not seen')).toBeNull();
    expect(view.queryByText(/^Seen \d+ of/)).toBeNull();
  });

  it('⚠️ shows the owner’s photo of each mark — on an older report too', async () => {
    mockListingMarks = [
      { id: 'm1', description: 'Dent on the rear door', photoUrl: 'https://x/m1.jpg' },
    ];
    ready(sighting({ offeredFeatureIds: null })); // older report: seen marks only
    const view = await renderScreen();
    expect(view.getByTestId('seen-mark-m1-photo')).toBeTruthy();
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

  it('shows the street address under "Where", as the listing page shows its place', async () => {
    mockAddress = 'Deansgate, Manchester, M3 2BW';
    const view = await renderScreen();
    expect(view.getByTestId('sighting-address')).toBeTruthy();
    expect(view.getByText('Deansgate, Manchester, M3 2BW')).toBeTruthy();
    // Looked up for the captured point, the stored area as the fallback.
    expect(mockAddressCall).toHaveBeenLastCalledWith(
      { lat: 53.4794, lng: -2.2453 },
      'Deansgate, Manchester',
    );
  });

  it('no longer says how approximate the point is (owner, 2026-10-20)', async () => {
    ready(sighting({ photos: [{ ...sighting().photos[0], accuracyM: 240 }] }));
    const view = await renderScreen();
    expect(view.queryByText(/Approximate/)).toBeNull();
  });

  it('says so when there is no location at all — and offers nothing to open', async () => {
    ready(sighting({ locationUnavailable: true, areaLabel: null, photos: [sighting().photos[1]] }));
    const view = await renderScreen();
    expect(view.getByText('Location couldn’t be captured for this sighting.')).toBeTruthy();
    expect(view.queryByTestId('sighting-open-google-maps')).toBeNull();
    expect(view.queryByTestId('sighting-open-waze')).toBeNull();
    expect(view.getByText(SAFETY_NOTICE_BODY)).toBeTruthy();
  });

  it('⚠️ sets the answers out as a table — a short label, then plain answers', async () => {
    ready(
      sighting({
        contextFlags: ['parked', 'damage_visible', 'plate_changed'],
        parkedLikelihood: 'settled',
        peoplePresence: 'nearby',
      }),
    );
    const view = await renderScreen();
    expect(view.getByTestId('sighting-answers')).toBeTruthy();
    expect(view.getByText('Doing')).toBeTruthy();
    expect(view.getByText('People')).toBeTruthy();
    expect(view.getByText('Condition')).toBeTruthy();
    // A state's follow-up shares its line; conditions take a line each.
    expect(view.getByText(/^Parked · /)).toBeTruthy();
    expect(view.getByText('Damage visible')).toBeTruthy();
    expect(view.getByText('Plate changed or missing')).toBeTruthy();
    // One statement per row for a screen reader…
    expect(view.getByTestId('seen-condition').props.accessibilityLabel).toBe(
      'Condition: Damage visible, Plate changed or missing',
    );
    // …and nothing here is a control.
    expect(view.queryByRole('radio')).toBeNull();
    expect(view.queryByRole('checkbox')).toBeNull();
  });

  it('⚠️ stacks each row — label over answers — at large text', async () => {
    const dimensions = jest
      .spyOn(ReactNative.Dimensions, 'get')
      .mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 2 });
    try {
      ready(sighting({ contextFlags: ['parked'], peoplePresence: 'nearby' }));
      const view = await renderScreen();
      const row = StyleSheet.flatten(view.getByTestId('seen-state').props.style);
      expect(row.flexDirection).toBe('column');
      // ⚠️ No flex: 1 when stacked — in an auto-height column it collapses
      // the answers cell.
      const cell = StyleSheet.flatten(view.getByTestId('seen-state-answers').props.style);
      expect(cell.flex).toBeUndefined();
      expect(view.getByTestId('seen-people')).toBeTruthy();
    } finally {
      dimensions.mockRestore();
    }
  });

  it('sits side by side at normal text', async () => {
    // Explicit: React Native's Jest setup reports fontScale 2 by default.
    const dimensions = jest
      .spyOn(ReactNative.Dimensions, 'get')
      .mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 1 });
    try {
      const view = await renderScreen();
      const row = StyleSheet.flatten(view.getByTestId('seen-state').props.style);
      expect(row.flexDirection).toBe('row');
      // Side by side, the answers take the rest of the row.
      const cell = StyleSheet.flatten(view.getByTestId('seen-state-answers').props.style);
      expect(cell.flex).toBe(1);
    } finally {
      dimensions.mockRestore();
    }
  });

  it('names the damage they saw on its Condition line (2026-10-21)', async () => {
    ready(
      sighting({
        contextFlags: ['parked', 'damage_visible', 'plate_changed'],
        damageKinds: ['smashed_window', 'dents_scrapes'],
      }),
    );
    const view = await renderScreen();
    expect(view.getByText('Damage visible · Smashed window, Dents or scrapes')).toBeTruthy();
    expect(view.getByText('Plate changed or missing')).toBeTruthy();
    expect(view.queryByTestId('seen-damage-note')).toBeNull();
  });

  it('quotes their words about the damage under the table, before "In their words"', async () => {
    ready(
      sighting({
        contextFlags: ['parked', 'damage_visible'],
        damageKinds: ['fire_damage'],
        damageNote: '  Scorched bonnet  ',
      }),
    );
    const view = await renderScreen();
    // One screen-reader stop, read as a statement.
    expect(view.getByTestId('seen-damage-note').props.accessibilityLabel).toBe(
      'About the damage: Scorched bonnet',
    );
    const texts = textsInOrder(view);
    const at = (text: string) => texts.indexOf(text);
    expect(at('Condition')).toBeLessThan(at('About the damage'));
    expect(at('About the damage')).toBeLessThan(at('Scorched bonnet'));
    expect(at('Scorched bonnet')).toBeLessThan(at('In their words'));
  });

  it('shows "Details" for their words about the damage alone', async () => {
    ready(
      sighting({
        contextFlags: [],
        parkedLikelihood: null,
        peoplePresence: null,
        note: null,
        damageNote: 'Mirror hanging off',
      }),
    );
    const view = await renderScreen();
    expect(view.getByRole('header', { name: 'Details' })).toBeTruthy();
    expect(view.queryByTestId('sighting-answers')).toBeNull();
    expect(view.getByText('Mirror hanging off')).toBeTruthy();
  });

  it('names the missing parts in brackets, and quotes their words after the damage’s (2026-10-21)', async () => {
    ready(
      sighting({
        contextFlags: ['parked', 'damage_visible'],
        damageKinds: ['smashed_window', 'missing_parts'],
        damageNote: 'Glass everywhere',
        missingParts: ['bumpers', 'doors'],
        missingPartsNote: '  Rear bumper on the pavement ',
      }),
    );
    const view = await renderScreen();
    expect(
      view.getByText('Damage visible · Smashed window, Missing panels or parts (Bumpers, Doors)'),
    ).toBeTruthy();
    expect(view.getByTestId('seen-parts-note').props.accessibilityLabel).toBe(
      'About what’s missing: Rear bumper on the pavement',
    );
    const texts = textsInOrder(view);
    const at = (text: string) => texts.indexOf(text);
    expect(at('Glass everywhere')).toBeLessThan(at('About what’s missing'));
    expect(at('About what’s missing')).toBeLessThan(at('Rear bumper on the pavement'));
    expect(at('Rear bumper on the pavement')).toBeLessThan(at('In their words'));
  });

  it('shows "Details" for their words about what’s missing alone', async () => {
    ready(
      sighting({
        contextFlags: [],
        parkedLikelihood: null,
        peoplePresence: null,
        note: null,
        missingPartsNote: 'Both mirrors',
      }),
    );
    const view = await renderScreen();
    expect(view.getByRole('header', { name: 'Details' })).toBeTruthy();
    expect(view.getByText('Both mirrors')).toBeTruthy();
  });

  it('shows no table at all when no question was answered', async () => {
    ready(
      sighting({ contextFlags: [], parkedLikelihood: null, peoplePresence: null, direction: null }),
    );
    const view = await renderScreen();
    expect(view.queryByTestId('sighting-answers')).toBeNull();
  });

  it('leaves out a question they skipped — never an empty one', async () => {
    ready(sighting({ contextFlags: ['parked'], parkedLikelihood: null, peoplePresence: null }));
    const view = await renderScreen();
    expect(view.getByText('Doing')).toBeTruthy();
    expect(view.queryByText('People')).toBeNull();
    expect(view.queryByText('Condition')).toBeNull();
  });

  it('labels what they saw, sets their note apart, and lists your marks they could see', async () => {
    const view = await renderScreen();
    expect(view.getByLabelText('Doing: Parked, Looks parked up')).toBeTruthy();
    expect(view.getByText('In their words')).toBeTruthy();
    expect(view.getByText('Outside the Tesco on Deansgate')).toBeTruthy();
    expect(view.getByText('Dent on the rear door')).toBeTruthy();
  });

  it('shows who spotted it, and their record on one line — no "View profile"', async () => {
    const view = await renderScreen();
    expect(
      view.getByText('12 sightings · 4 confirmed by owners · 1 recovery · since July 2026'),
    ).toBeTruthy();
    expect(view.queryByText('View profile')).toBeNull();
  });
});

describe('the actions', () => {
  it.each([
    ['sighting-open-google-maps', 'Open in Google Maps', googleMapsPinUrl(53.4794, -2.2453)],
    ['sighting-open-waze', 'Open in Waze', wazePinUrl(53.4794, -2.2453)],
  ])(
    '⚠️ %s: the safety notice stands by the point — and again before that app opens',
    async (testID, confirmLabel, url) => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      try {
        const view = await renderScreen();
        expect(view.getAllByText(SAFETY_NOTICE_BODY)).toHaveLength(1);

        await press(view.getByTestId(testID));
        expect(openURL).not.toHaveBeenCalled();
        expect(view.getByText('Warning')).toBeTruthy();
        expect(view.getAllByText(SAFETY_NOTICE_BODY)).toHaveLength(2);

        // A pin in the app they picked — never directions (§1).
        await press(last(view.getAllByRole('button', { name: confirmLabel })));
        expect(openURL).toHaveBeenCalledWith(url);
        expect(openURL).toHaveBeenCalledTimes(1);
      } finally {
        openURL.mockRestore();
      }
    },
  );

  it('offers both apps side by side, each by name', async () => {
    const view = await renderScreen();
    // Named by their visible words, so voice control matches them.
    expect(view.getByRole('button', { name: 'Google Maps' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'Waze' })).toBeTruthy();
    expect(view.getByLabelText('Address: Deansgate, Manchester')).toBeTruthy();
    // The marks are hidden from screen readers (the label names the app).
    expect(view.getByTestId('google-maps-logo', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByTestId('waze-logo', { includeHiddenElements: true })).toBeTruthy();
  });

  it.each(['unverified', 'not_mine', 'helpful', 'credited'] as const)(
    '⚠️ Message is in the spotter card, once, whatever the answer (%s)',
    async (status) => {
      ready(
        sighting({ status, reviewedAt: status === 'unverified' ? null : '2026-10-08T11:00:00Z' }),
      );
      const view = await renderScreen();
      expect(view.getAllByRole('button', { name: 'Message Sam' })).toHaveLength(1);
      expect(
        within(view.getByTestId('spotter-card')).getByRole('button', { name: 'Message Sam' }),
      ).toBeTruthy();
    },
  );

  it('Message opens the conversation by sighting — before deciding, too', async () => {
    const view = await renderScreen();
    await press(view.getByRole('button', { name: 'Message Sam' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/chat/t1'));
    expect(mockOpenThread).toHaveBeenCalledWith(SIGHTING_ID);
  });
});
