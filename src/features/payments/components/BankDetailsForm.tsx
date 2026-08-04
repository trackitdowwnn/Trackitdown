/**
 * WHAT:  The bank-only form — replaces WHERE the money lands on an account
 *        that already exists. Three fields, no identity, never leaves the app.
 * WHY:   Two moments need exactly this and nothing more: "Update bank details"
 *        on a working account, and the re-entry after a payout failed because
 *        the bank details were wrong. Until 2026-08-04 both went looking for a
 *        Stripe browser page — which for legacy Express accounts didn't even
 *        exist (`account_update` links are refused when Stripe collects
 *        requirements), so the button showed a spinner and went nowhere.
 *        Identity is already with Stripe and is immutable-ish once verified;
 *        re-asking ten fields to change one bank account would be the old
 *        cruelty back again.
 *
 *        NO ToS block, deliberately: acceptance rode the identity token when
 *        the account was created. A bank token carries no attestation, and
 *        re-showing terms here would imply they were agreeing to something new.
 *
 * PII:   same posture as the full form — the values live in component state,
 *        become a single-use `btok_` on the phone, and are gone. Never logged.
 * LINKS: ./payoutDetailsSchema.ts (buildBankDetailsSchema — shared bank trio);
 *        ./PayoutDetailsForm.tsx (the full earn-moment sibling);
 *        ../api/stripeTokens.ts (createBankToken);
 *        supabase/functions/create-payout-account/index.ts (the RE-BANK branch).
 */

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';
import { Button, TextField } from '@/shared/ui';

import { buildBankDetailsSchema, digitsOnly } from './payoutDetailsSchema';

export interface BankDetailsFormProps {
  /** Submits to Stripe. Handles its own failures — see PayoutDetailsForm. */
  onSubmit: (details: { sortCode: string; accountNumber: string }) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

type Fields = {
  sortCode: string;
  accountNumber: string;
  confirmAccountNumber: string;
};

const EMPTY: Fields = { sortCode: '', accountNumber: '', confirmAccountNumber: '' };

export function BankDetailsForm({ onSubmit, onCancel, busy = false }: BankDetailsFormProps) {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  const set = useCallback(
    (key: keyof Fields) => (value: string) => {
      setFields((current) => ({ ...current, [key]: value }));
      setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
    },
    [],
  );

  const submit = useCallback(async () => {
    const parsed = buildBankDetailsSchema().safeParse(fields);
    if (!parsed.success) {
      const next: Partial<Record<keyof Fields, string>> = {};
      parsed.error.issues.forEach((issue) => {
        const key = issue.path[0] as keyof Fields;
        next[key] ??= issue.message;
      });
      setErrors(next);
      return;
    }
    await onSubmit({
      sortCode: digitsOnly(parsed.data.sortCode),
      accountNumber: digitsOnly(parsed.data.accountNumber),
    });
  }, [fields, onSubmit]);

  return (
    <View style={styles.form} testID="bank-details-form">
      {/* "From then on", not "immediately": a payout already on its way to the
          old account is not recalled by this. */}
      <Text style={styles.lede}>
        Your new account goes straight to Stripe — we never store it. Bounties are sent
        there from then on.
      </Text>

      <TextField
        label="Sort code"
        value={fields.sortCode}
        onChangeText={set('sortCode')}
        error={errors.sortCode}
        helperText="6 digits"
        keyboardType="number-pad"
        testID="bank-sort-code"
      />
      <TextField
        label="Account number"
        value={fields.accountNumber}
        onChangeText={set('accountNumber')}
        error={errors.accountNumber}
        helperText="8 digits"
        keyboardType="number-pad"
        testID="bank-account-number"
      />
      <TextField
        label="Confirm account number"
        value={fields.confirmAccountNumber}
        onChangeText={set('confirmAccountNumber')}
        error={errors.confirmAccountNumber}
        keyboardType="number-pad"
        testID="bank-confirm-account-number"
      />

      <Button label="Save new account" onPress={() => void submit()} loading={busy} />
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
});
