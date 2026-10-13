/**
 * WHAT:  The three step bodies of the payout-setup wizard — about you, your
 *        address, where to pay you — and the terms notice the review screen
 *        ends on.
 * WHY:   Split out of PayoutDetailsForm (2026-10-13, owner request: "the user
 *        does not get much if any progress indicators"). That form was eleven
 *        boxes on one page under a single Continue, with nothing to say how far
 *        along anyone was. On the shared wizard the progress bar, the gating,
 *        Back, the review-and-edit screen and the slide all come with the
 *        framework; a step body is only its inputs.
 *
 *        GROUPED, as report-a-bug is, not one box per screen: eleven screens to
 *        type a name and an address would trade one wall for a corridor. Three
 *        steps of related fields, then check and send.
 *
 *        ERRORS APPEAR ON LEAVING A FIELD, and go the moment it is edited
 *        again. The wizard gates Next on each step's schema, so a disabled Next
 *        with no word on which box is wrong would be a riddle; but an error
 *        shouting at a half-typed date is the opposite mistake. So a field is
 *        "touched" when it loses focus and untouched as soon as it changes —
 *        the old form's "clear the error the moment they start fixing it".
 *
 * PII:   every value here goes to Stripe on submit and is never stored or
 *        logged by us — see ../lib/payoutSetupAnswers.ts.
 * LINKS: ../lib/payoutSetupFlow.tsx (orders them); ./payoutDetailsSchema.ts
 *        (the rules); ../screens/PayoutSetupScreen.tsx (the host).
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';

import { legalHref } from '@/shared/lib';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { TextField } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import type { PayoutSetupAnswers } from '../lib/payoutSetupAnswers';
import {
  buildAboutYouSchema,
  buildAddressSchema,
  buildBankDetailsSchema,
  digitsOnly,
  formatDob,
  formatSortCode,
} from './payoutDetailsSchema';

type Field = keyof PayoutSetupAnswers;
type StepProps = WizardStepProps<PayoutSetupAnswers>;

/**
 * The step's errors, for the fields the spotter has finished — see the header.
 * `schema` comes from the same builder the flow gates Next with, so the words
 * under a box and the button that refuses can never disagree.
 *
 * ⚠️ "FINISHED" IS LEAVING THE FIELD *OR* FILLING IT (code review,
 * 2026-10-13). A tap on a disabled Next fires nothing and blurs nothing, so
 * the last box of a step — a mismatched confirm number, a date of birth that
 * can't be — would sit there wrong and silent while Next refused. A field with
 * a fixed length (`digits`) counts as finished the moment it is full.
 */
function useFieldErrors(schema: z.ZodType, { answers, setAnswers }: StepProps) {
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const errors: Partial<Record<Field, string>> = {};
  const parsed = schema.safeParse(answers);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const key = issue.path[0] as Field;
      // First message per field only: the first is the one they can act on.
      if (touched[key]) errors[key] ??= issue.message;
    });
  }
  const mark = (key: Field, value: boolean) =>
    setTouched((current) => (Boolean(current[key]) === value ? current : { ...current, [key]: value }));
  const field = (
    key: Field,
    options: { format?: (value: string) => string; digits?: number } = {},
  ) => ({
    value: answers[key] ?? '',
    error: errors[key],
    onChangeText: (value: string) => {
      const next = options.format ? options.format(value) : value;
      setAnswers({ [key]: next });
      mark(key, options.digits !== undefined && digitsOnly(next).length >= options.digits);
    },
    onBlur: () => mark(key, true),
  });
  return field;
}

/** Step 1 — who is being paid. */
export function AboutYouStep(props: StepProps) {
  const styles = useThemedStyles(makeStyles);
  // Built once per visit: the age rule reads "now", and a schema per keystroke
  // would be work for no answer.
  const schema = useMemo(() => buildAboutYouSchema(), []);
  const field = useFieldErrors(schema, props);

  return (
    <View style={styles.body}>
      <TextField label="First name" autoComplete="given-name" testID="payout-first-name" {...field('firstName')} />
      <TextField label="Last name" autoComplete="family-name" testID="payout-last-name" {...field('lastName')} />
      <TextField
        label="Date of birth"
        helperText="DD/MM/YYYY"
        keyboardType="number-pad"
        maxLength={10}
        testID="payout-dob"
        {...field('dob', { format: formatDob, digits: 8 })}
      />
      <TextField
        label="Phone (optional)"
        keyboardType="phone-pad"
        autoComplete="tel"
        testID="payout-phone"
        {...field('phone')}
      />
    </View>
  );
}

