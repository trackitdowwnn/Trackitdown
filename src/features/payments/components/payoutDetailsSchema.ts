/**
 * WHAT:  Validation for the payout details form — the shape and the rules,
 *        with no React in sight so they can be tested directly.
 * WHY:   Everything this form collects is handed to Stripe and then becomes
 *        unreadable to us: on an Express account the platform is locked out of
 *        KYC data the moment onboarding starts. So a bad value caught here is
 *        cheap, and a bad value caught by Stripe is a rejection we cannot see,
 *        explain, or fix on the spotter's behalf.
 *
 *        UK-shaped on purpose (ROADMAP's v1 fence is UK-only): 6-digit sort
 *        code, 8-digit account number. Both are accepted with spaces and
 *        dashes because that is how they are printed on a card and a statement,
 *        and refusing the format someone is copying from is a small cruelty.
 * LINKS: ./PayoutDetailsForm.tsx; ../api/payoutsApi.ts (PayoutDetails);
 *        supabase/functions/submit-payout-details/index.ts (re-validates).
 */

import { z } from 'zod';

/** Strip the spaces and dashes people type from a printed number. */
export const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/** The youngest Stripe will accept for a UK individual. */
const MIN_AGE_YEARS = 18;

/** DD/MM/YYYY → a real date, or null. Rejects 31/02 rather than rolling it. */
export function parseUkDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [, day, month, year] = match.map(Number) as unknown as [string, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date rolls overflow silently (31 Feb becomes 3 March), so compare back.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Whole years between a date and now. */
function ageOn(date: Date, now: Date): number {
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
  return age;
}

/**
 * `now` is injected rather than read inside the schema so the age rule is
 * testable without freezing the clock, and so a test written today still passes
 * in five years.
 */
export function buildPayoutDetailsSchema(now: Date = new Date()) {
  return z.object({
    firstName: z.string().trim().min(1, 'Enter your first name'),
    lastName: z.string().trim().min(1, 'Enter your last name'),
    dob: z
      .string()
      .trim()
      .refine((value) => parseUkDate(value) !== null, 'Use the format DD/MM/YYYY')
      .refine((value) => {
        const date = parseUkDate(value);
        return date === null || date.getTime() <= now.getTime();
      }, 'That date is in the future')
      .refine((value) => {
        const date = parseUkDate(value);
        return date === null || ageOn(date, now) >= MIN_AGE_YEARS;
      }, 'You need to be 18 or over to be paid'),
    phone: z.string().trim().optional(),
    addressLine1: z.string().trim().min(1, 'Enter your address'),
    addressLine2: z.string().trim().optional(),
    city: z.string().trim().min(1, 'Enter your town or city'),
    postalCode: z.string().trim().min(1, 'Enter your postcode'),
    sortCode: z
      .string()
      .refine((value) => digitsOnly(value).length === 6, 'A sort code is 6 digits'),
    accountNumber: z
      .string()
      .refine((value) => digitsOnly(value).length === 8, 'An account number is 8 digits'),
  });
}

export type PayoutDetailsInput = z.infer<ReturnType<typeof buildPayoutDetailsSchema>>;
