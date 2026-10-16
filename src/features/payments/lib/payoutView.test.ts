/**
 * WHAT:  Tests for payoutView — one row per state the Payouts screen can be
 *        in, and the copy budget every one of them is held to.
 * WHY:   This is now the only place a payout state is decided (2026-10-14).
 *        The owner's complaints were "too much text" and "the tracker is
 *        unclear"; the budget keeps the first fixed, and the rows pin, for
 *        each state, who the current step is waiting on — the thing that was
 *        wrong when a spotter was told to wait for a check waiting on them.
 * LINKS: ./payoutView.ts; ./payoutCopy.ts.
 */

import type { BankPayout } from '../api/payoutsApi';

import { COPY, carLabel } from './payoutCopy';
import { payoutView, type PayoutView, type PayoutViewInput } from './payoutView';

const NOW = new Date('2026-10-14T12:00:00Z');

const CREDIT = {
  transferPence: 19000,
  underReview: false,
  creditedAt: '2026-10-12T10:00:00Z',
  car: { make: 'BMW', colour: 'Blue' },
};

const base = (over: Partial<PayoutViewInput> = {}): PayoutViewInput => ({
  status: 'notStarted',
  settling: false,
  checkingNow: false,
  needsBank: false,
  needsAction: false,
  checkFailed: false,
  canCheckAgain: false,
  creditCheckFailed: false,
  credit: CREDIT,
  latestPayout: null,
  account: null,
  ...over,
});

const account = (over: Partial<NonNullable<PayoutViewInput['account']>> = {}) => ({
  bankPayout: null,
  bankReplacedAt: null,
  payoutsEnabledAt: '2026-10-13T09:00:00Z',
  detailsSubmittedAt: '2026-10-13T08:00:00Z',
  bankLast4: null,
  ...over,
});

const payout = (status: BankPayout['status'], over: Partial<BankPayout> = {}): BankPayout => ({
  status,
  arrivalDate: '2026-10-16',
  createdAt: '2026-10-14T06:00:00Z',
  ...over,
});

const SENT = { transferPence: 19000, sentAt: '2026-10-13T11:00:00Z' };

const journey = (view: PayoutView) => {
  if (view.kind !== 'journey') throw new Error(`expected a journey, got ${view.kind}`);
  return view;
};
const states = (view: PayoutView) => journey(view).steps.map((s) => `${s.id}:${s.state}`);

describe('payoutView — kinds', () => {
  it.each(['guest', 'loading', 'error'] as const)('%s → its own kind', (status) => {
    expect(payoutView(base({ status }), NOW).kind).toBe(status);
  });

  it('still asking whether a reward waits → loading, never a road that may vanish', () => {
    expect(payoutView(base({ credit: undefined }), NOW).kind).toBe('loading');
  });

  it('never earned → nothing to set up', () => {
    expect(payoutView(base({ credit: null }), NOW).kind).toBe('nothing');
  });

  it('⚠️ the read FAILED → "couldn’t check", with a retry — never "nothing"', () => {
    const view = payoutView(base({ credit: null, creditCheckFailed: true }), NOW);
    expect(view).toEqual({ kind: 'creditUnknown', action: { label: 'Try again', intent: 'retry' } });
  });

  it('payouts on, nothing waiting or recent → ready, with the one way to change the bank', () => {
    const view = payoutView(base({ status: 'ready', credit: null, account: account() }), NOW);
    expect(view).toMatchObject({ kind: 'ready', action: { intent: 'bank' } });
  });

  it('⚠️ a refused bank payout with no reward in view still needs them — never "Payouts are on"', () => {
    const bounced = { status: 'failed' as const, arrivalDate: null, createdAt: '2026-10-14T06:00:00Z' };
    const view = payoutView(
      base({ status: 'ready', credit: null, account: account({ bankPayout: bounced }) }),
      NOW,
    );
    expect(view).toMatchObject({
      kind: 'ready',
      chip: { label: 'Action needed', tone: 'warning' },
      status: COPY.status.bankRefused,
      action: { intent: 'bank' },
    });

    // New details since: no alarm.
    const rebanked = payoutView(
      base({
        status: 'ready',
        credit: null,
        account: account({ bankPayout: bounced, bankReplacedAt: '2026-10-15T09:00:00Z' }),
      }),
      NOW,
    );
    expect(rebanked).toMatchObject({ kind: 'ready', status: COPY.status.ready });
  });
});