/** Step 2 — where they live, which Stripe checks the name against. */
export function AddressStep(props: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const schema = useMemo(() => buildAddressSchema(), []);
  const field = useFieldErrors(schema, props);

  return (
    <View style={styles.body}>
      <TextField
        label="Address line 1"
        autoComplete="address-line1"
        testID="payout-address-1"
        {...field('addressLine1')}
      />
      <TextField
        label="Address line 2 (optional)"
        autoComplete="address-line2"
        testID="payout-address-2"
        {...field('addressLine2')}
      />
      <TextField label="Town or city" testID="payout-city" {...field('city')} />
      <TextField
        label="Postcode"
        autoCapitalize="characters"
        autoComplete="postal-code"
        testID="payout-postcode"
        {...field('postalCode')}
      />
    </View>
  );
}

/** Step 3 — the bank. Typed twice: a typo is money sent to a stranger. */
export function BankStep(props: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const schema = useMemo(() => buildBankDetailsSchema(), []);
  const field = useFieldErrors(schema, props);

  return (
    <View style={styles.body}>
      <TextField
        label="Sort code"
        helperText="6 digits"
        keyboardType="number-pad"
        // 12-34-56: six digits and the two dashes typed for them.
        maxLength={8}
        autoCorrect={false}
        autoComplete="off"
        testID="payout-sort-code"
        {...field('sortCode', { format: formatSortCode, digits: 6 })}
      />
      {/* Room for one separator ("0001 2345"), as people copy it from a card;
          never a keyboard guess at a bank number. */}
      <TextField
        label="Account number"
        helperText="8 digits"
        keyboardType="number-pad"
        maxLength={9}
        autoCorrect={false}
        autoComplete="off"
        testID="payout-account-number"
        {...field('accountNumber', { digits: 8 })}
      />
      <TextField
        label="Confirm account number"
        keyboardType="number-pad"
        maxLength={9}
        autoCorrect={false}
        autoComplete="off"
        testID="payout-confirm-account-number"
        {...field('confirmAccountNumber', { digits: 8 })}
      />
    </View>
  );
}

/**
 * The terms, at the head of the review screen.
 *
 * REQUIRED, not decoration: the identity token attests that these terms were
 * SHOWN and accepted — `shown_and_accepted: true` is a legal claim this block
 * makes true, and "Send to Stripe" is the acceptance. So it sits directly under
 * the review's title, on screen whenever that pinned button is (see the flow's
 * `review.header`).
 */
export function PayoutTermsNotice() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  return (
    <View style={styles.terms} testID="payout-terms">
      {/* PRECISE ON PURPOSE, and deliberately modest: "pass straight to" and
          "never store" are both true. "Never see" is the claim a regulator
          would test hardest; the tokens are minted on the phone today
          (ADR-0010), but the sentence is kept to what holds across both the
          tokenised path and the server-side fallback. */}
      <Text style={styles.note}>
        We pass these straight to our payment partner, who handles payments and the ID
        check, and we never store them.
      </Text>
      {/* ⚠️ THE ONE PROVIDER NAME KEPT (owner asked for none in the app,
          2026-10-13). The agreement is a named legal document: the identity
          token attests it was SHOWN and accepted, so the link must say what it
          is. Renaming it ("our partner's terms") would weaken exactly the
          claim `shown_and_accepted: true` makes. Everything around it says
          "payment partner". */}
      <Text style={styles.note}>
        By sending you agree to{' '}
        <Text
          style={styles.link}
          onPress={() => router.push(legalHref('terms'))}
          accessibilityRole="link"
        >
          our terms
        </Text>{' '}
        and the{' '}
        <Text
          style={styles.link}
          onPress={() => void Linking.openURL('https://stripe.com/connect-account/legal')}
          accessibilityRole="link"
        >
          Stripe Connected Account Agreement
        </Text>
        . You may be asked to verify your identity before your first payout.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: spacing.md,
    },
    terms: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    note: {
      ...typography.caption,
      color: c.textSecondary,
    },
    link: {
      ...typography.caption,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
