/**
 * WHAT:  Orchestration tests for MySightingsScreen — the five states it can be
 *        in (signed out / loading / error / empty / populated), the sections
 *        (waiting first) and the summary line, the spotter's own photo or the
 *        tile (and the empty frame while it loads), what happens next per
 *        outcome (promising nothing it can't keep), the four
 *        verdict labels, the "a car" fallback, and the one composed label a
 *        screen reader hears per report.
 * WHY:   ⚠️ THIS SCREEN SHIPPED WITH NO TESTS AT ALL. Nothing pinned its copy,
 *        its state switch, or the verdict wording — and the verdict wording is
 *        the most load-bearing copy in the feature: `not_mine` is the absence of
 *        a confirmation, not a failure, and this is the ONLY surface it appears
 *        on. "Rejected", "Not confirmed" or anything red would be both unkind
 *        and untrue, and until now a well-meaning edit could have shipped one.
 *
 *        The 2026-08-27 redesign moved the row into ReportCard; these assertions
 *        are written against what the SCREEN renders, so the same contract holds
 *        wherever the card lives next.
 * LINKS: ./MySightingsScreen.tsx; ../components/ReportCard.tsx;
 *        ../api/sightingApi.ts (MySightingRecordEntry); docs/TESTING.md.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import * as RN from 'react-native';

import type { MySightingRecordEntry } from '../api/sightingApi';

import { SightingWithdrawError } from '../lib/sightingWithdrawError';

import { MySightingsScreen } from './MySightingsScreen';

const mockUseRecord = jest.fn();
jest.mock('../hooks/useMySightingRecord', () => ({
  useMySightingRecord: () => mockUseRecord(),
}));

// The spotter's own photos, by sighting id — fetched and signed beside the
// list; driven directly here (the hook and its api have their own tests).
type Photos = { urls: Record<string, string>; lookedUp: Record<string, true> };
/** Every report looked up, with these photos. */
const settled =
  (urls: Record<string, string> = {}) =>
  (ids: string[]): Photos => ({
    urls,
    lookedUp: Object.fromEntries(ids.map((id) => [id, true as const])),
  });
