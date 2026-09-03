/**
 * WHAT:  Orchestration tests for MySightingsScreen — the five states it can be
 *        in (signed out / loading / error / empty / populated), the four verdict
 *        labels, the "a car" fallback, and the one composed label a screen
 *        reader hears per report.
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

import { act, fireEvent, render } from '@testing-library/react-native';
import * as RN from 'react-native';

import type { MySightingRecordEntry } from '../api/sightingApi';

import { SightingWithdrawError } from '../lib/sightingWithdrawError';

import { MySightingsScreen } from './MySightingsScreen';

const mockUseRecord = jest.fn();
jest.mock('../hooks/useMySightingRecord', () => ({
  useMySightingRecord: () => mockUseRecord(),
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
const mockWithdraw = jest.fn(async (_sightingId: string) => {});
jest.mock('../api/sightingApi', () => ({
  withdrawSighting: (sightingId: string) => mockWithdraw(sightingId),
}));

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    useToast: () => ({ show: mockToastShow }),
    // The confirm is fired straight through: what these tests are about is what
    // the screen does WITH a confirmation, and the dialog has its own suite.
    ConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => (
      <Pressable testID="confirm-withdraw" onPress={onConfirm} />
    ),
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
    DayHeader: ({ label }: { label: string }) => <Text accessibilityRole="header">{label}</Text>,
    DayHeaderSkeleton: () => <View testID="day-header-skeleton" />,
    CarColourTile: ({ testID }: { testID?: string }) => <View testID={testID} />,
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

describe('⚠️ grouped by day', () => {
  // The owner asked for the cards organised by date. The labels are the inbox's
  // words on purpose — a spotter should not meet two vocabularies for "when" in
  // one app.
  it('heads each day with the calendar word for it', async () => {
    mockUseRecord.mockReturnValue(
      ready([
        entry({ id: 'a', createdAt: new Date().toISOString() }),
        entry({ id: 'b', createdAt: new Date(Date.now() - DAY_MS).toISOString() }),
      ]),
    );
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Yesterday')).toBeTruthy();
  });

  it('⚠️ heads a day ONCE, however many reports it holds', async () => {
    // groupByDay only emits a header when the label changes, which relies on the
    // RPC's newest-first order. Three headers for three same-day reports would
    // be the tell that the order assumption broke.
    const today = new Date().toISOString();
    mockUseRecord.mockReturnValue(
      ready([
        entry({ id: 'a', createdAt: today, car: { make: 'Ford', colour: 'Blue' } }),
        entry({ id: 'b', createdAt: today, car: { make: 'VW', colour: 'Silver' } }),
        entry({ id: 'c', createdAt: today, car: { make: 'BMW', colour: 'Black' } }),
      ]),
    );
    const { getAllByText, getByText } = await render(<MySightingsScreen />);

    expect(getAllByText('Today')).toHaveLength(1);
    expect(getByText('Blue Ford')).toBeTruthy();
    expect(getByText('Black BMW')).toBeTruthy();
  });

  it('names older days by date rather than counting back', async () => {
    // Past "Yesterday", "6 days ago" stops being a word anyone thinks in.
    const old = new Date('2026-07-23T10:00:00.000Z');
    mockUseRecord.mockReturnValue(ready([entry({ createdAt: old.toISOString() })]));
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('23 July')).toBeTruthy();
  });

  it('⚠️ gives a screen reader a real heading to navigate DAYS by', async () => {
    // ⚠️ THE DAY, NOT THE PAGE TITLE. The first version of this asserted
    // `name: 'My reports'`, which passed before day grouping existed and would
    // keep passing if `accessibilityRole="header"` were deleted from the day
    // label — so the one new affordance in the change was uncovered.
    mockUseRecord.mockReturnValue(ready([entry({ createdAt: new Date().toISOString() })]));
    const { getByRole } = await render(<MySightingsScreen />);

    expect(getByRole('header', { name: 'Today' })).toBeTruthy();
    expect(getByRole('header', { name: 'My reports' })).toBeTruthy();
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
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('Waiting on the owner')).toBeTruthy();
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
    const { getByLabelText } = await render(<MySightingsScreen />);

    expect(
      getByLabelText('Blue Ford, reported in Camden 3d ago. Waiting on the owner'),
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
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText(label)).toBeTruthy();
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
    expect(mockWithdraw).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId('confirm-withdraw'));
    });
    expect(mockWithdraw).toHaveBeenCalledWith('s1');
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

    expect(mockToastShow).toHaveBeenCalledWith('Report taken back. The owner no longer sees it.');
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
      'We couldn’t withdraw that report. Please try again.',
      'error',
    );
  });

  it('reads a withdrawn report as the spotter’s own act, not a verdict', async () => {
    mockUseRecord.mockReturnValue(ready([entry({ status: 'withdrawn' })]));
    const { getByText } = await render(<MySightingsScreen />);

    expect(getByText('You took this back')).toBeTruthy();
  });
});
