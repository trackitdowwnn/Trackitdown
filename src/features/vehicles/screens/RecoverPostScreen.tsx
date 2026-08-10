/**
 * WHAT:  RecoverPostScreen — "You got it back." The owner marks their listing
 *        recovered and either credits the sighting that led to it, or says they
 *        found it another way.
 * WHY:   This is the screen the whole product exists to reach, and until now it
 *        did not exist: `claim_recovery` shipped with no way to call it, so an
 *        owner could post, pay, be sighted and chat — and then run out of road.
 *
 *        DOMAIN.md lifecycle 4: the owner is shown their sightings and picks
 *        the one that made the difference, or none. Exactly one can be credited
 *        (no splitting in v1), so this is a single-choice list, not checkboxes.
 *
 *        THE TWO ENDINGS ARE BOTH REAL. "I found it myself" is not a failure to
 *        choose — most cars are found by police or by the owner, and that
 *        ending refunds the bounty. Crediting a spotter sends it to them. The
 *        screen must not push toward either; the copy stays even-handed and the
 *        no-spotter option is a peer, not a get-out.
 *
 * MONEY: BOTH endings now actually move money. Until 2026-08-03 only the refund
 *        did: the credited branch showed "we'll get the bounty to them" and
 *        called nothing, stranding the post on `recovery_claimed` — which also
 *        blocked the owner's account deletion forever. Once the claim lands it
 *        CANNOT be undone (`claim_recovery` accepts `active` only), so every
 *        branch after it — including the failures — is worded as "they are
 *        credited, here is where the money is", never as "try again".
 * LINKS: ../api/recoveryApi.ts (the three calls and why there are three);
 *        src/features/sightings/hooks/usePostSightings.ts;
 *        supabase/migrations/20260802200000_claim_recovery.sql;
 *        docs/DOMAIN.md (lifecycle 4-6, "Single winner").
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { notifyCredited } from '@/features/notifications';
import { exitCheck } from '@/features/payments';
import { usePostSightings } from '@/features/sightings';
import { formatPounds } from '@/shared/lib/money';
import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import { Button, EmptyState, Screen, useToast } from '@/shared/ui';

import { RecoveryError, claimRecovery, refundRecovery, releasePayout } from '../api/recoveryApi';
import { ExitAttestation } from '../components/ExitAttestation';

export interface RecoverPostScreenProps {
  postId: string;
}

/** The sentinel for "nobody helped" — a real answer, not the absence of one. */
const NO_SPOTTER = '__none__';