describe('payoutView — not set up yet: the setup leads', () => {
  it('not started: the amount and the car are the hero; their details are theirs to do', () => {
    const view = journey(payoutView(base(), NOW));
    expect(view.hero).toEqual({
      amountPence: 19000,
      carLabel: 'for helping find a blue BMW',
      status: COPY.status.addDetails,
    });
    expect(states(view)).toEqual(['details:current', 'check:upcoming', 'sent:upcoming', 'bank:upcoming']);
    expect(view.steps[0]?.action).toEqual({ label: 'Add your details', intent: 'start' });
    expect(view.trustAt).toBe('bank');
    expect(view.chip.tone).toBe('neutral');
  });

  it('unfinished: theirs to finish', () => {
    const view = journey(payoutView(base({ status: 'unfinished' }), NOW));
    expect(view.steps[0]).toMatchObject({ state: 'current', action: { intent: 'continue' } });
    expect(view.chip).toEqual({ label: 'Action needed', tone: 'warning' });
  });

  it('being checked: details done WITH their date; the check is our partner’s — no button', () => {
    const view = journey(payoutView(base({ status: 'verifying', account: account() }), NOW));
    expect(states(view)).toEqual(['details:done', 'check:current', 'sent:upcoming', 'bank:upcoming']);
    expect(view.steps[0]?.meta).toBe('13 October');
    expect(view.steps[1]?.action).toBeUndefined();
    expect(view.steps[1]?.working).toBe(false);
    expect(view.hero.status).toBe(COPY.status.checking);
    expect(view.trustAt).toBeNull();
  });

  it('being checked while the app asks: the marker works and says so', () => {
    const view = journey(payoutView(base({ status: 'verifying', checkingNow: true }), NOW));
    expect(view.steps[1]).toMatchObject({ working: true, detail: COPY.detail.checkingNow });
  });

  it('the settle window: working, "waiting for confirmation"', () => {
    const view = journey(payoutView(base({ status: 'verifying', settling: true }), NOW));
    expect(view.steps[1]).toMatchObject({ working: true, detail: COPY.detail.settling });
  });

  it.each(['notStarted', 'unfinished'] as const)(
    '⚠️ the settle window outranks %s — never "continue" to someone who just sent it all',
    (status) => {
      const view = journey(payoutView(base({ status, settling: true, needsBank: true }), NOW));
      expect(states(view)).toEqual(['details:done', 'check:current', 'sent:upcoming', 'bank:upcoming']);
      expect(view.steps.some((s) => s.action)).toBe(false);
      expect(view.chip).toEqual({ label: 'Being checked', tone: 'neutral' });
    },
  );

  it('⚠️ a photo ID needed: the check NEEDS THEM — "!" and its one action', () => {
    const view = journey(
      payoutView(base({ status: 'verifying', needsAction: true, checkingNow: true }), NOW),
    );
    expect(view.steps[1]).toMatchObject({
      state: 'attention',
      action: { label: 'Start the check', intent: 'idCheck' },
    });
    expect(view.steps[1]?.working).toBeUndefined();
    expect(view.hero.status).toBe(COPY.status.needsYou);
    expect(view.trustAt).toBe('id');
  });

  it('a bank account missing: their details need them — "Add your bank account"', () => {
    const view = journey(payoutView(base({ status: 'verifying', needsBank: true }), NOW));
    expect(view.steps[0]).toMatchObject({ state: 'attention', action: { intent: 'bank' } });
    expect(view.steps[1]?.state).toBe('upcoming');
  });

  it('no reward waiting yet (verifying): the road without a figure', () => {
    const view = journey(payoutView(base({ status: 'verifying', credit: null }), NOW));
    expect(view.hero.amountPence).toBeNull();
  });

  // ⚠️ 2026-10-16: a failed check used to read as "nothing needed", so someone
  // Stripe was waiting on was told "being checked" — and waited.
  it('⚠️ the check itself failed: "couldn’t check", never "being checked", and Check again', () => {
    const view = journey(payoutView(base({ status: 'verifying', checkFailed: true }), NOW));
    expect(view.hero.status).toBe(COPY.status.checkFailed);
    // The chip agrees with the line beside it.
    expect(view.chip).toEqual({ label: 'Not checked', tone: 'neutral' });
    expect(view.steps[1]).toMatchObject({
      state: 'current',
      detail: COPY.detail.checkFailed,
      action: { label: 'Check again', intent: 'recheck' },
    });
    expect(view.steps[1]?.working).toBeUndefined();
  });

  it('a failed check while a new one runs: the running one speaks, not the old failure', () => {
    const view = journey(
      payoutView(base({ status: 'verifying', checkFailed: true, checkingNow: true }), NOW),
    );
    expect(view.steps[1]).toMatchObject({ working: true, detail: COPY.detail.checkingNow });
    expect(view.hero.status).toBe(COPY.status.checking);
  });

  it('the automatic checks have stopped: "Check again" beside "being checked"', () => {
    const view = journey(payoutView(base({ status: 'verifying', canCheckAgain: true }), NOW));
    expect(view.steps[1]).toMatchObject({
      detail: COPY.detail.checking,
      action: { label: 'Check again', intent: 'recheck' },
    });
  });

  it('checks still running: no button — the marker already says it is asking', () => {
    const view = journey(
      payoutView(base({ status: 'verifying', checkingNow: true, canCheckAgain: false }), NOW),
    );
    expect(view.steps[1]?.action).toBeUndefined();
  });
});

