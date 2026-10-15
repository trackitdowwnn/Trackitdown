/**
 * WHAT:  The three step bodies of the payout-setup wizard — about you, your
 *        address, where to pay you (and check and send) — and the terms
 *        notice the last one opens with.
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';

import { legalHref } from '@/shared/lib';
import { sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { TextField } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { fetchMyFirstName } from '../api/payoutsApi';
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

/**
 * Their profile's first name, offered once as the box's starting value
 * (PR6). ⚠️ NEVER OVER WHAT THEY TYPED: if the box has anything in it by the
 * time the name arrives — or ever had, this visit — the suggestion is dropped.
 */
function usePrefillFirstName({ answers, setAnswers }: StepProps) {
  const [suggested, setSuggested] = useState<string | null>(null);
  const settled = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetchMyFirstName().then((name) => {
      if (!cancelled) setSuggested(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const typed = Boolean(answers.firstName);
  useEffect(() => {
    if (settled.current) return;
    if (typed) {
      settled.current = true;
    } else if (suggested) {
      settled.current = true;
      setAnswers({ firstName: suggested });
    }
  }, [typed, suggested, setAnswers]);
}

/** Step 1 — who is being paid. */
export function AboutYouStep(props: StepProps) {
  const styles = useThemedStyles(makeStyles);
  // Built once per visit: the age rule reads "now", and a schema per keystroke
  // would be work for no answer.
  const schema = useMemo(() => buildAboutYouSchema(), []);
  const field = useFieldErrors(schema, props);
  usePrefillFirstName(props);

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
        label="Phone"
        // Why we ask, in the place they wonder: required since 2026-10-14,
        // because our payment partner holds payouts without one.
        helperText="Our payment partner needs one to pay you"
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
      {/* POSTCODE FIRST (owner, 2026-10-14): the box the phone's address
          autofill keys on, and the UK check before three more boxes. Typed
          in capitals as it's printed; no location button, by choice. */}
      <TextField
        label="Postcode"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="postal-code"
        textContentType="postalCode"
        maxLength={10}
        testID="payout-postcode"
        {...field('postalCode', { format: (value) => value.toUpperCase() })}
      />
      <TextField
        label="Address line 1"
        autoComplete="address-line1"
        textContentType="streetAddressLine1"
        testID="payout-address-1"
        {...field('addressLine1')}
      />
      <TextField
        label="Address line 2 (optional)"
        autoComplete="address-line2"
        textContentType="streetAddressLine2"
        testID="payout-address-2"
        {...field('addressLine2')}
      />
      <TextField
        label="Town or city"
        autoComplete="postal-address-locality"
        textContentType="addressCity"
        testID="payout-city"
        {...field('city')}
      />
    </View>
  );
}

/**
 * Step 3 — the bank, and the send. Typed twice: a typo is money sent to a
 * stranger.
 *
 * ⚠️ THE REVIEW SCREEN FOLDED IN HERE (PR6, owner: "setup feels long"). Four
 * screens became three, so this step carries what the review did:
 *   • THE TERMS FIRST, at the top of the body. "Send my details" is pinned and
 *     never scrolls, and the identity token attests the terms were SHOWN — so
 *     they sit where they're on screen on arrival, with the button, exactly
 *     where the review had them (directly under its title; security review,
 *     2026-10-13). Below the fields they could be scrolled past, or sit under
 *     the keyboard, at the moment of sending.
 *   • A compact check of the other two steps, each with an Edit that comes
 *     straight back here (the wizard's edit spur).
 */
export function BankStep(props: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const schema = useMemo(() => buildBankDetailsSchema(), []);
  const field = useFieldErrors(schema, props);
  const { answers, editStep, busy } = props;

  return (
    <View style={styles.body}>
      <PayoutTermsNotice />
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
      <View style={styles.summary} testID="payout-summary">
        <Text style={styles.summaryTitle} accessibilityRole="header">
          Check and send
        </Text>
        <SummaryRow
          label="You"
          value={describeYou(answers)}
          editLabel="Edit your name, date of birth and phone"
          onEdit={editStep ? () => editStep('about-you') : undefined}
          disabled={busy}
          testID="payout-summary-you"
        />
        <SummaryRow
          label="Home address"
          value={describeAddress(answers)}
          editLabel="Edit your address"
          onEdit={editStep ? () => editStep('address') : undefined}
          disabled={busy}
          testID="payout-summary-address"
        />
      </View>
    </View>
  );
}

/** "Ada Lovelace · born 01/04/1990 · 07700 900123" */
export function describeYou(answers: Partial<PayoutSetupAnswers>): string {
  const name = `${answers.firstName ?? ''} ${answers.lastName ?? ''}`.trim();
  return [name, answers.dob ? `born ${answers.dob}` : '', answers.phone?.trim()]
    .filter(Boolean)
    .join(' · ');
}

/** "12 Bridge Street, Manchester, M1 1AA" */
export function describeAddress(answers: Partial<PayoutSetupAnswers>): string {
  return [answers.addressLine1, answers.addressLine2, answers.city, answers.postalCode]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/** One checked answer, and the way back to change it. */
function SummaryRow({
  label,
  value,
  editLabel,
  onEdit,
  disabled,
  testID,
}: {
  label: string;
  value: string;
  editLabel: string;
  onEdit?: () => void;
  disabled?: boolean;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summaryRow} testID={testID}>
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
      {/* Absent on an edit spur (the wizard won't nest one in another). */}
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={editLabel}
          accessibilityState={{ disabled: Boolean(disabled) }}
          style={styles.summaryEdit}
          testID={`${testID}-edit`}
        >
          <Text style={styles.link}>Edit</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The terms, at the head of the last step (BankStep; the review screen's head
 * until PR6 folded it in).
 *
 * REQUIRED, not decoration: the identity token attests that these terms were
 * SHOWN and accepted — `shown_and_accepted: true` is a legal claim this block
 * makes true, and "Send my details" is the acceptance. So it sits at the top
 * of that step's body, on screen on arrival with the pinned button.
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
    // The folded-in review: a hairline above, then two quiet rows.
    summary: {
      gap: spacing.md,
      marginTop: spacing.md,
      paddingTop: spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
    summaryTitle: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    summaryText: {
      flex: 1,
      gap: spacing.xs,
    },
    summaryLabel: {
      ...typography.caption,
      color: c.textSecondary,
    },
    summaryValue: {
      ...typography.body,
      color: c.textPrimary,
    },
    summaryEdit: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
  });
