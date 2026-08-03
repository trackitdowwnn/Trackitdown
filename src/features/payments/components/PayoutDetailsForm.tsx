/**
 * WHAT:  The native form where a spotter gives us their bank details and the
 *        identity fields Stripe needs — in our own UI, in our own app.
 * WHY:   Until now every one of these boxes was a box on Stripe's screen. Stripe
 *        permits a platform to submit them itself for an Express account, but
 *        only until the first Account Session exists, after which the platform
 *        is locked out for the life of that account. This form is the whole
 *        reason `connect-onboarding` now refuses to mint a session until it has
 *        run — see `submit-payout-details`.
 *
 *        WHAT IT CANNOT REMOVE: Stripe's own verification screen and its
 *        sign-in popup. Those are fixed on an Express account, and the only way
 *        to be rid of them is to become the party legally responsible for
 *        identity checks. So this form's job is to make what follows it SHORT,
 *        not to replace it — and the copy says so rather than implying the
 *        spotter is finished.
 *
 * PII:   nothing typed here is stored by us. The values live in this component's
 *        state for as long as the screen is open, go to Stripe through one Edge
 *        Function, and are gone. They are never logged — there is a test for it
 *        in payoutsApi.test.ts.
 * LINKS: ./payoutDetailsSchema.ts (the rules);
 *        ../api/payoutsApi.ts (submitPayoutDetails);
 *        supabase/functions/submit-payout-details/index.ts;
 *        ../screens/PayoutsScreen.tsx (the consumer).
 */

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';
import { Button, TextField } from '@/shared/ui';

import type { PayoutDetails } from '../api/payoutsApi';
import { buildPayoutDetailsSchema, digitsOnly, parseUkDate } from './payoutDetailsSchema';

export interface PayoutDetailsFormProps {
  /**
   * Submits to Stripe. Handles its own failures — this form never sees an
   * error, because `void submit()` below would turn a rejection into an
   * unhandled one.
   */
  onSubmit: (details: PayoutDetails) => Promise<void>;
  /** Back out without finishing. Ten fields of bank and identity data with no
   *  way out but the back chevron is a trap, not a form. */
  onCancel: () => void;
  busy?: boolean;
}

type Fields = {
  firstName: string;
  lastName: string;
  dob: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  sortCode: string;
  accountNumber: string;
};

const EMPTY: Fields = {
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
};

export function PayoutDetailsForm({
  onSubmit,
  onCancel,
  busy = false,
}: PayoutDetailsFormProps) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  /**
   * Types the slashes for them.
   *
   * The field asks for DD/MM/YYYY on a number pad — and the iOS number pad has
   * no `/` key at all, so without this the only way to satisfy the format is to
   * paste. They type eight digits and the separators appear.
   */
  const formatDob = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  };

  const set = useCallback(
    (key: keyof Fields) => (value: string) => {
      const next = key === 'dob' ? formatDob(value) : value;
      setFields((current) => ({ ...current, [key]: next }));
      // Clear the error the moment they start fixing it — leaving it up while
      // someone types the correction reads as "still wrong".
      setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    },
    [],
  );

  const submit = useCallback(async () => {
    const parsed = buildPayoutDetailsSchema().safeParse(fields);
    if (!parsed.success) {
      const next: Partial<Record<keyof Fields, string>> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path[0] as keyof Fields;
        // First message per field only: three complaints about one box is
        // noise, and the first is the one they can act on.
        next[key] ??= issue.message;
      });
      setErrors(next);
      return;
    }

    const date = parseUkDate(parsed.data.dob);
    if (!date) {
      return; // unreachable — the schema already refused it
    }
    await onSubmit({
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      // Stripe wants YYYY-MM-DD; the person typed DD/MM/YYYY.
      dob: date.toISOString().slice(0, 10),
      phone: parsed.data.phone || undefined,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2 || undefined,
      city: parsed.data.city,
      postalCode: parsed.data.postalCode,
      sortCode: digitsOnly(parsed.data.sortCode),
      accountNumber: digitsOnly(parsed.data.accountNumber),
    });
  }, [fields, onSubmit]);

  return (
    <View style={styles.form} testID="payout-details-form">
      {/* PRECISE ON PURPOSE. This said "we never see or store your bank
          details", which is half false: they are POSTed to our own server and
          held in memory on the way to Stripe. "Pass straight on" and "never
          store" are both true; "never see" was not, and it is exactly the
          sentence a regulator would quote back. */}
      <Text style={styles.lede}>
        We pass these straight to Stripe, who handle the payments and the ID check, and
        we never store them.
      </Text>

      <Text style={styles.section}>Your details</Text>
      <TextField
        label="First name"
        value={fields.firstName}
        onChangeText={set('firstName')}
        error={errors.firstName}
        autoComplete="given-name"
        testID="payout-first-name"
      />
      <TextField
        label="Last name"
        value={fields.lastName}
        onChangeText={set('lastName')}
        error={errors.lastName}
        autoComplete="family-name"
        testID="payout-last-name"
      />
      <TextField
        label="Date of birth"
        value={fields.dob}
        onChangeText={set('dob')}
        error={errors.dob}
        helperText="DD/MM/YYYY"
        keyboardType="number-pad"
        maxLength={10}
        testID="payout-dob"
      />
      <TextField
        label="Phone (optional)"
        value={fields.phone}
        onChangeText={set('phone')}
        keyboardType="phone-pad"
        autoComplete="tel"
        testID="payout-phone"
      />

      <Text style={styles.section}>Your address</Text>
      <TextField
        label="Address line 1"
        value={fields.addressLine1}
        onChangeText={set('addressLine1')}
        error={errors.addressLine1}
        testID="payout-address-1"
      />
      <TextField
        label="Address line 2 (optional)"
        value={fields.addressLine2}
        onChangeText={set('addressLine2')}
        testID="payout-address-2"
      />
      <TextField
        label="Town or city"
        value={fields.city}
        onChangeText={set('city')}
        error={errors.city}
        testID="payout-city"
      />
      <TextField
        label="Postcode"
        value={fields.postalCode}
        onChangeText={set('postalCode')}
        error={errors.postalCode}
        autoCapitalize="characters"
        testID="payout-postcode"
      />

      <Text style={styles.section}>Where to pay you</Text>
      <TextField
        label="Sort code"
        value={fields.sortCode}
        onChangeText={set('sortCode')}
        error={errors.sortCode}
        helperText="6 digits"
        keyboardType="number-pad"
        testID="payout-sort-code"
      />
      <TextField
        label="Account number"
        value={fields.accountNumber}
        onChangeText={set('accountNumber')}
        error={errors.accountNumber}
        helperText="8 digits"
        keyboardType="number-pad"
        testID="payout-account-number"
      />

      {/* Honest about what comes next. Saying "done" here and then showing a
          Stripe verification screen would feel like a bait and switch. */}
      <Text style={styles.note}>
        Stripe will ask you to confirm a few things after this — usually much less than
        if you started from scratch.
      </Text>

      {/* `loading`, not a swapped label plus `disabled` — the house busy state
          keeps the fill and announces "busy" rather than "dimmed". */}
      <Button label="Continue" onPress={() => void submit()} loading={busy} />
      <Button label="Not now" variant="ghost" onPress={onCancel} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  lede: {
    ...typography.body,
    color: colors.textSecondary,
  },
  section: {
    ...typography.heading,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
