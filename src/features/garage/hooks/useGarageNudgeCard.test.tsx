/**
 * WHAT:  Tests for the Explore card's decision hook — when it shows, when it
 *        stays quiet, that accepting or dismissing settles it for good, and
 *        that the garage is not fetched unless it's worth asking.
 * WHY:   Two properties matter most. (1) It must never FLASH: rendering while
 *        the dismissal flag is still being read would show a card that vanishes
 *        a frame later. (2) The cheap checks must gate the expensive one — a
 *        brand-new or already-offered user must cost ZERO network on the app's
 *        hottest screen.
 * LINKS: src/features/garage/hooks/useGarageNudgeCard.ts, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { useGarageNudgeCard } from './useGarageNudgeCard';

const mockHasOffered = jest.fn<Promise<boolean>, []>();
const mockMarkOffered = jest.fn(async () => {});
jest.mock('../lib/garageNudgeStorage', () => ({
  hasOfferedGarageNudge: () => mockHasOffered(),
  markGarageNudgeOffered: () => mockMarkOffered(),
}));

// The signal is exercised in its own test; here we only care that the hook
// enables it at the right times and reacts to its answer.
let mockSavedCar: 'unknown' | 'none' | 'some' = 'none';
const mockUseHasSavedCar = jest.fn(({ enabled }: { enabled: boolean }) => {
  void enabled;
  return mockSavedCar;
});
jest.mock('./useHasSavedCar', () => ({
  useHasSavedCar: (opts: { enabled: boolean }) => mockUseHasSavedCar(opts),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const TENURED = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
const BRAND_NEW = new Date(Date.now() - 60 * 60 * 1000).toISOString();

/** Exposes the hook through rendered controls rather than an outer variable, so
 *  nothing is reassigned during render and the tests exercise it the way a
 *  screen would. */
function Probe({ accountCreatedAt }: { accountCreatedAt: string | null }) {
  const { visible, accept, dismiss } = useGarageNudgeCard({ accountCreatedAt });
  return (
    <>
      <Text>{visible ? 'visible' : 'hidden'}</Text>
      <Pressable testID="accept" onPress={accept}>
        <Text>accept</Text>
      </Pressable>
      <Pressable testID="dismiss" onPress={dismiss}>
        <Text>dismiss</Text>
      </Pressable>
    </>
  );
}

const renderProbe = (accountCreatedAt: string | null = TENURED) =>
  act(async () => render(<Probe accountCreatedAt={accountCreatedAt} />));

beforeEach(() => {
  jest.clearAllMocks();
  mockSavedCar = 'none';
  mockHasOffered.mockResolvedValue(false);
});

describe('when it shows', () => {
  it('shows for a tenured member with no saved car', async () => {
    const { getByText } = await renderProbe();

    expect(getByText('visible')).toBeTruthy();
  });
});

describe('when it stays quiet', () => {
  it('stays hidden once the offer has been made', async () => {
    mockHasOffered.mockResolvedValue(true);

    const { getByText } = await renderProbe();

    expect(getByText('hidden')).toBeTruthy();
  });

  it('stays hidden for a brand-new account', async () => {
    const { getByText } = await renderProbe(BRAND_NEW);

    expect(getByText('hidden')).toBeTruthy();
  });

  it('stays hidden for someone who already has a car', async () => {
    mockSavedCar = 'some';

    const { getByText } = await renderProbe();

    expect(getByText('hidden')).toBeTruthy();
  });

  it('stays hidden while the saved-car answer is unknown', async () => {
    mockSavedCar = 'unknown';

    const { getByText } = await renderProbe();

    expect(getByText('hidden')).toBeTruthy();
  });

  it('stays hidden with no account date at all', async () => {
    const { getByText } = await renderProbe(null);

    expect(getByText('hidden')).toBeTruthy();
  });
});

// The expensive check must sit BEHIND the cheap ones, or the app's hottest
// screen pays for a garage fetch on every mount for users who'd never see it.
describe('fetch gating', () => {
  it('does not enable the garage fetch for a brand-new account', async () => {
    await renderProbe(BRAND_NEW);

    expect(mockUseHasSavedCar).toHaveBeenCalled();
    expect(mockUseHasSavedCar.mock.calls.every(([opts]) => opts.enabled === false)).toBe(true);
  });

  it('does not enable it once the offer has been made', async () => {
    mockHasOffered.mockResolvedValue(true);

    await renderProbe();

    expect(mockUseHasSavedCar.mock.calls.every(([opts]) => opts.enabled === false)).toBe(true);
  });

  it('enables it only once both cheap checks pass', async () => {
    await renderProbe();

    expect(mockUseHasSavedCar.mock.calls.some(([opts]) => opts.enabled === true)).toBe(true);
  });
});

describe('settling the offer', () => {
  it('accepting hides it and records that we asked', async () => {
    const { getByText, getByTestId } = await renderProbe();
    expect(getByText('visible')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('accept'));
    });

    expect(getByText('hidden')).toBeTruthy();
    expect(mockMarkOffered).toHaveBeenCalledTimes(1);
  });

  it('dismissing hides it and records that we asked', async () => {
    const { getByText, getByTestId } = await renderProbe();

    await act(async () => {
      fireEvent.press(getByTestId('dismiss'));
    });

    expect(getByText('hidden')).toBeTruthy();
    // Same flag either way: it means "we asked", not "they declined", so the
    // exit sheet won't ask again about the same thing.
    expect(mockMarkOffered).toHaveBeenCalledTimes(1);
  });
});