const mockPhotos = jest.fn((ids: string[]): Photos => settled()(ids));
jest.mock('../hooks/useMyReportPhotos', () => ({
  useMyReportPhotos: (ids: string[]) => mockPhotos(ids),
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

// ⚠️ The api module reaches the supabase client, which throws at import
// without env — but SightingWithdrawError is NOT mocked with it. It lives in
// lib/ precisely so the screen's `instanceof` narrowing can be tested against
// the REAL class: a stub here would let these pass while the shipped guard
// rejected the very error it exists to show.
const mockWithdraw = jest.fn(async (_sightingId: string, _reason?: string | null) => {});
jest.mock('../api/sightingApi', () => ({
  withdrawSighting: (sightingId: string, reason?: string | null) =>
    mockWithdraw(sightingId, reason),
}));

// The "why are you taking it back?" sheet, fired straight through with a
// chosen answer: what these tests are about is what the screen does WITH a
// confirmation; the sheet has its own suite.
// It takes the ref, so a test can see the screen actually OPEN it, and offers
// dismiss as well as confirm.
let mockSheetReason: string | null = null;
const mockSheetOpen = jest.fn();
jest.mock('../components/WithdrawSightingSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useImperativeHandle } = require('react');
  return {
    WithdrawSightingSheet: ({
      ref,
      onConfirm,
      onDismiss,
    }: {
      ref: unknown;
      onConfirm: (reason: string | null) => void;
      onDismiss?: () => void;
    }) => {
      useImperativeHandle(ref, () => ({ open: mockSheetOpen, close: jest.fn() }));
      return (
        <View>
          <Pressable testID="confirm-withdraw" onPress={() => onConfirm(mockSheetReason)} />
          <Pressable testID="dismiss-withdraw" onPress={() => onDismiss?.()} />
        </View>
      );
    },
  };
});

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    useToast: () => ({ show: mockToastShow }),
    Screen: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    EmptyState: ({
      title,
      body,
      actionLabel,
      onAction,
    }: {
      title: string;
      body?: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => (
      <View testID="empty">
        <Text>{title}</Text>
        {body ? <Text>{body}</Text> : null}
        {actionLabel ? (
          <Pressable testID="empty-action" onPress={onAction}>
            <Text>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    ),
    ErrorState: ({ body, onRetry }: { body?: string; onRetry?: () => void }) => (
      <Pressable testID="error-retry" onPress={onRetry}>
        <Text>{body}</Text>
      </Pressable>
    ),
    // Promoted to shared/ui on 2026-08-28 (DayHeader when the inbox's Messages
    // face became the third day-grouped list; CarColourTile when chat needed
    // the same no-photo fallback). This mock replaces the whole module, so
    // anything the screen or ReportCard pulls from it has to be named here or
    // it arrives undefined.
    DayHeader: ({ label, testID }: { label: string; testID?: string }) => (
      <Text accessibilityRole="header" testID={testID}>
        {label}
      </Text>
    ),
    DayHeaderSkeleton: () => <View testID="day-header-skeleton" />,
    CarColourTile: ({ testID }: { testID?: string }) => <View testID={testID} />,
    AppImage: ({ testID, uri }: { testID?: string; uri: string }) => (
      <View testID={testID} accessibilityHint={uri} />
    ),
    ThemedRefreshControl: () => null,
  };
});

const DAY_MS = 24 * 60 * 60 * 1000;

const entry = (overrides: Partial<MySightingRecordEntry> = {}): MySightingRecordEntry => ({
  id: 's1',
  createdAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
  status: 'unverified',
  reviewedAt: null,
  areaLabel: 'Camden',
  car: { make: 'Ford', colour: 'Blue' },
  ...overrides,
});

const ready = (entries: MySightingRecordEntry[]) => ({
  status: 'ready',
  entries,
  refreshing: false,
  refresh: jest.fn(),
  retry: jest.fn(),
});

beforeEach(() => {
  jest.clearAllMocks();
  // ⚠️ PIN THE FONT SCALE. jest-expo reports 2, which is past
  // `listRowStackFontScale` — so without this every case in this file silently
  // renders ReportCard's STACKED layout, the one most people never see, and the
  // ordinary row would have no coverage at all. Through `Dimensions.get`, which
  // is what `useWindowDimensions` reads. The stacking branch itself is covered
  // in ReportCard.test.tsx.
  jest
    .spyOn(RN.Dimensions, 'get')
    .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'u1' });
  mockUseRecord.mockReturnValue(ready([entry()]));
  mockPhotos.mockImplementation(settled());
});

// Restore, not clear: a spy's implementation survives clearAllMocks.
afterEach(() => {
  jest.restoreAllMocks();
});

describe('MySightingsScreen states', () => {
  it('invites a signed-out visitor in, rather than showing them nothing', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut' });
    const { getByText, getByTestId } = await render(<MySightingsScreen />);

    expect(getByText('Your reports live here')).toBeTruthy();
    fireEvent.press(getByTestId('empty-action'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'my_sightings' });
  });

  it('shows skeletons while the record loads', async () => {
    mockUseRecord.mockReturnValue({ ...ready([]), status: 'loading' });
    const { getByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sightings-skeleton')).toBeTruthy();
  });

  it('offers a retry when the fetch fails', async () => {
    const retry = jest.fn();
    mockUseRecord.mockReturnValue({ ...ready([]), status: 'error', retry });
    const { getByTestId } = await render(<MySightingsScreen />);

    fireEvent.press(getByTestId('error-retry'));
    expect(retry).toHaveBeenCalled();
  });

  it('explains the empty list and points somewhere useful', async () => {
    mockUseRecord.mockReturnValue(ready([]));
    const { getByText, getByTestId } = await render(<MySightingsScreen />);

    expect(getByText('No reports yet')).toBeTruthy();
    fireEvent.press(getByTestId('empty-action'));
    expect(mockPush).toHaveBeenCalledWith('/explore');
  });

  it('keeps a way back out of every state', async () => {
    const { getByTestId } = await render(<MySightingsScreen />);

    fireEvent.press(getByTestId('my-sightings-back'));
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('⚠️ needs-attention first (2026-10-09)', () => {
  const mixed = () => [
    entry({ id: 'a', status: 'helpful', car: { make: 'BMW', colour: 'Black' } }),
    entry({ id: 'b', status: 'withdrawn', car: { make: 'VW', colour: 'Silver' } }),
    entry({ id: 'c', status: 'unverified', car: { make: 'Ford', colour: 'Blue' } }),
    entry({ id: 'd', status: 'not_mine', car: { make: 'Fiat', colour: 'Red' } }),
  ];

  it('leads with what is still with the owner, then the answered, then the taken back', async () => {
    mockUseRecord.mockReturnValue(ready(mixed()));
    const { getAllByRole, getAllByTestId } = await render(<MySightingsScreen />);

    expect(getAllByRole('header').map((node) => node.props.children)).toEqual([
      'My sightings',
      'Still open',
      'Answered',
      'Taken back',
    ]);
    // …and the cards in that order, the RPC's order kept within a section.
    expect(getAllByTestId(/^my-sighting-[a-d]$/).map((node) => node.props.testID)).toEqual([
      'my-sighting-c',
      'my-sighting-a',
      'my-sighting-d',
      'my-sighting-b',
    ]);
  });

  it('leaves out a section with nothing in it', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ status: 'helpful' })]));
    const { queryByTestId, getByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('section-answered')).toBeTruthy();
    expect(queryByTestId('section-waiting')).toBeNull();
    expect(queryByTestId('section-withdrawn')).toBeNull();
  });

  it('says how they’re doing under the title — counted from the list', async () => {
    mockUseRecord.mockReturnValue(
      ready([...mixed(), entry({ id: 'e', status: 'credited' })]),
    );
    const { getByTestId } = await render(<MySightingsScreen />);

    // Withdrawn isn't counted; "Not a match" never becomes a number.
    const summary = getByTestId('my-sightings-summary');
    expect(summary).toHaveTextContent('4 reports · 2 helpful · 1 recovery');
    // Spoken with commas — some screen readers say "·" aloud.
    expect(summary.props.accessibilityLabel).toBe('4 reports, 2 helpful, 1 recovery');
  });

  it('holds the summary’s place while loading — and shows no count it doesn’t have', async () => {
    mockUseRecord.mockReturnValue({ ...ready([entry()]), status: 'loading' });
    const { getByTestId, queryByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sightings-summary-skeleton')).toBeTruthy();
    expect(queryByTestId('my-sightings-summary')).toBeNull();
  });

  it('shows no summary to someone signed out', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut' });
    const { queryByTestId } = await render(<MySightingsScreen />);

    expect(queryByTestId('my-sightings-summary')).toBeNull();
    expect(queryByTestId('my-sightings-summary-skeleton')).toBeNull();
  });
});

