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
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Pressable, Text, View } = require('react-native');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
    // The real dialog is a bottom-sheet modal that needs its provider. This
    // stand-in keeps what the tests are about: nothing shows until open(), it
    // shows the title and body the owner would read, and its confirm label runs
    // onConfirm.
    ConfirmDialog: React.forwardRef(function MockConfirm(
      {
        title,
        body,
        confirmLabel,
        onConfirm,
      }: { title: string; body: string; confirmLabel: string; onConfirm: () => void },
      ref: unknown,
    ) {
      const [open, setOpen] = React.useState(false);
      React.useImperativeHandle(ref, () => ({ open: () => setOpen(true), close: () => setOpen(false) }));
      if (!open) return null;
      return (
        <View>
          <Text>{title}</Text>
          <Text>{body}</Text>
          <Pressable
            onPress={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            <Text>{confirmLabel}</Text>
          </Pressable>
        </View>
      );
    }),
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

// Same reason again — the payments barrel pulls the Stripe native module.
const mockExitCheck = jest.fn();
jest.mock('@/features/payments', () => ({
  exitCheck: (...args: unknown[]) => mockExitCheck(...args),
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

// The listing's money read (usePostMoney) reaches the Supabase client. Null by
// default — the screen then prices from the route's reward, as it does before
// the read lands; the amounts tests set a real answer.
const mockFetchMoney = jest.fn();
jest.mock('../api/postMoneyApi', () => ({
  fetchPostMoney: (...args: unknown[]) => mockFetchMoney(...args),
}));

/** "Confirm" opens a summary first (2026-09-25); the money moves on its "Yes, …".
 *  Two acts, because the dialog has to render before its button can be found. */
async function pressConfirm(
  getByText: (text: string | RegExp) => Parameters<typeof fireEvent.press>[0],
) {
  await act(async () => {
    fireEvent.press(getByText('Confirm'));
  });
  await act(async () => {
    fireEvent.press(getByText(/^Yes, /));
  });
}

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
  mockFetchMoney.mockResolvedValue(null);
  mockSightings = [SIGHTING];
  mockClaim.mockResolvedValue({ nextStep: 'refund', creditedSightingId: null });
  mockRefund.mockResolvedValue({ held: false, refundedPence: 24000 });
  mockRelease.mockResolvedValue({ status: 'awaiting_payee', transferPence: null });
  // Default: no recent uncredited sightings, so the exits behave exactly as
  // they did before the owner-denial gate. The attestation cases set true.
  mockExitCheck.mockResolvedValue({
    requiresAttestation: false,
    sightingIds: [],
    windowDays: 14,
    holdHours: 72,
  });
});

describe('the guard', () => {
  it('does nothing until a choice is made', async () => {
    const { getByText, queryByText } = await act(async () => render(<RecoverPostScreen postId="p1" />));

    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });
    // Money must not move on a stray tap — and no dialog opens to invite one.
    expect(queryByText(/^Yes, /)).toBeNull();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockRefund).not.toHaveBeenCalled();
  });
});

describe('the amounts, and one look before the money moves (2026-09-25)', () => {
  it('names what each choice sends or returns, and asks before it happens', async () => {
    // A £500 reward charged £525 with the fee on top: the spotter gets the
    // whole £500; found-it-myself returns about £516.92 (the charge less the
    // estimated card fee).
    mockFetchMoney.mockResolvedValue({
      kind: 'bounty_escrow',
      pricing: 'fee_on_top',
      state: 'held',
      headlinePence: 50000,
      rewardPence: 50000,
      serviceFeePence: 2500,
      chargedPence: 52500,
      hasCreditedSighting: false,
      paid: null,
      refund: null,
      refundHold: null,
    });
    mockClaim.mockResolvedValue({ nextStep: 'payout', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId, queryByText } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={50000} />),
    );

    expect(getByText(/About £516\.92 comes back to your card/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    expect(getByText(/send £500 to that spotter — the full reward/)).toBeTruthy();

    // Confirm opens the question; nothing has moved yet.
    await act(async () => {
      fireEvent.press(getByText('Confirm'));
    });
    expect(getByText('Send £500 to this spotter?')).toBeTruthy();
    expect(mockClaim).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByText('Yes, send it'));
    });
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('p1', 'sighting-1'));
    expect(queryByText('Send £500 to this spotter?')).toBeNull();
  });

  it('prices from the route’s reward before the money read lands', async () => {
    // No money read yet (null): a £200 reward is charged £210 since ADR-0020,
    // so about £206.65 would come back.
    const { getByText } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={20000} />),
    );
    expect(getByText(/About £206\.65 comes back to your card/)).toBeTruthy();
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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);
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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

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
    await pressConfirm(getByText);

    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('p1', null));
    // Without this second call the post is stranded in recovery_claimed with
    // the bounty still in escrow — claimed, but nobody paid and nobody refunded.
    // (undefined attestation: the pre-flight said none was needed.)
    await waitFor(() => expect(mockRefund).toHaveBeenCalledWith('p1', undefined));
  });

  it('detours through the attestation when recent sightings exist', async () => {
    // The owner-denial gate: "found it another way" with fresh uncredited
    // sightings must show them BEFORE the irreversible claim, and the
    // confirmed exit carries exactly what was shown.
    mockExitCheck.mockResolvedValue({
      requiresAttestation: true,
      sightingIds: ['sighting-1'],
      windowDays: 14,
      holdHours: 72,
    });
    mockRefund.mockResolvedValue({ held: true, refundAfter: '2026-08-08T12:00:00Z' });

    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );
    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await pressConfirm(getByText);

    // Nothing irreversible happened yet — the attestation comes first.
    expect(mockClaim).not.toHaveBeenCalled();
    expect(getByTestId('exit-attestation')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('None of these led me to the car'));
    });
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('p1', null));
    await waitFor(() => expect(mockRefund).toHaveBeenCalledWith('p1', ['sighting-1']));
    // The held answer is reported honestly, with the date.
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('unless a sighting'));
  });

  it('offers the honest way back: "one of these did help" returns to the list', async () => {
    mockExitCheck.mockResolvedValue({
      requiresAttestation: true,
      sightingIds: ['sighting-1'],
      windowDays: 14,
      holdHours: 72,
    });
    const { getByText, getByTestId, queryByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" />),
    );
    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await pressConfirm(getByText);
    expect(getByTestId('exit-attestation')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('One of these did help'));
    });
    // Back on the picker with nothing claimed and nothing selected — crediting
    // is exactly what this screen already does.
    expect(queryByTestId('exit-attestation')).toBeNull();
    expect(getByTestId('credit-sighting-1')).toBeTruthy();
    expect(mockClaim).not.toHaveBeenCalled();
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
    await pressConfirm(getByText);

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'This listing isn’t live, so it can’t be marked recovered.',
        'error',
      ),
    );
    expect(mockBack).not.toHaveBeenCalled(); // stay put so they can retry
  });
});

