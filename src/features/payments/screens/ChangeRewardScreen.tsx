/**
 * WHAT:  ChangeRewardScreen — the owner changes the reward on their LIVE
 *        listing (raise it, or lower it if nobody has reported a sighting
 *        lately), or adds a reward to a £5 fee listing. Choose an amount, read
 *        exactly what happens to the money, pay with the PaymentSheet, and come
 *        back to the listing once the new reward is held.
 * WHY:   Until now the only way to change a live reward was deactivate, refund
 *        and repost — losing the listing's sightings and its place in alerts,
 *        in the hours that matter most. A change is a NEW charge: once it is
 *        held, the old reward is refunded to the owner's card. So the screen's
 *        one job beyond the slider is honesty about that, before Stripe's sheet
 *        (the next thing they see) takes the money:
 *          * the SUMMARY above Pay, in body text — charged now, back to your
 *            card and when, and the card fee kept (the true cost of a change);
 *          * the slider's own PANEL, worded like the posting flow's — the 95/5
 *            split, and what the new reward returns if nobody finds the car.
 *        Every refund figure is estimateRefundPence (the one function every
 *        refund quote uses); the server refunds the exact amount.
 *
 *        THE AMOUNT NEVER RIDES WITH THE CHARGE. It is written first through
 *        set_reward_renewal_amount (the server checks the range and the
 *        lowering rule), then the charge call carries the post id alone.
 *
 *        AFTER THE SHEET SAYS "PAID" the reward is not yet changed — the webhook
 *        does that. The screen says "Payment received. Updating your listing…"
 *        and polls the owner's reward status until its rewardId moves, so
 *        "Your reward is now £X" is only said once it is true. If that takes
 *        longer than the poll, it says the payment landed and the listing will
 *        catch up, which is also true.
 * LINKS: ../api/rewardChangeApi.ts; ../hooks/useBountyPayment.ts;
 *        supabase/migrations/20261005130000_a_reward_can_be_changed.sql;
 *        src/app/change-reward.tsx (the route, inside BountyPaymentProvider);
 *        src/shared/ui/MoneySlider.tsx (defaultBountyPanelCopy, the posting
 *        flow's wording this panel follows); docs/DESIGN_SYSTEM.md.
 */

import { useRouter } from 'expo-router';
import { ChevronLeft, Info } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BOUNTY_SNAP_STEPS,
  DEFAULT_BOUNTY_PENCE,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
} from '@/shared/lib/bountyBounds';
import { PaymentError } from '@/shared/lib/functionError';
import { createLogger } from '@/shared/lib/logger';
import { LISTING_FEE_PENCE, estimateRefundPence, formatPounds } from '@/shared/lib/money';
import {
  cardSurface,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  Button,
  ErrorState,
  FullscreenLoader,
  MoneySlider,
  Screen,
  defaultBountyPanelCopy,
  useToast,
  type MoneySliderPanelCopy,
} from '@/shared/ui';

import {
  LOWERING_RULE_SENTENCE,
  createRewardChangeIntent,
  fetchMyRewardStatus,
  setRewardRenewalAmount,
  type RewardStatus,
} from '../api/rewardChangeApi';
import { useBountyPayment } from '../hooks/useBountyPayment';

const log = createLogger('payments');

/** How long to wait for the webhook to make the new reward the listing's. */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 1500;

/**
 * The slider panel: the posting flow's split line, and an escrow line for a
 * reward charged NOW (the posting flow's says "when your post goes live", and
 * mentions an expiry this listing does not have yet). Module const so the
 * slider's props stay referentially stable.
 */
const CHANGE_PANEL: MoneySliderPanelCopy = {
  splitLine: defaultBountyPanelCopy.splitLine,
  escrowLine: (pence) =>
    `${formatPounds(pence)} is charged now and held. You only pay it if a spotter finds your car — otherwise about ${formatPounds(
      estimateRefundPence(pence),
    )} comes back to you. Card fees aren’t refundable.`,
};