describe('payoutView — payouts on: the money leads', () => {
  it('a reward being sent: setup is one dated line; credited, dated; sending now', () => {
    const view = journey(payoutView(base({ status: 'ready', account: account() }), NOW));
    expect(states(view)).toEqual(['setup:done', 'confirmed:done', 'sent:current', 'bank:upcoming']);
    expect(view.steps[0]?.meta).toBe('13 October');
    expect(view.steps[1]?.meta).toBe('12 October');
    expect(view.steps[2]).toMatchObject({ working: true, detail: COPY.detail.sending });
    // The amount stays the hero while the money moves (it used to vanish here).
    expect(view.hero.amountPence).toBe(19000);
  });

  it('⚠️ held for a check: says so, nothing for them to do, never "on its way"', () => {
    const view = journey(
      payoutView(base({ status: 'ready', credit: { ...CREDIT, underReview: true } }), NOW),
    );
    expect(view.steps[2]).toMatchObject({ state: 'current', detail: COPY.detail.review });
    expect(view.steps[2]?.action).toBeUndefined();
    expect(view.hero.status).toBe(COPY.status.review);
  });

  const sent = (bankPayout: BankPayout | null, over = {}) =>
    journey(
      payoutView(
        base({
          status: 'ready',
          credit: null,
          latestPayout: SENT,
          account: account({ bankPayout, ...over }),
        }),
        NOW,
      ),
    );

  it('sent, no bank payout yet: "Sent on …", the bank may take days', () => {
    const view = sent(null);
    expect(states(view)).toEqual(['setup:done', 'confirmed:done', 'sent:done', 'bank:current']);
    expect(view.steps[2]?.meta).toBe('13 October');
    expect(view.hero.status).toBe('Sent on 13 October');
  });

  it('on its way: an expected-by date ahead, and the hero says when', () => {
    const view = sent(payout('in_transit'));
    expect(view.steps[3]?.meta).toBe('Expected by Friday 16 October');
    // "On its way" is the chip's; the line says when (one fact, said once).
    expect(view.hero.status).toBe('Arrives by Friday 16 October');
    expect(view.chip.label).toBe('On its way');
  });

  it('past its expected date and not yet paid: says so, honestly', () => {
    const view = sent(payout('in_transit', { arrivalDate: '2026-10-13' }));
    expect(view.steps[3]?.detail).toBe(COPY.detail.overdue);
  });

  it('paid: the road is done, folds to one line, and is celebrated ONCE (a key)', () => {
    const view = sent(payout('paid'));
    expect(view.steps[3]).toMatchObject({ state: 'done', meta: '16 October' });
    expect(view.chip).toEqual({ label: 'Paid', tone: 'success' });
    expect(view.collapsed).toEqual({ summary: 'Paid 16 October · £190', expandLabel: 'View details' });
    expect(view.celebrateKey).toBe('paid:2026-10-14T06:00:00Z');
  });

  it('⚠️ paid, then the bank bounces it: needs them again — "Update bank details"', () => {
    const view = sent(payout('failed'));
    expect(view.steps[3]).toMatchObject({
      state: 'attention',
      action: { label: 'Update bank details', intent: 'bank' },
    });
    expect(view.collapsed).toBeNull();
    expect(view.celebrateKey).toBeNull();
  });

  it('bounced, then new details given: resending — not a problem any more', () => {
    const view = sent(payout('failed'), { bankReplacedAt: '2026-10-14T09:00:00Z' });
    expect(view.steps[3]).toMatchObject({ state: 'current', detail: COPY.detail.resending });
  });

  it('a reward still waiting outranks one already sent — that is the road now', () => {
    const view = journey(
      payoutView(base({ status: 'ready', latestPayout: SENT, account: account() }), NOW),
    );
    expect(view.steps[2]).toMatchObject({ id: 'sent', state: 'current' });
    expect(view.hero.amountPence).toBe(19000);
  });

  it('a sent reward is only the end of the road once payouts are on', () => {
    // (Migrated from payoutProgress.) An account Stripe has paused shows its
    // setup, not a "sent" it can't currently follow.
    const view = journey(
      payoutView(base({ status: 'verifying', credit: null, latestPayout: SENT }), NOW),
    );
    expect(states(view)).toEqual(['details:done', 'check:current', 'sent:upcoming', 'bank:upcoming']);
  });

  describe('"account ending 5678" (PR7)', () => {
    it('paid: says WHICH account, as a statement does', () => {
      const view = sent(payout('paid'), { bankLast4: '5678' });
      expect(view.hero.status).toBe('Paid into account ending 5678 on 16 October');
    });

    it('on its way: to which account', () => {
      const view = sent(payout('in_transit'), { bankLast4: '5678' });
      expect(view.steps[3]?.detail).toBe('On its way to account ending 5678.');
    });

    it('⚠️ the bank changed since that payout: never names the new one for it', () => {
      const view = sent(payout('paid'), {
        bankLast4: '9999',
        bankReplacedAt: '2026-10-15T09:00:00Z',
      });
      expect(view.hero.status).toBe('Paid into your bank on 16 October');
    });

    it('no last four known: the words as before', () => {
      expect(sent(payout('paid')).hero.status).toBe('Paid into your bank on 16 October');
    });

    it('payouts on, nothing in flight: where rewards go', () => {
      const view = payoutView(
        base({ status: 'ready', credit: null, account: account({ bankLast4: '5678' }) }),
        NOW,
      );
      expect(view).toMatchObject({ kind: 'ready', detail: 'Rewards go to account ending 5678.' });
    });

    it('⚠️ …but never "rewards go to" the account that just refused one', () => {
      const view = payoutView(
        base({
          status: 'ready',
          credit: null,
          account: account({ bankLast4: '5678', bankPayout: payout('failed') }),
        }),
        NOW,
      );
      expect(view).toMatchObject({ kind: 'ready', detail: null });
    });
  });

  it('⚠️ a bank payout from BEFORE this reward was sent cannot be carrying it', () => {
    const view = sent(payout('paid', { createdAt: '2026-10-01T06:00:00Z' }));
    expect(view.steps[3]).toMatchObject({ state: 'current', detail: COPY.detail.bankMayTakeDays });
  });
});

