/**
 * WHAT:  The Payouts screen's body cards — the road (tracker), "Payouts are
 *        on", the ID-check heads-up, the two refusal cards and the skeleton.
 *        Presentational only: the screen owns every handler and decides which
 *        one shows.
 * WHY:   2026-10-14 (payout experience redesign, PR5). The screen was ~1,100
 *        lines with each state worded three times; payoutView now decides,
 *        and these draw what it decided. The road's ONE button is a step's
 *        action (an intent, mapped to a handler by the screen), the trust line
 *        sits beside the step that takes the details, and a finished road
 *        folds to one line.
 * LINKS: ../lib/payoutView.ts; ../lib/payoutCopy.ts; ./PayoutsHero.tsx;
 *        ../screens/PayoutsScreen.tsx; src/shared/ui/ProgressSteps.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  cardSurface,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Button, ProgressSteps, StatusPill } from '@/shared/ui';

import { COPY } from '../lib/payoutCopy';
import type { PayoutIntent, PayoutView } from '../lib/payoutView';

type Journey = Extract<PayoutView, { kind: 'journey' }>;
type Ready = Extract<PayoutView, { kind: 'ready' }>;

const LINK_EXPIRED =
  'That link expired — they only last a few minutes. Start again for a fresh one.';

export interface PayoutsJourneyCardProps {
  view: Journey;
  onIntent: (intent: PayoutIntent) => void;
  busy?: boolean;
  linkExpired?: boolean;
  /** The paid moment: the whole road, unfolded, this once. */
  celebrating?: boolean;
  /** Drawn behind the ID-check heads-up: the road, without its button or
   *  its trust line (the heads-up carries both). */
  inert?: boolean;
}

/** The road: where the reward is, step by step. */
export function PayoutsJourneyCard({
  view,
  onIntent,
  busy = false,
  linkExpired = false,
  celebrating = false,
  inert = false,
}: PayoutsJourneyCardProps) {
  const styles = useThemedStyles(makeStyles);
  const steps = view.steps.map(({ action, ...step }) =>
    action && !inert
      ? {
          ...step,
          action: { label: action.label, loading: busy, onPress: () => onIntent(action.intent) },
        }
      : step,
  );
  const trust = !inert && view.trustAt ? COPY.trust[view.trustAt] : null;
  return (
    <View style={styles.card} testID="payouts-journey">
      <ProgressSteps
        steps={steps}
        heading={COPY.heading}
        collapsed={celebrating ? undefined : (view.collapsed ?? undefined)}
        testID="payouts-steps"
      />
      {/* ⚠️ "NEVER STORE", NEVER "NEVER SEE" — the claim that holds on every
          path the details have taken. Beside the step that takes them, once. */}
      {trust ? (
        <Text style={styles.trust} testID="payouts-trust">
          {trust}
        </Text>
      ) : null}
      {linkExpired ? <Text style={styles.note}>{LINK_EXPIRED}</Text> : null}
    </View>
  );
}

