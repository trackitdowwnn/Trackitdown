/**
 * WHAT:  Orchestration tests for PostACarScreen.handleComplete — the money path
 *        the screen owns: create the draft ONCE, take the bounty via
 *        PaymentSheet, and route on success. The load-bearing assertion is that
 *        a retry after a cancelled/declined payment reuses the draft id and
 *        never calls submitPost (create_post) a second time — no duplicate
 *        draft, no double charge — and never routes away until 'paid'.
 * WHY:   Losing a completed wizard to a payment blip, OR creating a second draft
 *        (and a second charge) on retry, are the two failures this flow guards
 *        against (SECURITY_AND_TRUST §4 money-safety). They live in
 *        handleComplete and are pinned here. (Editing an existing post is NOT
 *        here — it's per-section on the post detail screen.)
 * LINKS: src/features/vehicles/post/screens/PostACarScreen.tsx, docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';

import { PostACarScreen } from './PostACarScreen';

// Capture the onComplete the screen hands the wizard so we can drive it directly
// (and call it twice to exercise the retry path) without rendering the flow.
let capturedOnComplete: (answers: Record<string, unknown>) => Promise<void>;
// Captured too: onExit is the ONLY path the wizard uses to leave the flow, so
// driving it is how the abandon signal gets asserted.
let capturedOnExit: () => void;

/** Mount the screen and flush the commit so the captured props are assigned. */
async function mount(props: React.ComponentProps<typeof PostACarScreen> = {}) {
  await act(async () => {
    render(<PostACarScreen {...props} />);
  });
}
jest.mock('@/shared/wizard', () => ({
  WizardScreen: (props: {
    onComplete: (a: Record<string, unknown>) => Promise<void>;
    onExit: () => void;
  }) => {
    capturedOnComplete = props.onComplete;
    capturedOnExit = props.onExit;
    return null;
  },
}));

// Keep the flow config (and its heavy UI step imports) out of this unit.
jest.mock('../postACarFlow', () => ({
  postACarFlow: { id: 'post-a-car' },
  POST_A_CAR_INITIAL_ANSWERS: {},
}));

// Bounty guidance is analytics on the success path: fire-and-forget, and
// deliberately never awaited by the screen. Mocked so this unit neither
// reaches the network nor pulls the real Supabase client in (which throws
// without env config), and so the log call can be asserted.
const mockFetchGuidance = jest.fn(async (_lat: number, _lng: number) => ({
  rungs: [],
  local: null,
}));
const mockLogRecommendation = jest.fn();
jest.mock('../api/bountyGuidanceApi', () => ({
  fetchBountyGuidance: (lat: number, lng: number) => mockFetchGuidance(lat, lng),
  logBountyRecommendation: (
    postId: string,
    chosenPence: number,
    shown: unknown,
    localSample: number | null,
  ) => mockLogRecommendation(postId, chosenPence, shown, localSample),
}));

const mockSubmitPost = jest.fn();
jest.mock('../api/postApi', () => ({
  submitPost: (...args: unknown[]) => mockSubmitPost(...args),
}));

const mockCreateIntent = jest.fn();
const mockPayBounty = jest.fn();
// PaymentError is the real class so `throw`/`instanceof` semantics match.
jest.mock('@/features/payments', () => {
  class PaymentError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    PaymentError,
    createBountyPaymentIntent: (...args: unknown[]) => mockCreateIntent(...args),
    useBountyPayment: () => ({ payBounty: (...args: unknown[]) => mockPayBounty(...args) }),
  };
});

const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack }),
}));

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => ({
  useToast: () => ({ show: mockToastShow }),
}));

const mockSuccessHaptic = jest.fn();
jest.mock('@/shared/lib/haptics', () => ({
  successHaptic: () => mockSuccessHaptic(),
}));

const ANSWERS = { bountyAmountPence: 50000 };

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmitPost.mockResolvedValue({ postId: 'p1', status: 'draft' });
  mockCreateIntent.mockResolvedValue('pi_secret_123');
});