describe('the copy budget (owner: "too much text")', () => {
  const words = (s: string) => s.trim().split(/\s+/).length;

  const ALL_VIEWS: PayoutView[] = [
    payoutView(base(), NOW),
    payoutView(base({ status: 'unfinished' }), NOW),
    payoutView(base({ status: 'verifying' }), NOW),
    payoutView(base({ status: 'verifying', checkingNow: true }), NOW),
    payoutView(base({ status: 'verifying', settling: true }), NOW),
    payoutView(base({ status: 'verifying', needsAction: true }), NOW),
    payoutView(base({ status: 'verifying', needsBank: true }), NOW),
    payoutView(base({ status: 'verifying', checkFailed: true }), NOW),
    payoutView(base({ status: 'verifying', canCheckAgain: true }), NOW),
    payoutView(base({ status: 'ready' }), NOW),
    payoutView(base({ status: 'ready', credit: { ...CREDIT, underReview: true } }), NOW),
    ...(['pending', 'in_transit', 'paid', 'failed'] as const).flatMap((s) =>
      [null, '5678'].map((bankLast4) =>
        payoutView(
          base({
            status: 'ready',
            credit: null,
            latestPayout: SENT,
            account: account({ bankPayout: payout(s), bankLast4 }),
          }),
          NOW,
        ),
      ),
    ),
  ];

  it.each(ALL_VIEWS.map((v, i) => [i, v] as const))(
    'view %i: status ≤ 8 words, steps ≤ 16, buttons ≤ 4, one action at most',
    (_i, view) => {
      const j = journey(view);
      expect(words(j.hero.status)).toBeLessThanOrEqual(8);
      for (const s of j.steps) {
        if (s.detail) expect(words(s.detail)).toBeLessThanOrEqual(16);
        if (s.action) expect(words(s.action.label)).toBeLessThanOrEqual(4);
      }
      // ONE action per screen at most — never two things to do at once.
      expect(j.steps.filter((s) => s.action).length).toBeLessThanOrEqual(1);
    },
  );

  it('⚠️ names no payment provider, says no "escrow", and never claims "never see"', () => {
    const everything = JSON.stringify(COPY) + JSON.stringify(ALL_VIEWS);
    expect(everything).not.toMatch(/stripe|escrow|never see/i);
  });
});

describe('carLabel', () => {
  it.each([
    [{ make: 'BMW', colour: 'Blue' }, 'for helping find a blue BMW'],
    [{ make: 'Audi', colour: null }, 'for helping find an Audi'],
    [{ make: 'Ford', colour: 'Orange' }, 'for helping find an orange Ford'],
    [{ make: null, colour: 'Blue' }, null],
    [null, null],
  ])('%j → %s', (car, label) => {
    expect(carLabel(car)).toBe(label);
  });
});