export interface ChangeRewardScreenProps {
  postId: string;
  /** The mode the opener already knew (from the listing), so the title is
   *  right before the status loads. The loaded status always wins. */
  initialMode?: 'change' | 'add';
  /** Test seam: the poll's wait. Defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
}

const realWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function ChangeRewardScreen({ postId, initialMode, wait = realWait }: ChangeRewardScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const { payBounty } = useBountyPayment();

  const [status, setStatus] = useState<RewardStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amountPence, setAmountPence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    // Set in the body too: a StrictMode / fast-refresh remount runs the
    // cleanup and then this again, and must not leave the screen deaf.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Every state write is inside the promise chain: this runs from the mount
  // effect, where a synchronous setState would cascade a render
  // (react-hooks/set-state-in-effect — BlockedAccountsScreen records the same
  // pattern). Only the retry clears the error, because only there is the
  // screen coming FROM a settled state.
  const load = useCallback(() => {
    fetchMyRewardStatus(postId)
      .then((next) => {
        if (!mounted.current) return;
        setStatus(next);
        setAmountPence((current) => current ?? next.amountPence ?? DEFAULT_BOUNTY_PENCE);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setLoadError(err instanceof PaymentError ? err.message : 'We couldn’t load your reward.');
      });
  }, [postId]);

  useEffect(load, [load]);

  // MoneySlider re-registers its drag gesture if the handler identity changes.
  const onChangePence = useCallback((pence: number) => setAmountPence(pence), []);

  const isAdd = (status?.mode ?? initialMode) === 'add';
  const currentPence = status?.amountPence ?? null;
  // With recent sightings the server refuses to lower the reward; the slider
  // simply starts at today's amount instead of offering a refusal.
  const minPence =
    !isAdd && status?.hasRecentSightings && currentPence !== null
      ? Math.max(MIN_BOUNTY_PENCE, currentPence)
      : MIN_BOUNTY_PENCE;
  // Clamped ONCE and used everywhere, so the Pay label, the summary and the
  // amount sent can never name a different figure from the slider.
  const chosen = Math.max(amountPence ?? DEFAULT_BOUNTY_PENCE, minPence);
  const unchanged = !isAdd && currentPence !== null && chosen === currentPence;

  const submit = useCallback(async () => {
    // The same guards as the button's disabled state, held here too: paying
    // for an unchanged reward would only cost the owner a card fee.
    if (busy || status === null || status.blockedMessage || unchanged) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setRewardRenewalAmount(postId, chosen);
      const secret = await createRewardChangeIntent(postId);
      const payment = await payBounty(secret);
      if (payment.outcome === 'cancelled') {
        return;
      }
      if (payment.outcome === 'failed') {
        setError(payment.message);
        return;
      }

      // Paid — now wait for the webhook to make it the listing's reward, and
      // say so: a silent spinner after a payment reads as a failed one.
      setConfirming(true);
      AccessibilityInfo.announceForAccessibility('Payment received. Updating your listing.');
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        await wait(POLL_INTERVAL_MS);
        if (!mounted.current) return;
        try {
          const next = await fetchMyRewardStatus(postId);
          if (next.rewardId && next.rewardId !== status.rewardId) {
            toast.show(
              isAdd
                ? `Your listing now offers a ${formatPounds(next.amountPence ?? chosen)} reward.`
                : `Your reward is now ${formatPounds(next.amountPence ?? chosen)}.`,
            );
            router.back();
            return;
          }
        } catch {
          // A blip while polling is not a failure of the payment; keep waiting.
        }
      }
      // NEUTRAL on purpose: if the capture turned into a stray (a claim
      // appeared, the listing closed), the reward will NOT change — that money
      // comes back in full — so this must not promise a new reward.
      toast.show('Payment received — we’re confirming it. Check your listing in a moment.');
      router.back();
    } catch (err) {
      log.warn('reward change failed', {
        postId,
        code: err instanceof PaymentError ? err.code : 'UNKNOWN',
      });
      setError(err instanceof PaymentError ? err.message : 'We couldn’t change your reward. Please try again.');
    } finally {
      if (mounted.current) {
        setBusy(false);
        setConfirming(false);
      }
    }
  }, [busy, chosen, isAdd, payBounty, postId, router, status, toast, unchanged, wait]);

  if (status === null && !loadError) {
    // A blocking wait shows the brand loader (docs/DESIGN_SYSTEM.md).
    return <FullscreenLoader visible message="Loading your reward" />;
  }

  const header = (
    <View style={styles.headerRow}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.back}
        testID="change-reward-back"
      >
        <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
      </Pressable>
      <Text style={styles.title} accessibilityRole="header">
        {isAdd ? 'Add a reward' : 'Change your reward'}
      </Text>
    </View>
  );

  if (status === null) {
    return (
      <Screen scroll contentContainerStyle={styles.scroll}>
        {header}
        <ErrorState
          body={loadError ?? undefined}
          onRetry={() => {
            setLoadError(null);
            load();
          }}
        />
      </Screen>
    );
  }

  // Blocked: say why, and offer the way back — never a checkout that cannot
  // be completed.
  if (status.blockedMessage) {
    return (
      <Screen scroll contentContainerStyle={styles.scroll}>
        {header}
        <View style={styles.notice} testID="change-reward-blocked">
          <Info size={sizes.iconSm} color={palette.textSecondary} />
          <Text style={styles.noticeText}>{status.blockedMessage}</Text>
        </View>
        <Button label="Back to your listing" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const refundBack =
    currentPence === null ? null : status.feeAbsorbed ? currentPence : estimateRefundPence(currentPence);
  const feeKept = currentPence !== null && refundBack !== null ? currentPence - refundBack : 0;

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      {header}

      <Text style={styles.lede}>
        {isAdd
          ? 'Offer a reward to whoever finds your car. Spotters see it on your listing as soon as it’s paid.'
          : currentPence !== null
            ? `Your listing offers a ${formatPounds(currentPence)} reward. Choose a new amount.${
                status.hasRecentSightings ? ` ${LOWERING_RULE_SENTENCE}` : ''
              }`
            : 'Choose a new amount.'}
      </Text>

      <MoneySlider
        label={isAdd ? 'Reward' : 'New reward'}
        valuePence={chosen}
        onChangePence={onChangePence}
        minPence={minPence}
        maxPence={MAX_BOUNTY_PENCE}
        snapSteps={BOUNTY_SNAP_STEPS}
        panel={CHANGE_PANEL}
        disabled={busy}
        accessibilityLabel={isAdd ? 'Reward amount' : 'New reward amount'}
        testID="change-reward-slider"
      />

      {/* THE SUMMARY — everything that happens to the owner's money, in body
          text, directly above Pay. Stripe's sheet is the next thing they see,
          so this is the only place they can learn it. */}
      <View style={styles.summary} testID="change-reward-summary">
        <SummaryRow label="Charged now" value={formatPounds(chosen)} styles={styles} />
        {isAdd ? (
          <SummaryRow
            label={`Your ${formatPounds(LISTING_FEE_PENCE)} listing fee`}
            value="Not refunded — it paid for the listing"
            styles={styles}
          />
        ) : refundBack !== null && !unchanged ? (
          <>
            <SummaryRow
              label="Back to your card"
              value={
                status.feeAbsorbed
                  ? `${formatPounds(refundBack)}, in full, in 5–10 working days`
                  : `About ${formatPounds(refundBack)}, in 5–10 working days`
              }
              styles={styles}
            />
            {!status.feeAbsorbed && feeKept > 0 ? (
              <SummaryRow label="Card fee kept" value={`About ${formatPounds(feeKept)}`} styles={styles} />
            ) : null}
          </>
        ) : null}
      </View>

      {unchanged ? (
        <Text style={styles.caption}>Choose a different amount to change your reward.</Text>
      ) : null}

      {confirming ? (
        <Text style={styles.caption} testID="change-reward-confirming">
          Payment received. Updating your listing…
        </Text>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert" testID="change-reward-error">
          {error}
        </Text>
      ) : null}

      {/* Inline at the end of the scroll, not a sticky bar: reaching it means
          passing the summary, which is right for a screen that takes money. */}
      <Button
        label={`Pay ${formatPounds(chosen)}`}
        onPress={() => void submit()}
        loading={busy}
        disabled={unchanged}
        accessibilityHint="Opens card payment"
      />
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
    flexShrink: 1,
  },
  lede: {
    ...typography.body,
    color: c.textPrimary,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: c.surfaceSubtle,
  },
  noticeText: {
    ...typography.body,
    color: c.textPrimary,
    flex: 1,
  },
  summary: {
    ...cardSurface(c),
    padding: spacing.lg,
    gap: spacing.sm,
  },
  summaryRow: {
    gap: spacing.xs,
  },
  summaryLabel: {
    ...typography.label,
    color: c.textPrimary,
  },
  summaryValue: {
    ...typography.body,
    color: c.textPrimary,
  },
  caption: {
    ...typography.caption,
    color: c.textSecondary,
  },
  error: {
    ...typography.body,
    color: c.danger,
  },
});