export function RecoverPostScreen({ postId }: RecoverPostScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const { status, sightings } = usePostSightings(postId);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The owner-denial attestation step for "I found it another way": recent
  // uncredited sightings must be looked at before the refund can be asked
  // for. `claimed` tracks whether claim_recovery already landed — it is
  // irreversible, so a retry after ATTESTATION_STALE must not claim twice.
  const [attestation, setAttestation] = useState<{
    sightingIds: string[];
    holdHours: number;
  } | null>(null);
  const claimedRef = useRef(false);

  /** The no-spotter ending, shared by the plain path and the attested one. */
  const finishNoSpotter = useCallback(
    async (attestedSightingIds?: string[]) => {
      if (!claimedRef.current) {
        await claimRecovery(postId, null);
        claimedRef.current = true;
      }
      const refund = await refundRecovery(postId, attestedSightingIds);
      if (refund.held) {
        // The claim stands; only the money waits out the dispute window.
        const date = new Date(refund.refundAfter);
        const when = Number.isNaN(date.getTime())
          ? 'the 72-hour window'
          : date.toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
        toast.show(
          `Glad you got it back. Your refund is sent after ${when}, unless a sighting is contested.`,
        );
      } else {
        toast.show(
          `Glad you got it back. ${formatPounds(refund.refundedPence)} is on its way back to you.`,
        );
      }
      router.back();
    },
    [postId, router, toast],
  );

  const submit = useCallback(async () => {
    if (submitting || selected === null) {
      return;
    }
    setSubmitting(true);
    try {
      const sightingId = selected === NO_SPOTTER ? null : selected;

      if (sightingId === null) {
        // Pre-flight BEFORE the irreversible claim: recent uncredited
        // sightings mean the attestation step comes first. A failed
        // pre-flight proceeds — the server gate re-checks and answers
        // ATTESTATION_REQUIRED if it must.
        try {
          const check = await exitCheck(postId);
          if (check.requiresAttestation) {
            setAttestation({ sightingIds: check.sightingIds, holdHours: check.holdHours });
            return;
          }
        } catch {
          // fall through to the claim; the server still enforces
        }
        await finishNoSpotter();
        return;
      }

      const claim = await claimRecovery(postId, sightingId);

      if (claim.nextStep === 'refund') {
        // Defensive: a credited claim answers 'payout'. If the server says
        // refund anyway, honour it through the shared ending.
        claimedRef.current = true;
        await finishNoSpotter();
        return;
      }

      // THE CLAIM HAS LANDED. Everything below is about the money, and nothing
      // below can undo it — `claim_recovery` accepts `active` and the post is
      // no longer active. So every branch here, including the failures, has to
      // read as "they are credited, here is where the bounty is" and never as
      // "that didn't work".

      // The earn moment: tell the spotter NOW, whatever the payout below does
      // — held_for_review, awaiting_payee and paid are all states in which
      // they genuinely earned it. Fire-and-forget; the claim RPC behind it
      // re-verifies this caller owns the post and sends once, ever.
      notifyCredited(postId);
      try {
        const payout = await releasePayout(postId);
        toast.show(
          payout.status === 'paid' && payout.transferPence !== null
            ? `Sent. ${formatPounds(payout.transferPence)} is on its way to them.`
            : payout.status === 'held_for_review'
              ? // Calm, unspecific, and NOT the bank-details line — telling an
                // owner to chase the spotter about a delay that is ours would
                // be blame pointed at the wrong person. Which signal fired is
                // never surfaced anywhere.
                'They’re credited. We’re just double-checking this payout — no need to do anything.'
              : // The usual first time: a spotter has no Stripe account until a
                // sighting of theirs is credited, which is this moment.
                //
                // "Automatically" became TRUE on 2026-08-04: the webhook (and
                // the account-creation path) release the moment the payee is
                // payable, through the same gated core as the manual retry.
                'They’re credited. We’ll send the bounty automatically once they’ve added their bank details.',
        );
      } catch (payoutError) {
        // The credit stands; only the transfer is outstanding, and it can be
        // retried from the listing. Surfaced calmly, not as an error toast.
        toast.show(
          payoutError instanceof RecoveryError
            ? payoutError.message
            : 'They’re credited. You can send the bounty from your listing.',
        );
      }
      router.back();
    } catch (error) {
      toast.show(
        error instanceof RecoveryError ? error.message : 'Something went wrong. Please try again.',
        'error',
      );
    } finally {
      setSubmitting(false);
    }
  }, [finishNoSpotter, postId, router, selected, submitting, toast]);

  /** The attested no-spotter ending — the attestation screen's confirm. */
  const submitAttested = useCallback(
    async (attestedSightingIds: string[]) => {
      if (submitting) {
        return;
      }
      setSubmitting(true);
      try {
        await finishNoSpotter(attestedSightingIds);
      } catch (error) {
        if (error instanceof RecoveryError && error.code === 'ATTESTATION_STALE') {
          // A sighting landed mid-confirm. Refresh the set and ask again —
          // the claim (if it already landed) stands, and only the refund
          // waits on a fresh attestation.
          toast.show(error.message, 'error');
          try {
            const check = await exitCheck(postId);
            if (check.requiresAttestation) {
              setAttestation({ sightingIds: check.sightingIds, holdHours: check.holdHours });
              return;
            }
            await finishNoSpotter();
            return;
          } catch {
            // fall through to the generic toast below
          }
        }
        toast.show(
          error instanceof RecoveryError ? error.message : 'Something went wrong. Please try again.',
          'error',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [finishNoSpotter, postId, submitting, toast],
  );

  if (attestation) {
    return (
      <Screen scroll contentContainerStyle={styles.scroll}>
        <ExitAttestation
          postId={postId}
          sightingIds={attestation.sightingIds}
          holdHours={attestation.holdHours}
          busy={submitting}
          onConfirm={(ids) => void submitAttested(ids)}
          // "One of these did help" — back to the list, where crediting one
          // is exactly what this screen already does best.
          onCredit={() => {
            setAttestation(null);
            setSelected(null);
          }}
          onCancel={() => setAttestation(null)}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
          testID="recover-back"
        >
          <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          You got it back
        </Text>
      </View>

      <Text style={styles.lede}>
        That’s the best news. Did one of these sightings lead you to it?
      </Text>

      {status === 'loading' ? (
        <Text style={styles.body}>Loading your sightings…</Text>
      ) : null}

      {status === 'error' ? (
        // Not a dead end: they can still close the listing without crediting.
        <Text style={styles.body}>
          We couldn’t load the sightings. You can still say you found it another way.
        </Text>
      ) : null}

      <View style={styles.options} accessibilityRole="radiogroup">
        {sightings.map((sighting) => {
          const isSelected = selected === sighting.id;
          const when = new Date(sighting.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          });
          const where = sighting.areaLabel ?? 'Location not shared';
          return (
            <Pressable
              key={sighting.id}
              onPress={() => setSelected(sighting.id)}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              accessibilityLabel={`Sighting on ${when}, ${where}`}
              style={[styles.option, isSelected && styles.optionSelected]}
              testID={`credit-${sighting.id}`}
            >
              <Text style={styles.optionTitle}>
                {when} · {where}
              </Text>
              {sighting.note ? (
                <Text style={styles.optionNote} numberOfLines={2}>
                  {sighting.note}
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {/* A peer of the sightings above, never a "skip". Most stolen cars are
            found by the police or by the owner, and that ending is normal. */}
        <Pressable
          onPress={() => setSelected(NO_SPOTTER)}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === NO_SPOTTER }}
          accessibilityLabel="I found it another way"
          style={[styles.option, selected === NO_SPOTTER && styles.optionSelected]}
          testID="credit-none"
        >
          <Text style={styles.optionTitle}>I found it another way</Text>
          <Text style={styles.optionNote}>
            The police, or you. Your bounty comes back to you, minus the card fee.
          </Text>
        </Pressable>
      </View>

      {status === 'ready' && sightings.length === 0 ? (
        <EmptyState
          title="No sightings were reported"
          body="That’s fine — plenty of cars turn up without one."
        />
      ) : null}

      {/* Deliberately explicit about what confirming DOES. This spends money
          one way or the other, and it cannot be undone. */}
      <Text style={styles.caption}>
        {selected === NO_SPOTTER
          ? 'We’ll close the listing and refund your bounty.'
          : selected
            ? 'We’ll close the listing and send your bounty to that spotter. Only one sighting can be credited.'
            : 'Choose one to continue.'}
      </Text>

      <Button
        label={submitting ? 'Just a moment…' : 'Confirm'}
        onPress={() => void submit()}
        disabled={selected === null || submitting}
      />
    </Screen>
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
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
  options: {
    gap: spacing.sm,
  },
  option: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: c.border,
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  optionSelected: {
    borderColor: c.primary,
    backgroundColor: c.surfaceSubtle,
  },
  optionTitle: {
    ...typography.label,
    color: c.textPrimary,
  },
  optionNote: {
    ...typography.caption,
    color: c.textSecondary,
  },
  caption: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