describe('the spotter’s own photo (2026-10-09)', () => {
  it('leads the card when there is one, and the colour tile stands in when not', async () => {
    mockPhotos.mockImplementation(settled({ a: 'https://x/a.jpg' }));
    mockUseRecord.mockReturnValue(ready([entry({ id: 'a' }), entry({ id: 'b' })]));
    const { getByTestId, queryByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sighting-photo-a').props.accessibilityHint).toBe('https://x/a.jpg');
    expect(queryByTestId('my-sighting-tile-a')).toBeNull();
    expect(getByTestId('my-sighting-tile-b')).toBeTruthy();
    expect(mockPhotos).toHaveBeenCalledWith(['a', 'b']);
  });

  it('⚠️ shows an empty frame while the photos are looked up — never the tile first', async () => {
    // The tile would claim "no photo" and then be replaced by one.
    mockPhotos.mockReturnValue({ urls: {}, lookedUp: {} });
    mockUseRecord.mockReturnValue(ready([entry({ id: 'a' })]));
    const { getByTestId, queryByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sighting-photo-pending-a')).toBeTruthy();
    expect(queryByTestId('my-sighting-tile-a')).toBeNull();
  });
});

describe('what happens next (2026-10-09)', () => {
  // ⚠️ Every line holds in EVERY case (reviews of #148): no notification is
  // promised (none is sent for "Not a match"), no counter (a capped
  // confirmation moves none), and nothing about money.
  it.each([
    ['unverified' as const, 'Their answer shows here.'],
    ['helpful' as const, 'Nothing more to do.'],
    ['credited' as const, 'Thank you.'],
    ['not_mine' as const, 'Thanks for looking.'],
  ])('a %s report on a live listing says "%s"', async (status, line) => {
    mockUseRecord.mockReturnValue(ready([entry({ status, postId: 'p1' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sighting-next-s1')).toHaveTextContent(line);
  });

  it('⚠️ an open report on a listing that isn’t live promises no answer — but not finality', async () => {
    // No post id = not active: closed, OR the owner choosing whom to credit,
    // where an open report may yet be credited. So "no longer live", not
    // "closed".
    mockUseRecord.mockReturnValue(ready([entry({ status: 'unverified', postId: null })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sighting-next-s1')).toHaveTextContent('The listing is no longer live.');
  });

  it('a withdrawn report has no next step', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ status: 'withdrawn' })]));
    const { queryByTestId } = await render(<MySightingsScreen />);

    expect(queryByTestId('my-sighting-next-s1')).toBeNull();
  });

  it('⚠️ never sends anyone to Payouts — this page knows nothing about rewards', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 'a', status: 'credited' })]));
    const { queryByText } = await render(<MySightingsScreen />);

    expect(queryByText(/payout|reward/i)).toBeNull();
  });
});