describe('handleComplete', () => {
  it('creates the draft, takes payment, and routes to the new post on success', async () => {
    mockPayBounty.mockResolvedValue({ outcome: 'paid', message: null });
    await mount();

    await capturedOnComplete(ANSWERS);

    expect(mockSubmitPost).toHaveBeenCalledTimes(1);
    expect(mockCreateIntent).toHaveBeenCalledWith('p1');
    expect(mockPayBounty).toHaveBeenCalledWith('pi_secret_123');
    expect(mockSuccessHaptic).toHaveBeenCalledTimes(1);
    expect(mockToastShow).toHaveBeenCalledWith(expect.stringContaining('going live'), 'success');
    expect(mockReplace).toHaveBeenCalledWith('/post/p1');
  });

  it('MONEY: a retry after a cancelled payment reuses the draft — no second submitPost', async () => {
    await mount();

    // First attempt: the user cancels the sheet → rejects, no routing.
    mockPayBounty.mockResolvedValueOnce({ outcome: 'cancelled', message: null });
    await expect(capturedOnComplete(ANSWERS)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(mockReplace).not.toHaveBeenCalled();

    // Retry: pays this time. The draft must NOT be created again.
    mockPayBounty.mockResolvedValueOnce({ outcome: 'paid', message: null });
    await capturedOnComplete(ANSWERS);

    expect(mockSubmitPost).toHaveBeenCalledTimes(1); // ← created once, reused on retry
    expect(mockCreateIntent).toHaveBeenCalledTimes(2); // ← intent reopened (server-idempotent)
    expect(mockReplace).toHaveBeenCalledWith('/post/p1');
  });

  it('records what was advised against what was chosen — once, on first creation', async () => {
    // The advice half of a join whose outcome half already exists in the
    // schema. Without it, a future analysis cannot separate "high bounties
    // recover cars" from "we told people to set high bounties".
    await mount();
    await capturedOnComplete({ ...ANSWERS, location: { latitude: 51.5, longitude: -0.12 } });

    expect(mockFetchGuidance).toHaveBeenCalledWith(51.5, -0.12);
    expect(mockLogRecommendation).toHaveBeenCalledWith('p1', 50000, null, null);
  });

  it('does NOT log a second row when a declined card is retried', async () => {
    // One decision, one row. The retry reuses the draft, so logging again would
    // record the same choice twice and skew the very comparison the table is
    // for.
    await mount();
    mockPayBounty.mockResolvedValueOnce({ outcome: 'cancelled', message: null });
    const answers = { ...ANSWERS, location: { latitude: 51.5, longitude: -0.12 } };
    await expect(capturedOnComplete(answers)).rejects.toMatchObject({ code: 'CANCELLED' });

    mockPayBounty.mockResolvedValueOnce({ outcome: 'paid', message: null });
    await capturedOnComplete(answers);

    expect(mockLogRecommendation).toHaveBeenCalledTimes(1);
  });

  it('logs nothing for a no-bounty listing — there was no amount to advise on', async () => {
    await mount();
    await capturedOnComplete({
      pricingMode: 'fee',
      bountyAmountPence: 50000, // the slider always holds a value; the MODE decides
      location: { latitude: 51.5, longitude: -0.12 },
    });

    expect(mockLogRecommendation).not.toHaveBeenCalled();
  });

  it('surfaces a failed payment and does not route away', async () => {
    mockPayBounty.mockResolvedValue({ outcome: 'failed', message: 'Card declined.' });
    await mount();

    await expect(capturedOnComplete(ANSWERS)).rejects.toMatchObject({
      code: 'FAILED',
      message: 'Card declined.',
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not attempt payment when the draft submit fails', async () => {
    mockSubmitPost.mockRejectedValue(new Error('upload failed'));
    await mount();

    await expect(capturedOnComplete(ANSWERS)).rejects.toThrow('upload failed');
    expect(mockCreateIntent).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

// The garage's exit nudge hangs off this callback, and its whole safety
// argument is that a real theft victim never sees it. These are the tests that
// keep that true.
describe('onAbandon — the "they were only exploring" signal', () => {
  it('fires when the wizard is left without creating anything', async () => {
    const onAbandon = jest.fn();
    await mount({ onAbandon });

    await act(async () => {
      capturedOnExit();
    });

    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // The guard that matters. Someone who got as far as creating a draft and then
  // hit a payment problem HAS had a car stolen — offering to "save a car for
  // next time" would be tone-deaf, and their post already exists.
  it('does NOT fire once a draft exists, even if payment failed', async () => {
    const onAbandon = jest.fn();
    mockPayBounty.mockResolvedValue({ outcome: 'cancelled' });
    await mount({ onAbandon });

    // Get far enough to create the draft, then cancel the payment...
    await expect(capturedOnComplete(ANSWERS)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(mockSubmitPost).toHaveBeenCalledTimes(1);

    // ...and now back out.
    await act(async () => {
      capturedOnExit();
    });

    expect(onAbandon).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('still leaves cleanly when no handler is passed (the from-garage path)', async () => {
    await mount();

    await act(async () => {
      capturedOnExit();
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
