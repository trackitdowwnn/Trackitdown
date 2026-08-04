/**
 * WHAT:  Tests for the payout details rules — dates, ages, sort codes.
 * WHY:   Everything validated here becomes unreadable to us the moment Stripe
 *        takes it: on an Express account the platform is locked out of KYC data
 *        once onboarding starts. So a value that slips through is a rejection
 *        we cannot see, explain, or fix for the spotter — the failure lands
 *        days later as "why haven't I been paid".
 * LINKS: ./payoutDetailsSchema.ts; ./PayoutDetailsForm.tsx.
 */

import { buildPayoutDetailsSchema, digitsOnly, parseUkDate } from './payoutDetailsSchema';

/** Fixed so the age rule is tested against a known clock, not today's. */
const NOW = new Date('2026-08-03T00:00:00Z');

const valid = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dob: '01/04/1990',
  phone: '07700900123',
  addressLine1: '12 Bridge Street',
  addressLine2: '',
  city: 'Manchester',
  postalCode: 'M1 1AA',
  sortCode: '10-88-00',
  accountNumber: '0001 2345',
  confirmAccountNumber: '00012345', // different spacing on purpose — digits match
};

const parse = (overrides: Partial<typeof valid> = {}) =>
  buildPayoutDetailsSchema(NOW).safeParse({ ...valid, ...overrides });

const errorFor = (field: string, overrides: Partial<typeof valid>) => {
  const result = parse(overrides);
  if (result.success) {
    return null;
  }
  return result.error.issues.find((issue) => issue.path[0] === field)?.message ?? null;
};

describe('parseUkDate', () => {
  it('reads a normal date', () => {
    expect(parseUkDate('01/04/1990')?.toISOString().slice(0, 10)).toBe('1990-04-01');
  });

  it('refuses a day that does not exist rather than rolling it forward', () => {
    // `new Date` turns 31 February into 3 March without complaint, which would
    // send Stripe a date of birth the person never typed.
    expect(parseUkDate('31/02/1990')).toBeNull();
  });

  it('refuses the wrong format outright', () => {
    expect(parseUkDate('1990-04-01')).toBeNull();
    expect(parseUkDate('1/4/1990')).toBeNull();
    expect(parseUkDate('')).toBeNull();
  });
});

describe('digitsOnly', () => {
  it('accepts the way these numbers are actually printed', () => {
    // A sort code is written 10-88-00 on a card and 10 88 00 on a statement.
    // Refusing what someone is copying from is a small cruelty.
    expect(digitsOnly('10-88-00')).toBe('108800');
    expect(digitsOnly('10 88 00')).toBe('108800');
    expect(digitsOnly('0001 2345')).toBe('00012345');
  });
});

describe('the rules', () => {
  it('accepts a complete, sensibly formatted set', () => {
    expect(parse().success).toBe(true);
  });

  it('requires a name it can put on a bank account', () => {
    expect(errorFor('firstName', { firstName: '  ' })).toBe('Enter your first name');
    expect(errorFor('lastName', { lastName: '' })).toBe('Enter your last name');
  });

  it('will not let someone under 18 be paid', () => {
    // Stripe rejects it, and it would be rejected after the handoff, where we
    // can no longer see or explain why.
    expect(errorFor('dob', { dob: '04/08/2010' })).toBe('You need to be 18 or over to be paid');
  });

  it('accepts someone who turned 18 today', () => {
    expect(parse({ dob: '03/08/2008' }).success).toBe(true);
  });

  it('rejects a birthday in the future', () => {
    expect(errorFor('dob', { dob: '01/01/2030' })).toBe('That date is in the future');
  });

  it('says what a sort code and account number should look like', () => {
    expect(errorFor('sortCode', { sortCode: '1088' })).toBe('A sort code is 6 digits');
    expect(errorFor('accountNumber', { accountNumber: '123' })).toBe(
      'An account number is 8 digits',
    );
  });

  it('rejects a sort code with the right length but the wrong content', () => {
    expect(errorFor('sortCode', { sortCode: 'ABCDEF' })).toBe('A sort code is 6 digits');
  });

  it('demands the account number twice, and blames the CONFIRM box on mismatch', () => {
    // A typo here is money to a stranger, silently, weeks later — the one
    // mistake no later screen can undo. The error lands on confirm because the
    // first entry is as likely to be the right one.
    expect(errorFor('confirmAccountNumber', { confirmAccountNumber: '00012346' })).toBe(
      'These don’t match — check both',
    );
  });

  it('needs an address — Stripe requires one for a UK individual', () => {
    expect(errorFor('addressLine1', { addressLine1: '' })).toBe('Enter your address');
    expect(errorFor('city', { city: '' })).toBe('Enter your town or city');
    expect(errorFor('postalCode', { postalCode: '' })).toBe('Enter your postcode');
  });

  it('treats the phone and second address line as genuinely optional', () => {
    expect(parse({ phone: '', addressLine2: '' }).success).toBe(true);
  });
});
