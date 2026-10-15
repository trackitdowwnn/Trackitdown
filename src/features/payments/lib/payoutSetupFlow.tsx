/**
 * WHAT:  The payout-setup wizard — about you, your address, then where to pay
 *        you and send — on the shared wizard framework.
 * WHY:   Replaces PayoutDetailsForm's single eleven-field page (2026-10-13,
 *        owner request: no progress, no sense of how far along). A flow is
 *        data; the framework draws the progress bar and gates each Next on the
 *        step's schema.
 *
 *        ⚠️ THREE SCREENS, NOT FOUR (2026-10-14, PR6; owner: "setup feels
 *        long"). The review screen folded into the bank step: it opens with
 *        the terms and ends with a compact "Check and send" of the other two
 *        steps, each with an Edit that comes straight back. Each step says
 *        where they are and how long is left ("Step 2 of 3 · under a minute
 *        left") — the bar alone said neither in words.
 *
 *        ⚠️ THE PREFILL WINDOW. Nothing in this flow talks to Stripe until the
 *        final "Send my details" — no step has an `onContinue`. Minting an
 *        Account Session (or link) before these details reach Stripe would
 *        shut, for good, the window in which we may submit them at all
 *        (payments/README.md). The host submits; the flow only collects.
 * LINKS: ../components/payoutSetupSteps.tsx; ../screens/PayoutSetupScreen.tsx;
 *        src/shared/wizard/README.md; ../components/payoutDetailsSchema.ts.
 */

import type { WizardFlow } from '@/shared/wizard';

import { AboutYouStep, AddressStep, BankStep } from '../components/payoutSetupSteps';
import {
  buildAboutYouSchema,
  buildAddressSchema,
  buildBankDetailsSchema,
} from '../components/payoutDetailsSchema';
import type { PayoutSetupAnswers } from './payoutSetupAnswers';

/** `now` for the age rule, injected for the tests (see payoutDetailsSchema). */
export function buildPayoutSetupFlow(now: Date = new Date()): WizardFlow<PayoutSetupAnswers> {
  return {
    id: 'payout-setup',
    phases: [
      {
        id: 'about-you',
        title: 'About you',
        steps: [
          {
            id: 'about-you',
            eyebrow: 'Step 1 of 3 · about a minute',
            question: 'Who are we paying?',
            helper: 'As it appears on your bank account.',
            component: AboutYouStep,
            schema: buildAboutYouSchema(now),
          },
        ],
      },
      {
        id: 'address',
        title: 'Your address',
        steps: [
          {
            id: 'address',
            eyebrow: 'Step 2 of 3 · under a minute left',
            question: 'Where do you live?',
            helper: 'It’s checked against your name — nothing is posted to you.',
            component: AddressStep,
            schema: buildAddressSchema(),
          },
        ],
      },
      {
        id: 'bank',
        title: 'Where to pay you',
        steps: [
          {
            id: 'bank',
            eyebrow: 'Step 3 of 3 · last step',
            question: 'Where should your reward go?',
            helper: 'A UK bank account in your name.',
            component: BankStep,
            schema: buildBankDetailsSchema(),
          },
        ],
      },
    ],
    // Says what happens, never a vague "Finish". Not "Send to Stripe": the
    // owner wants no payment provider named in the app's own words
    // (2026-10-13); the terms on this step name the agreement, which is the
    // one place the law needs it.
    finalCtaLabel: 'Send my details',
  };
}
