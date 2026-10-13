/**
 * WHAT:  The payout-setup wizard's answers shape — what a spotter types, as
 *        they typed it (DD/MM/YYYY, 12-34-56).
 * WHY:   Its own module so the step components and the flow can both import it
 *        without the steps importing the flow that renders them.
 *
 * PII:   bank and identity details. These answers live in the wizard's React
 *        state and nowhere else: the flow passes no `onSaveAndExit`, so there is
 *        no draft, and nothing here is ever logged (payments/README.md, "We
 *        never store them").
 * LINKS: ./payoutSetupFlow.tsx; ../components/payoutSetupSteps.tsx;
 *        ../screens/PayoutSetupScreen.tsx.
 */

export interface PayoutSetupAnswers {
  firstName: string;
  lastName: string;
  /** DD/MM/YYYY as typed; converted to Stripe's YYYY-MM-DD on submit. */
  dob: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  /** 12-34-56 as shown; sent as digits. */
  sortCode: string;
  accountNumber: string;
  confirmAccountNumber: string;
}

export const EMPTY_PAYOUT_SETUP: PayoutSetupAnswers = {
  firstName: '',
  lastName: '',
  dob: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  postalCode: '',
  sortCode: '',
  accountNumber: '',
  confirmAccountNumber: '',
};