/**
 * ADR-0014 — a NO-REWARD listing has no money leg. `claim_recovery` closes the
 * post itself and answers `nextStep: 'done'`.
 *
 * These exist because the first implementation shipped without them and the bug
 * was invisible from the server side: `claim_recovery` was correct, its SQL
 * check passed, and the CLIENT collapsed 'done' into 'refund'. That sent every
 * no-reward recovery into refund-recovery, which 409s on a post that is already
 * terminal — so a recovery that actually SUCCEEDED showed the owner an error.
 */
describe('a no-reward listing (nextStep: done)', () => {
  it('closes a credited recovery without calling refund or payout', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'done', creditedSightingId: 'sighting-1' });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={null} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-sighting-1'));
    });
    await pressConfirm(getByText);

    expect(mockClaim).toHaveBeenCalledWith('p1', 'sighting-1');
    // The two calls that would 409 / no-op on an already-terminal post.
    expect(mockRefund).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
    // ...and the spotter IS told. This asserted the opposite until 2026-09-25,
    // on reasoning that stopped being true on 09-02: claim_credited_notification
    // now builds its copy and claims LAST, answering a £5 listing with the
    // rewardless `credited_no_reward` push. Pinning "don't call it" kept every
    // spotter credited on a £5 listing in silence for three weeks.
    expect(mockNotifyCredited).toHaveBeenCalledWith('p1');
    // ...and the owner is told it worked, not that it failed.
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const said = mockShowToast.mock.calls.map((c) => String(c[0])).join(' | ');
    expect(said).toMatch(/credited/i);
    // MONEY: never promise a payment on a listing that has none.
    expect(said).not.toMatch(/bounty|£/i);
  });

  it('closes a no-spotter recovery without calling refund', async () => {
    mockClaim.mockResolvedValue({ nextStep: 'done', creditedSightingId: null });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={null} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await pressConfirm(getByText);

    expect(mockClaim).toHaveBeenCalledWith('p1', null);
    expect(mockRefund).not.toHaveBeenCalled();
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const said = mockShowToast.mock.calls.map((c) => String(c[0])).join(' | ');
    // The old bug rendered "£0 is on its way back to you" here.
    expect(said).not.toMatch(/£/);
  });

  it('skips the attestation pre-flight — there is no refund to hold', async () => {
    // exit_check is purely sighting-based and would show ExitAttestation, whose
    // copy is all about a 72-hour refund hold. Asking a victim to attest under
    // that premise on a listing with no refund is the thing being prevented.
    mockExitCheck.mockResolvedValue({
      requiresAttestation: true,
      sightingIds: ['sighting-1'],
      windowDays: 14,
      holdHours: 72,
    });
    mockClaim.mockResolvedValue({ nextStep: 'done', creditedSightingId: null });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={null} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await pressConfirm(getByText);

    expect(mockExitCheck).not.toHaveBeenCalled();
    expect(mockClaim).toHaveBeenCalledWith('p1', null);
  });

  it('still runs the attestation pre-flight on a BOUNTY listing', async () => {
    // The control: the guard above must be scoped to no-reward listings only,
    // or it would silently disable the owner-denial protection for everyone.
    mockExitCheck.mockResolvedValue({
      requiresAttestation: true,
      sightingIds: ['sighting-1'],
      windowDays: 14,
      holdHours: 72,
    });
    const { getByText, getByTestId } = await act(async () =>
      render(<RecoverPostScreen postId="p1" bountyPence={50000} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('credit-none'));
    });
    await pressConfirm(getByText);

    expect(mockExitCheck).toHaveBeenCalledWith('p1');
    // Attestation required → the claim must NOT have happened yet.
    expect(mockClaim).not.toHaveBeenCalled();
  });
});
