/**
 * WHAT:  Tests for usePayoutAccount — the derived states, and the settling
 *        window that covers the gap between finishing Stripe and the webhook
 *        arriving.
 * WHY:   Two of these states are indistinguishable in the data for a few
 *        seconds ("just finished" and "gave up half way" are both a row with
 *        both flags false), so the window is the only thing stopping the screen
 *        blaming someone who did nothing wrong. And a window that never closes
 *        is a poller on a money screen — the termination test below is the one
 *        that keeps it honest.
 * LINKS: ./usePayoutAccount.ts; ../api/payoutsApi.ts; docs/TESTING.md.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { usePayoutAccount } from './usePayoutAccount';

const mockFetch = jest.fn();
jest.mock('../api/payoutsApi', () => ({
  fetchMyPayoutAccount: (...args: unknown[]) => mockFetch(...args),
}));

let mockSession: { status: string; userId?: string } = {
  status: 'signedIn',
  userId: 'user-1',
};
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession,
}));

/**
 * The hook under test, rendered rather than captured. Writing its return to an
 * outer variable is what the compiler's rules exist to stop — so the state goes
 * into the tree and the assertions read it back out, which is also how a real
 * consumer sees it.
 */
function Probe() {
  const state = usePayoutAccount();
  return (
    <>
      <Text testID="status">{state.status}</Text>
      <Text testID="settling">{String(state.settling)}</Text>
      <Text testID="settle" onPress={state.settleReturn}>
        settle
      </Text>
    </>
  );
}

const statusIs = () => screen.getByTestId('status').props.children;
const settlingIs = () => screen.getByTestId('settling').props.children;
const settle = async () => {
  await act(async () => {
    fireEvent.press(screen.getByTestId('settle'));
  });
};

const account = (overrides: Partial<{ onboardingComplete: boolean; payoutsEnabled: boolean }>) => ({
  stripeAccountId: 'acct_123',
  onboardingComplete: false,
  payoutsEnabled: false,
  ...overrides,
});

/** Let the pending fetch resolve and the state commit. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSession = { status: 'signedIn', userId: 'user-1' };
  mockFetch.mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the derived states', () => {
  it('reports a guest without reading anything', async () => {
    mockSession = { status: 'signedOut' };
    await act(async () => render(<Probe />));
    expect(statusIs()).toBe('guest');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('no row means they have never started', async () => {
    mockFetch.mockResolvedValue(null);
    await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('notStarted');
  });

  it('a row with nothing submitted means they stopped part way', async () => {
    mockFetch.mockResolvedValue(account({ onboardingComplete: false }));
    await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('unfinished');
  });

  it('submitted but not enabled means STRIPE is deciding, not them', async () => {
    // The distinction the whole feature turns on: nothing is being asked of
    // this person, so they must not be told to pick up where they left off.
    mockFetch.mockResolvedValue(account({ onboardingComplete: true, payoutsEnabled: false }));
    await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('verifying');
  });

  it('payouts enabled is the only thing that means ready', async () => {
    mockFetch.mockResolvedValue(account({ onboardingComplete: false, payoutsEnabled: true }));
    await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('ready');
  });

  it('reports a failed read as an error, never as "not set up"', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));
    await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('error');
  });

  it('never shows one user the previous user’s account', async () => {
    mockFetch.mockResolvedValue(account({ payoutsEnabled: true }));
    const view = await act(async () => render(<Probe />));
    await flush();
    expect(statusIs()).toBe('ready');

    // The SAME mounted hook, now reporting a different signed-in user — the
    // real shape of a sign-out/sign-in, not a fresh mount.
    mockSession = { status: 'signedIn', userId: 'user-2' };
    mockFetch.mockReturnValue(new Promise(() => {})); // second read never settles
    await act(async () => {
      view.rerender(<Probe />);
    });

    // Keyed on the user, so the previous row cannot be reused while the new
    // one loads. This is money; a flash of someone else's "ready" is not a
    // cosmetic flicker, it is telling the wrong person they will be paid.
    expect(statusIs()).toBe('loading');
  });
});

describe('the settling window', () => {
  it('re-reads on a return, and reports settling while it does', async () => {
    await act(async () => render(<Probe />));
    await flush();
    const before = mockFetch.mock.calls.length;

    await settle();
    expect(settlingIs()).toBe("true");
    expect(mockFetch.mock.calls.length).toBeGreaterThan(before);
  });

  it('TERMINATES — it is a bounded re-check, not a poller', async () => {
    // The test that stops this becoming a background poll on a money screen in
    // six months' time. After the window closes the count must stop moving.
    await act(async () => render(<Probe />));
    await flush();
    await settle();

    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    await flush();
    const settled = mockFetch.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await flush();
    expect(mockFetch.mock.calls.length).toBe(settled);
    expect(settlingIs()).toBe("false");
  });

  it('stops early once payouts are enabled', async () => {
    await act(async () => render(<Probe />));
    await flush();

    mockFetch.mockResolvedValue(account({ onboardingComplete: true, payoutsEnabled: true }));
    await settle();
    await flush();

    expect(settlingIs()).toBe("false");
    const enabled = mockFetch.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    await flush();
    // No point still looking for an answer we have.
    expect(mockFetch.mock.calls.length).toBe(enabled);
  });

  it('is idempotent — Android fires the return TWICE for one journey', async () => {
    // openAuthSessionAsync resolves AND the deep link navigates, both for the
    // same single return. Two windows would double every read.
    await act(async () => render(<Probe />));
    await flush();
    const before = mockFetch.mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByTestId('settle'));
      fireEvent.press(screen.getByTestId('settle'));
    });
    expect(mockFetch.mock.calls.length).toBe(before + 1);
  });

  it('stops reading when the screen goes away', async () => {
    const view = await act(async () => render(<Probe />));
    await flush();
    await settle();
    const onUnmount = mockFetch.mock.calls.length;

    await act(async () => {
      view.unmount();
      jest.advanceTimersByTime(20000);
    });
    expect(mockFetch.mock.calls.length).toBe(onUnmount);
  });
});