describe('a report', () => {
  it('leads with the car, because that is all the spotter has to recognise it by', async () => {
    const { getByText, getByTestId } = await render(<MySightingsScreen />);

    expect(getByText('Blue Ford')).toBeTruthy();
    expect(getByText('Camden · 3d ago')).toBeTruthy();
    expect(getByTestId('my-sighting-tile-s1')).toBeTruthy();
  });

  it('⚠️ says "a car" when the post described none', async () => {
    // The RPC coalesces rather than nulls, so both halves blank is a real row —
    // and the same fallback the confirmation push uses.
    mockUseRecord.mockReturnValue(ready([entry({ car: { make: '', colour: '' } })]));
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('a car')).toBeTruthy();
  });

  it('drops the area when the sighting had none, rather than printing a stray separator', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ areaLabel: null })]));
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('3d ago')).toBeTruthy();
  });

  it('⚠️ never dates a verdict nobody has given', async () => {
    // NULL reviewed_at means the owner has not looked. Dressing that up as a
    // decision would tell a spotter they had been answered when they had not.
    const { getByText, queryByText } = await render(<MySightingsScreen />);

    expect(getByText('Waiting on the owner')).toBeTruthy();
    expect(queryByText(/Waiting on the owner ·/)).toBeNull();
  });

  it('dates the verdict once there is one', async () => {
    mockUseRecord.mockReturnValue(
      ready([
        entry({
          status: 'helpful',
          reviewedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
        }),
      ]),
    );
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('Owner found this helpful · 2d ago')).toBeTruthy();
  });

  it('reads as one sentence to a screen reader, not three fragments', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ postId: 'p1' })]));
    const { getByLabelText } = await render(<MySightingsScreen />);

    expect(
      getByLabelText(
        // Times in words: "3d" would be read as "three d".
        'Blue Ford, reported in Camden 3 days ago. Waiting on the owner. Their answer shows here.',
      ),
    ).toBeTruthy();
  });
});

