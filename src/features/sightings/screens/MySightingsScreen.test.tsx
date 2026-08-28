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

import { fireEvent, render } from '@testing-library/react-native';
import * as RN from 'react-native';

import type { MySightingRecordEntry } from '../api/sightingApi';

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

jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
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
