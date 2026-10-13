/**
 * WHAT:  The payout-setup wizard — about you, your address, where to pay you,
 *        then check and send — on the shared wizard framework.
 * WHY:   Replaces PayoutDetailsForm's single eleven-field page (2026-10-13,
 *        owner request: no progress, no sense of how far along). A flow is
 *        data; the framework draws the progress bar, gates each Next on the
 *        step's schema, and ends on a review screen with Edit links.
 *
 *        ⚠️ THREE PHASES OF ONE STEP, not one phase of three. The progress bar
 *        draws one segment per phase, so this gives three segments that fill
 *        as the spotter goes — the progress they asked for — and the review
 *        screen groups the answers under the same three names.
 *
 *        ⚠️ THE PREFILL WINDOW. Nothing in this flow talks to Stripe until the
 *        final "Send to Stripe" — no step has an `onContinue`. Minting an
 *        Account Session (or link) before these details reach Stripe would
 *        shut, for good, the window in which we may submit them at all
 *        (payments/README.md). The host submits; the flow only collects.
 * LINKS: ../components/payoutSetupSteps.tsx; ../screens/PayoutSetupScreen.tsx;
 *        src/shared/wizard/README.md; ../components/payoutDetailsSchema.ts.
 */

import type { WizardFlow } from '@/shared/wizard';

import {
  AboutYouStep,
  AddressStep,
  BankStep,
  PayoutTermsNotice,
} from '../components/payoutSetupSteps';
import {
  buildAboutYouSchema,
  buildAddressSchema,
  buildBankDetailsSchema,
  digitsOnly,
} from '../components/payoutDetailsSchema';
import type { PayoutSetupAnswers } from './payoutSetupAnswers';

/** "Sort code 12-34-56 · account ending 5678" — the last four, as a bank
 *  statement shows it, so the review confirms the account without repeating
 *  the whole number on screen. */
export function describeBank(answers: Partial<PayoutSetupAnswers>): string {
  const account = digitsOnly(answers.accountNumber ?? '');
  return `Sort code ${answers.sortCode ?? ''} · account ending ${account.slice(-4)}`;
}

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
            question: 'Who are we paying?',
            helper: 'As it appears on your bank account.',
            component: AboutYouStep,
            schema: buildAboutYouSchema(now),
            reviewLabel: 'Name and date of birth',
            reviewValue: (answers) => {
              const name = `${answers.firstName ?? ''} ${answers.lastName ?? ''}`.trim();
              const phone = answers.phone?.trim();
              return [name, `Born ${answers.dob ?? ''}`, phone].filter(Boolean).join('\n');
            },
          },
        ],
      },
      {
        id: 'address',
        title: 'Your address',
        steps: [
          {
            id: 'address',
            question: 'Where do you live?',
            helper: 'Stripe checks this with your name — nothing is posted to you.',
            component: AddressStep,
            schema: buildAddressSchema(),
            reviewLabel: 'Home address',
            reviewValue: (answers) =>
              [answers.addressLine1, answers.addressLine2, answers.city, answers.postalCode]
                .map((part) => part?.trim())
                .filter(Boolean)
                .join(', '),
          },
        ],
      },
      {
        id: 'bank',
        title: 'Where to pay you',
        steps: [
          {
            id: 'bank',
            question: 'Where should your reward go?',
            helper: 'A UK bank account in your name.',
            component: BankStep,
            schema: buildBankDetailsSchema(),
            reviewLabel: 'Bank account',
            reviewValue: describeBank,
          },
        ],
      },
    ],
    review: {
      title: 'Check and send',
      // ⚠️ THE HEADER, NOT THE FOOTER (security review, 2026-10-13). The send
      // button is pinned and never scrolls; a footer notice sat below three
      // answer groups, so on a small phone or at large text "Send to Stripe"
      // could be pressed without the terms ever being on screen — and the
      // identity token attests that they were SHOWN. Directly under the title
      // they are on screen whenever the button is.
      header: () => <PayoutTermsNotice />,
    },
    // Says where the details go, which is what the spotter is agreeing to.
    finalCtaLabel: 'Send to Stripe',
  };
}