describe('⚠️ the verdict copy', () => {
  // One render each: two renders in one test poisons every later test in the
  // file. The exact words are the contract — see this file's header for why
  // `not_mine` in particular must never become "rejected".
  it.each([
    ['unverified' as const, 'Waiting on the owner'],
    ['helpful' as const, 'Owner found this helpful'],
    ['not_mine' as const, 'Not a match'],
    ['credited' as const, 'Credited — this one led to the recovery'],
  ])('reads %s as "%s"', async (status, label) => {
    mockUseRecord.mockReturnValue(ready([entry({ status })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    // On the card itself (the waiting section's title says the same words).
    expect(within(getByTestId('my-sighting-s1')).getByText(label)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ⚠️ Review finding #21. Sightings were CREATE-ONLY: a spotter who reported the
// wrong car — which the Terms explicitly call a normal outcome, not a failure —
// had no way to say so, and the report stood in front of the owner forever.
// ---------------------------------------------------------------------------
describe('taking a report back', () => {
  beforeEach(() => {
    mockWithdraw.mockClear().mockResolvedValue(undefined);
    mockToastShow.mockClear();
  });

  it('offers the way back only while nobody has ruled', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    expect(getByTestId('my-sighting-withdraw-s1')).toBeTruthy();
  });

  it.each(['helpful', 'not_mine', 'credited'] as const)(
    '⚠️ hides it once the owner has ruled %s',
    async (status) => {
      // The server refuses these outright — withdrawing after a verdict would
      // erase the owner's decision, and on `credited` one that moved money.
      // The control is hidden so the app never offers what it cannot do.
      mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status })]));
      const { queryByTestId } = await render(<MySightingsScreen />);

      expect(queryByTestId('my-sighting-withdraw-s1')).toBeNull();
    },
  );

  it('⚠️ confirms before withdrawing — it cannot be undone', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
    });

    // The tap alone must not call the server: withdrawing a REAL sighting by
    // mistake destroys the spotter's only claim on a bounty, and the rolling
    // rate limit counts the withdrawn row, so the slot is spent either way.
    // It OPENS the sheet instead.
    expect(mockWithdraw).not.toHaveBeenCalled();
    expect(mockSheetOpen).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });
    // No answer chosen → the reason travels as null (it is optional).
    expect(mockWithdraw).toHaveBeenCalledWith('s1', null);
  });

  it('⚠️ "Keep it" forgets the report — a later confirm sends nothing', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('dismiss-withdraw'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });
    expect(mockWithdraw).not.toHaveBeenCalled();
  });

  it('passes the spotter’s answer to "why?" with the withdrawal (2026-10-09)', async () => {
    mockSheetReason = 'not_the_car';
    try {
      mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
      const { getByTestId } = await render(<MySightingsScreen />);
      await act(async () => {
        fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
      });
      await act(async () => {
        fireEvent.press(getByTestId('confirm-withdraw'));
      });
      expect(mockWithdraw).toHaveBeenCalledWith('s1', 'not_the_car');
    } finally {
      mockSheetReason = null;
    }
  });

  it('says what happened, in the owner’s terms', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });

    expect(mockToastShow).toHaveBeenCalledWith('Report taken back — the owner no longer sees it.');
  });

  it('⚠️ shows OUR copy when the owner ruled between render and tap', async () => {
    // The real race this design has: the control was correctly offered, and by
    // the time it was tapped the server had a verdict. Its refusal must reach
    // the spotter as an explanation, never as a raw PostgREST string.
    mockWithdraw.mockRejectedValue(
      new SightingWithdrawError(
        'This one can’t be taken back — the owner has already looked at it.',
        'SIGHTING_NOT_WITHDRAWABLE',
      ),
    );
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      'This one can’t be taken back — the owner has already looked at it.',
      'error',
    );
  });

  it('⚠️ never shows a raw server error', async () => {
    mockWithdraw.mockRejectedValue(new Error('permission denied for table sightings'));
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', status: 'unverified' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('my-sighting-withdraw-s1'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });

    expect(mockToastShow).toHaveBeenCalledWith(
      'We couldn’t take that report back. Please try again.',
      'error',
    );
  });

  it('reads a withdrawn report as the spotter’s own act, not a verdict', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ status: 'withdrawn' })]));
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('You took this back')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ⚠️ Review finding #16. The screen showed a verdict and offered nowhere to go.
// The rule chosen: openable while the post is LIVE, unreachable once it closes
// — which is the privacy rule the payload has always kept, not a new one.
// ---------------------------------------------------------------------------
describe('opening the car a report was about', () => {
  it('opens the post when the server sent an id', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1', postId: 'p1' })]));
    const { getByTestId } = await render(<MySightingsScreen />);

    fireEvent.press(getByTestId('my-sighting-open-s1'));
    expect(mockPush).toHaveBeenCalledWith('/post/p1');
  });

  it('⚠️ stays flat when the post has closed (no id)', async () => {
    // The server sends null for a closed post, so there is nothing to press.
    // This is the wall that makes closed_uncredited route to the dispute
    // screen rather than the post, and it must not move.
    mockUseRecord.mockReturnValue(
      ready([entry({ id: 's1', postId: null, status: 'not_mine' })]),
    );
    const { queryByTestId } = await render(<MySightingsScreen />);

    expect(queryByTestId('my-sighting-open-s1')).toBeNull();
  });

  it('stays flat against a server that predates the field', async () => {
    // `postId` absent entirely — an older server. Reads the same as "closed":
    // no press target, exactly today's behaviour.
    mockUseRecord.mockReturnValue(ready([entry({ id: 's1' })]));
    const { queryByTestId } = await render(<MySightingsScreen />);

    expect(queryByTestId('my-sighting-open-s1')).toBeNull();
  });
});
