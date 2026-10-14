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
 * LINKS: ./payoutSetupSteps.tsx; ./BankDetailsForm.tsx; ../api/payoutsApi.ts (PayoutDetails);
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
  // Read individually rather than `match.map(Number) as unknown as [...]` —
  // that array's first element is NaN and the assertion typed it `string`.
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
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

/**
 * A UK phone number as typed — 07700 900123, +44 7700 900123, 0044…, even
 * "+44 (0)7700…" — in the international form Stripe takes (+447700900123), or
 * null if it isn't one. UK numbers only, like the rest of this form: ten
 * national digits starting 1, 2, 3 (landlines, non-geographic) or 7 (mobiles).
 */
export function toUkE164(value: string): string | null {
  const compact = value.replace(/[\s\-().]/g, '');
  let national: string | null = null;
  if (compact.startsWith('+44')) national = compact.slice(3);
  else if (compact.startsWith('0044')) national = compact.slice(4);
  else if (compact.startsWith('0')) national = compact.slice(1);
  // "+44 (0)7700…" leaves the trunk 0 behind once the brackets go.
  if (national?.startsWith('0')) national = national.slice(1);
  return national !== null && /^[1237]\d{9}$/.test(national) ? `+44${national}` : null;
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
 * The bank trio, shared verbatim between the full earn-moment form and the
 * bank-only replacement form — two forms with two ideas of a sort code would
 * eventually disagree.
 */
const bankFields = {
  sortCode: z
    .string()
    .refine((value) => digitsOnly(value).length === 6, 'A sort code is 6 digits'),
  accountNumber: z
    .string()
    .refine((value) => digitsOnly(value).length === 8, 'An account number is 8 digits'),
  confirmAccountNumber: z.string(),
};

// A typo here is money sent to a stranger's account, silently, weeks later
// — the one mistake these forms can make that no later screen can undo. So
// it is typed twice, compared on digits (spacing may differ between the
// two boxes), and the error lands on the CONFIRM field: the first entry is
// as likely to be the right one.
const accountNumbersMatch = [
  (values: { accountNumber: string; confirmAccountNumber: string }) =>
    digitsOnly(values.accountNumber) === digitsOnly(values.confirmAccountNumber),
  { message: 'These don’t match — check both', path: ['confirmAccountNumber'] as ['confirmAccountNumber'] },
] as const;

/**
 * The identity fields, by step of the setup wizard (2026-10-13): "About you"
 * and "Your address". `now` is injected rather than read inside the schema so
 * the age rule is testable without freezing the clock, and so a test written
 * today still passes in five years.
 */
function aboutYouFields(now: Date) {
  return {
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
    // ⚠️ REQUIRED since 2026-10-14. Stripe requires a phone for a UK payee
    // account; asked "(optional)" here, a spotter who skipped it was held by
    // Stripe AFTER sending — the one place nothing on screen could explain.
    phone: z
      .string()
      .trim()
      .min(1, 'Enter your phone number')
      .refine((value) => toUkE164(value) !== null, 'Enter a UK number, like 07700 900123'),
  };
}

const addressFields = {
  addressLine1: z.string().trim().min(1, 'Enter your address'),
  addressLine2: z.string().trim().optional(),
  city: z.string().trim().min(1, 'Enter your town or city'),
  postalCode: z.string().trim().min(1, 'Enter your postcode'),
};

/** The wizard's "About you" step. */
export function buildAboutYouSchema(now: Date = new Date()) {
  return z.object(aboutYouFields(now));
}

/** The wizard's "Your address" step. */
export function buildAddressSchema() {
  return z.object(addressFields);
}

/** Everything at once — the submit's last check, and the tests' contract. */
export function buildPayoutDetailsSchema(now: Date = new Date()) {
  return z
    .object({ ...aboutYouFields(now), ...addressFields, ...bankFields })
    .refine(...accountNumbersMatch);
}

/**
 * Types the dashes for them, as the date of birth types its slashes: 123456
 * reads back as 12-34-56, the way a sort code is printed on a card. Digits
 * only in, so a pasted "12 34 56" lands the same way.
 */
export function formatSortCode(value: string): string {
  return digitsOnly(value)
    .slice(0, 6)
    .replace(/(\d{2})(?=\d)/g, '$1-');
}

/**
 * Types the slashes for them. The iOS number pad has no `/` key at all, so
 * without this the only way to satisfy DD/MM/YYYY is to paste: they type eight
 * digits and the separators appear. (Moved from PayoutDetailsForm, 2026-10-13.)
 */
export function formatDob(value: string): string {
  const digits = digitsOnly(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** The bank-only replacement form ("that account didn't work" / new bank). */
export function buildBankDetailsSchema() {
  return z.object({ ...bankFields }).refine(...accountNumbersMatch);
}

export type PayoutDetailsInput = z.infer<ReturnType<typeof buildPayoutDetailsSchema>>;
export type BankDetailsInput = z.infer<ReturnType<typeof buildBankDetailsSchema>>;
