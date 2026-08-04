/**
 * WHAT:  Tests for the recovery screen — the two endings, and the guard in
 *        front of both.
 * WHY:   Confirming here spends money one way or the other and cannot be
 *        undone: it either sends the bounty to a spotter or refunds it. So the
 *        tests care about exactly three things — that nothing happens until a
 *        choice is made, that each choice calls the right thing with the right
 *        argument, and that the no-spotter ending actually issues the refund
 *        rather than leaving the post stranded in `recovery_claimed`.
 * LINKS: ./RecoverPostScreen.tsx; ../api/recoveryApi.ts;
 *        supabase/migrations/20260802200000_claim_recovery.sql.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { RecoverPostScreen } from './RecoverPostScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useFocusEffect: () => {},
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

// Mocked at the feature boundary: the real barrel reaches the Supabase client.
let mockSightings: unknown[] = [];
jest.mock('@/features/sightings', () => ({
  usePostSightings: () => ({ status: 'ready', sightings: mockSightings, photoUrls: {} }),
}));

// Same reason — the notifications barrel pulls pushTokenApi → shared/api.
const mockNotifyCredited = jest.fn();
jest.mock('@/features/notifications', () => ({
  notifyCredited: (...args: unknown[]) => mockNotifyCredited(...args),
}));

const mockClaim = jest.fn();
const mockRefund = jest.fn();
const mockRelease = jest.fn();
jest.mock('../api/recoveryApi', () => {
  class RecoveryError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'RecoveryError';
      this.code = code;
    }
  }
  return {
    RecoveryError,
    get claimRecovery() {
      return mockClaim;
    },
    get refundRecovery() {
      return mockRefund;
    },
    get releasePayout() {
      return mockRelease;
    },
  };
});

const SIGHTING = {
  id: 'sighting-1',
  createdAt: '2026-08-01T10:00:00Z',
  status: 'unverified',
  areaLabel: 'Camden',
  note: 'Parked outside the station',
  photos: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSightings = [SIGHTING];
  mockClaim.mockResolvedValue({ nextStep: 'refund', creditedSightingId: null });
  mockRefund.mockResolvedValue({ refundedPence: 24000 });
  mockRelease.mockResolvedValue({ status: 'awaiting_payee', transferPence: null });
});

describe('the guard', () => {
  it('does nothing until a choice is made', async () => {
    const { getByText } = await act(async () => render(<RecoverPostScreen postId="p1" />));

    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });
    // Money must not move on a stray tap.
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

describe('crediting a spotter', () => {
  it('claims with that sighting id and does NOT refund', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('p1', 'sighting-1'));
    // The bounty is the spotter's — refunding it to the owner would take it.
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('does not promise the spotter has been PAID', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    // A payout needs the spotter's Stripe details, which we do not control.
    // Saying "paid" would be a promise we cannot keep.
    const said = String(mockShowToast.mock.calls[0][0]);
    expect(said).not.toMatch(/\bpaid\b/i);
  });

  it('tells the spotter they earned it — the earn moment fires on credit', async () => {
    // Whatever the payout below does (paid, awaiting_payee, held_for_review),
    // the spotter genuinely earned the bounty the moment the credit landed,
    // and the push is what makes that moment exist for them.
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockNotifyCredited).toHaveBeenCalledWith('p1'));
  });

  it('says nothing to anyone on the found-it-myself ending', async () => {
    // No spotter earned anything; a push here would be noise at best and a
    // wrong promise at worst.
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );
    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });
    await waitFor(() => expect(mockRefund).toHaveBeenCalled());
    expect(mockNotifyCredited).not.toHaveBeenCalled();
  });

  // Until 2026-08-03 this branch called NOTHING. It showed "we'll get the
  // bounty to them" and went back, leaving the money in escrow and the post
  // stranded on `recovery_claimed` — which also blocked the owner's account
  // deletion for good. The assertion that matters is simply: it asks.
  it('actually releases the bounty', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockRelease).toHaveBeenCalledWith('p1'));
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('says the money has MOVED when it has', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    mockRelease.mockResolvedValue({ status: 'paid', transferPence: 23750 });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    // 95% of £250. The owner is told the real figure, not a round bounty.
    expect(String(mockShowToast.mock.calls[0][0])).toContain('£237.50');
  });

  it('blames nobody when the spotter has not onboarded yet', async () => {
    // The NORMAL first answer: a spotter has no Stripe account until a sighting
    // of theirs is credited, which is this exact moment.
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    mockRelease.mockResolvedValue({ status: 'awaiting_payee', transferPence: null });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [said, kind] = mockShowToast.mock.calls[0];
    expect(String(said)).toMatch(/bank details/i);
    expect(kind).toBeUndefined(); // news, not an error
  });

  it('says WE are double-checking when the payout is held — never the bank-details line', async () => {
    // A held payout is our doing (the collusion gate). The bank-details copy
    // would send the owner to chase the spotter about a delay that is ours,
    // and naming the reason would teach a fraudster which signal caught them.
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    mockRelease.mockResolvedValue({ status: 'held_for_review', transferPence: null });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [said, kind] = mockShowToast.mock.calls[0];
    expect(String(said)).toMatch(/double-checking/i);
    expect(String(said)).not.toMatch(/bank details/i);
    expect(String(said)).not.toMatch(/device|card|email/i); // reasons never surface
    expect(kind).toBeUndefined(); // news, not an error
  });

  it('never tells the owner to try again when the payout fails', async () => {
    // The claim has already landed and CANNOT be redone — `claim_recovery`
    // accepts `active` only, and the post no longer is. Sending them back to a
    // screen that will now refuse them is the worst possible answer.
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    mockRelease.mockRejectedValue(new Error('network'));
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [said, kind] = mockShowToast.mock.calls[0];
    expect(String(said)).toMatch(/credited/i);
    expect(String(said)).not.toMatch(/try again/i);
    expect(kind).not.toBe('error');
    // And it still leaves the screen — the recovery IS recorded.
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});

describe('found it another way', () => {
  it('claims with null and then issues the refund', async () => {
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('p1', null));
    // Without this second call the post is stranded in recovery_claimed with
    // the bounty still in escrow — claimed, but nobody paid and nobody refunded.
    await waitFor(() => expect(mockRefund).toHaveBeenCalledWith('p1'));
  });

  it('is offered even when there were no sightings at all', async () => {
    mockSightings = [];
    const { getByTestId } = await act(async () => render(<RecoverPostScreen postId="p1" />));
    expect(getByTestId('credit-none')).toBeTruthy();
  });
});

describe('when the server refuses', () => {
  it('shows the server’s reason rather than a generic failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- reaching the mocked class
    const { RecoveryError } = require('../api/recoveryApi');
    mockClaim.mockRejectedValue(
      new RecoveryError('This listing isn’t live, so it can’t be marked recovered.', 'POST_NOT_ACTIVE'),
    );
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'This listing isn’t live, so it can’t be marked recovered.',
        'error',
      ),
    );
    expect(mockBack).not.toHaveBeenCalled(); // stay put so they can retry
  });
});