/** Payouts on, nothing in flight: the state, and the one way to change it. */
export function PayoutsReadyCard({
  view,
  onIntent,
  busy = false,
  linkExpired = false,
}: {
  view: Ready;
  onIntent: (intent: PayoutIntent) => void;
  busy?: boolean;
  linkExpired?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  // Primary only when it is theirs to do (a refused payout); otherwise a
  // quiet way to change banks.
  const needsThem = view.chip.tone === 'warning';
  return (
    <View style={styles.card} testID="payouts-ready">
      <StatusPill label={view.chip.label} tone={view.chip.tone} testID="payouts-chip" />
      <Text style={styles.title} accessibilityRole="header">
        {view.status}
      </Text>
      {view.detail ? <Text style={styles.body}>{view.detail}</Text> : null}
      {linkExpired ? <Text style={styles.note}>{LINK_EXPIRED}</Text> : null}
      <Button
        label={view.action.label}
        variant={needsThem ? 'primary' : 'secondary'}
        loading={busy}
        onPress={() => onIntent(view.action.intent)}
      />
    </View>
  );
}

/**
 * The heads-up before the ID check opens: who, why, how long — the three
 * things an unannounced check screen left people guessing. No provider named
 * (owner, 2026-10-13).
 */
export function IdCheckIntroCard({
  onStart,
  onNotNow,
  launching,
}: {
  onStart: () => void;
  onNotNow: () => void;
  launching: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID="payouts-stripe-intro">
      <Text style={styles.title} accessibilityRole="header">
        A quick ID check
      </Text>
      <Text style={styles.body}>
        We need to confirm it’s really you. It takes about two minutes, and you may be asked for
        a photo of your ID. You’ll come straight back here.
      </Text>
      <Text style={styles.trust} testID="payouts-trust">
        {COPY.trust.id}
      </Text>
      <Button label="Start the check" onPress={onStart} loading={launching} />
      <Button label="Not now" variant="ghost" disabled={launching} onPress={onNotNow} />
    </View>
  );
}

/** Our steps couldn't describe them (a company, a non-UK account). */
export function DetailsRejectedCard({
  onAnotherWay,
  onTryAgain,
  busy,
}: {
  onAnotherWay: () => void;
  onTryAgain: () => void;
  busy: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID="payouts-details-rejected">
      <Text style={styles.title} accessibilityRole="header">
        We need different details
      </Text>
      <Text style={styles.body}>
        Our steps cover a UK account in your own name. If that isn’t you — a company, or an
        account elsewhere — you can set up payouts another way instead.
      </Text>
      <Button label="Set up another way" onPress={onAnotherWay} loading={busy} />
      <Button label="Try our steps again" variant="ghost" onPress={onTryAgain} disabled={busy} />
    </View>
  );
}

/** A bank change our three fields couldn't land. */
export function BankRejectedCard({
  onAnotherWay,
  busy,
}: {
  onAnotherWay: () => void;
  busy: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID="payouts-bank-rejected">
      <Text style={styles.title} accessibilityRole="header">
        That account couldn’t be added here
      </Text>
      <Text style={styles.body}>You can update your bank details another way instead.</Text>
      <Button
        label="Update another way"
        variant="secondary"
        onPress={onAnotherWay}
        loading={busy}
      />
    </View>
  );
}

/** Shaped like what loads: the hero, then the road — never a spinner. */
export function PayoutsSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.skeleton} testID="payouts-skeleton">
      <View style={styles.hero}>
        <View style={[styles.line, styles.short]} />
        <View style={[styles.line, styles.amount]} />
        <View style={[styles.line, styles.medium]} />
      </View>
      <View style={styles.card}>
        {[0, 1, 2].map((row) => (
          <View key={row} style={styles.stepRow}>
            <View style={styles.dot} />
            <View style={[styles.line, styles.medium]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The house card: flat, with the hairline that is its only edge in dark
    // mode (DESIGN_SYSTEM Card).
    card: {
      ...cardSurface(c),
      gap: spacing.md,
      padding: spacing.lg,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
    },
    body: {
      ...typography.body,
      color: c.textSecondary,
    },
    trust: {
      ...typography.caption,
      color: c.textSecondary,
    },
    note: {
      ...typography.caption,
      color: c.textSecondary,
    },
    skeleton: {
      gap: spacing.lg,
    },
    hero: {
      gap: spacing.sm,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    dot: {
      width: sizes.timelineRailColumn,
      height: sizes.timelineRailColumn,
      borderRadius: radii.full,
      backgroundColor: c.surfaceSubtle,
    },
    line: {
      height: sizes.skeletonLine,
      borderRadius: radii.sm,
      backgroundColor: c.surfaceSubtle,
    },
    short: { width: '30%' },
    medium: { width: '60%' },
    // The amount's block, at the hero amount's line height.
    amount: { width: '45%', height: typography.display.lineHeight },
  });
