/**
 * WHAT:  Tests for useStartReport — the + button's action: it waits for the
 *        garage answer and the saved draft (never longer than the grace),
 *        then opens the report with ONE navigation; repeat taps while it
 *        waits do nothing.
 * WHY:   The report must slide up already built, and once: the old + pushed a
 *        chooser that replaced itself with the form (two transitions). A
 *        double push would be the same jank by another route, and an unbounded
 *        wait would make the + feel dead on a slow network.
 * LINKS: src/features/garage/hooks/useStartReport.ts; docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import { motion } from '@/shared/theme';

import { useStartReport } from './useStartReport';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/features/auth', () => ({ getCurrentUserId: () => 'u1' }));

const mockPrimeDraft = jest.fn(async () => {});
jest.mock('@/features/vehicles', () => ({ primePostDraft: () => mockPrimeDraft() }));

const mockAwaitGarage = jest.fn(async (_userId: string | null, _timeoutMs: number) => {});
jest.mock('../lib/loadGarage', () => ({
  awaitGarageAnswer: (userId: string | null, timeoutMs: number) => mockAwaitGarage(userId, timeoutMs),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPrimeDraft.mockResolvedValue(undefined);
  mockAwaitGarage.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useStartReport', () => {
  it('reads the garage for the user signed in NOW, and the draft, then pushes once', async () => {
    const { result } = await renderHook(() => useStartReport());

    await act(async () => {
      result.current();
    });

    expect(mockAwaitGarage).toHaveBeenCalledWith('u1', motion.skeletonGrace);
    expect(mockPrimeDraft).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/post-a-car');
  });

  it('ignores a second tap while the first is still on its way', async () => {
    let finish: (() => void) | undefined;
    mockAwaitGarage.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = await renderHook(() => useStartReport());

    await act(async () => {
      result.current();
      result.current();
    });
    await act(async () => {
      finish?.();
    });

    expect(mockAwaitGarage).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('never waits longer than the grace, however slow the network', async () => {
    jest.useFakeTimers();
    mockAwaitGarage.mockReturnValue(new Promise<void>(() => {})); // never settles
    const { result } = await renderHook(() => useStartReport());

    await act(async () => {
      result.current();
    });
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(motion.skeletonGrace);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
