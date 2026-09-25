/**
 * WHAT:  PostOwnerActions — everything an owner can DO to their listing, in one
 *        mountable piece: the "Manage your listing" sheet, the deactivate /
 *        delete-draft / delete-listing confirms, the owner-denial attestation,
 *        the per-section editors, and send-the-reward. Headless apart from
 *        those overlays; the host drives it through a ref.
 * WHY:   Two surfaces raise the same sheet — the listing page ("Manage
 *        listing", the section pencils, the body's deactivate button) and a
 *        long-press on My listings (owner's call, 2026-09-24: "just a bottom
 *        sheet … not to be brought to the listing page"). Extracting it, rather
 *        than copying rows into My listings, keeps every money path — the
 *        refund pre-flight and attestation, the held-refund copy, the delete
 *        guards — the ONE tested implementation. The logic below moved here
 *        verbatim from PostDetailScreen; only its inputs changed: the host
 *        passes the post, how to refresh it, and what to do after a delete.
 *        An optional `archive` prop adds the Archive / Unarchive row; only My
 *        listings passes it (it owns the list the card moves within).
 *
 *        ⚠️ MOUNT IT AT THE HOST'S ROOT. The attestation and the editors are
 *        absolute, opaque overlays sized to this component's parent — inside a
 *        padded or scrolling child they would cover only part of the screen.
 * LINKS: src/features/vehicles/lib/ownerPermissions.ts (what shows);
 *        src/features/vehicles/components/PostManageSheet.tsx (the sheet);
 *        src/features/vehicles/screens/PostDetailScreen.tsx +
 *        src/features/vehicles/screens/MyPostsScreen.tsx (the two hosts).
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { exitCheck, useDeactivatePost } from '@/features/payments';
import { bountyParam, chargeBreakdown, estimateRefundPence, formatPounds } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import { spacing, useThemedStyles, type Palette } from '@/shared/theme';
import {
  ConfirmDialog,
  useToast,
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';

// The delete apis are imported STATICALLY (they were lazy `await import()`s on
// the listing page). This file already imports the payout and refund apis
// statically, so laziness bought nothing — and this jest config runs without
// --experimental-vm-modules, where a dynamic import() cannot be mocked, which
// left both deletes untested until they moved here.
import { deleteCancelledPost } from '../api/deletePostApi';
import { deleteDraft } from '../api/draftApi';
import { RecoveryError, releasePayout } from '../api/recoveryApi';
import { usePostMoney } from '../hooks/usePostMoney';
import type { PostMoney } from '../lib/postMoney';
import { buildSharePayload } from '../lib/postShare';
import {
  canDeactivate,
  canDeleteDraft,
  canDeletePost,
  canEditDraftSection,
  canEditSafeSection,
  canReleasePayout,
} from '../lib/ownerPermissions';
import type { PostDetail } from '../types';
import { PostSectionEditorHost, type EditableSection } from './editors';
import { ExitAttestation } from './ExitAttestation';
import { PostManageSheet } from './PostManageSheet';

const log = createLogger('vehicles');

export interface PostOwnerActionsHandle {
  /** Raise the "Manage your listing" sheet. */
  openManage: () => void;
  /** The deactivate entry: pre-flight, then the attestation or the confirm. */
  requestDeactivate: () => void;
  /** Open one section's editor (the listing page's pencils). */
  edit: (section: EditableSection) => void;
  /** True while an action is in flight or a flow is open (a request, the
   *  attestation, an editor). A host that could replace this instance — My
   *  listings, on a long-press of another card — must not while it is busy,
   *  or the double-tap guards and the post-cancel delete offer go with it. */
  isBusy: () => boolean;
}

export interface PostOwnerActionsProps {
  ref?: Ref<PostOwnerActionsHandle>;
  postId: string;
  /** The loaded listing, or null while it loads. Renders nothing unless the
   *  viewer is its owner. */
  post: PostDetail | null;
  /** Re-fetch after something changed (an edit, a deactivation, a payout). */
  refresh: () => void;
  /** After a delete succeeded — there is no post left to refresh. */
  onDeleted: () => void;
  /**
   * The archive row, when this host has an Archived section (My listings).
   * The host decides whether the listing may be archived (canArchive) and
   * performs the toggle; absent = no row. `archived` picks which of the two.
   */
  archive?: { archived: boolean; toggle: () => void };
  /**
   * The listing's money (get_post_money), when the host already reads it —
   * the listing screen does, for its "Your money" card. Omitted, this reads it
   * itself (My listings' sheet). It decides whether "Send the reward" is a
   * real action and gives the refund estimate the real charge.
   */
  money?: PostMoney | null;
}

export function PostOwnerActions({
  ref,
  postId,
  post,
  refresh,
  onDeleted,
  archive,
  money: moneyFromHost,
}: PostOwnerActionsProps) {
  // Only when the host did not bring it — one read per screen, never two.
  const ownRead = usePostMoney(
    postId,
    Boolean(post?.isOwner) && moneyFromHost === undefined,
    post?.status,
  );
  const money = moneyFromHost !== undefined ? moneyFromHost : ownRead.money;
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  // The sheet and the ONE deactivate confirm — both the sheet's row and the
  // listing body's button open the latter, so the destructive copy and the
  // refund estimate exist in a single place.
  const manageRef = useRef<BottomSheetRef>(null);
  const deactivateRef = useRef<ConfirmDialogRef>(null);
  const deleteDraftRef = useRef<ConfirmDialogRef>(null);
  const deletePostRef = useRef<ConfirmDialogRef>(null);
  // Guards a double-tap while the delete is in flight. The Edge Function cancels
  // Stripe intents before deleting, so a second run mid-flight would race the
  // first over rows it is already removing.
  const [deleting, setDeleting] = useState(false);
  // Raised by a CLEAN deactivation, consumed by the effect below: the delete
  // offer can only open once the refetch shows the post as `cancelled`,
  // because that is when its ConfirmDialog mounts. A ref + effect rather than
  // a direct open() so the offer survives however long the refetch takes — a
  // ref, not state, because consuming it must not itself schedule a render
  // (react-hooks/set-state-in-effect).
  const offerDeleteRef = useRef(false);
  // Which section the owner is editing (a full-screen overlay), or null.
  const [editing, setEditing] = useState<EditableSection | null>(null);
  // Guards a double-tap on "Send the reward". The transfer itself is idempotent
  // server-side, so this is about not firing two requests, not about safety.
  const [releasing, setReleasing] = useState(false);
  // The owner-denial attestation (DOMAIN.md Disputes): when the server says
  // recent uncredited sightings exist, deactivation detours through a look at
  // exactly those sightings before any refund can be held.
  const [attestation, setAttestation] = useState<{
    sightingIds: string[];
    holdHours: number;
  } | null>(null);

  const owned = post?.isOwner === true ? post : null;

  // The post-cancel delete offer ("If a user cancels a post they should have
  // an option that comes up to delete it"). Fires once, only after the
  // deactivation's refetch has landed — that render is what mounts the delete
  // confirm, so the ref is live by the time this effect runs.
  useEffect(() => {
    if (offerDeleteRef.current && owned && canDeletePost(owned)) {
      offerDeleteRef.current = false;
      deletePostRef.current?.open();
    }
  }, [owned]);

  // Deactivate + refund (owner, paid posts). The hook wraps the Edge Function.
  const { deactivate, pending: deactivating } = useDeactivatePost();

  // What the deactivate toast says. The server returns the EXACT refunded
  // amount, and for a no-reward listing that amount is 0 — its fixed fee is not
  // refundable (ADR-0014). "£0 refunded" would read as a failed refund rather
  // than as a listing that never had one, so the zero case gets its own sentence
  // instead of being formatted like money that moved.
  const deactivatedToast = (refundedPence: number) =>
    refundedPence > 0
      ? `Listing deactivated — ${formatPounds(refundedPence)} refunded`
      : 'Listing deactivated';

  // Deactivate + refund. The confirm already fired; this issues the server
  // refund, toasts the EXACT refunded amount, and refreshes so the post now
  // reads "Cancelled" and drops off public surfaces.
  const onDeactivate = useCallback(async () => {
    if (deactivating) {
      return; // guard a double-tap while the refund is in flight
    }
    const result = await deactivate(postId);
    if (result.outcome === 'done') {
      toast.show(deactivatedToast(result.result.refundedPence));
      refresh();
      // A clean cancel is the one moment the delete offer is asked for
      // unprompted (the effect above opens it once the refetch shows
      // `cancelled`). NOT on 'held': that refund is still in flight, and the
      // server would refuse the delete anyway.
      offerDeleteRef.current = true;
    } else if (result.outcome === 'held') {
      // Reachable only if sightings appeared between the pre-flight and now.
      toast.show(heldToast(result.refundAfter));
      refresh();
    } else {
      toast.show(result.message, 'error');
    }
  }, [deactivate, deactivating, postId, refresh, toast]);

  // Delete an unpaid draft, for good. The confirm has already fired. Hands
  // back to the host on success rather than refreshing: there is no post left.
  const onDeleteDraft = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteDraft(postId);
      toast.show('Draft deleted');
      onDeleted();
    } catch (error) {
      // The api maps every server code to copy a person can act on — including
      // the two that must NOT say "try again": money that moved, and a payment
      // still settling.
      toast.show(
        error instanceof Error && error.message
          ? error.message
          : 'We couldn’t delete that draft. Please try again.',
        'error',
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, onDeleted, postId, toast]);

  // Delete a cancelled post, for good. The confirm has already fired — either
  // the offer that follows a clean cancel, or the sheet's row on a post
  // cancelled some other day. Hands back to the host for the same reason.
  const onDeletePost = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteCancelledPost(postId);
      toast.show('Listing deleted');
      onDeleted();
    } catch (error) {
      // The api maps every server code to copy a person can act on — including
      // the three that must NOT say "try again": a refund still settling, a
      // dispute in review, and a payout review.
      toast.show(
        error instanceof Error && error.message
          ? error.message
          : 'We couldn’t delete that post. Please try again.',
        'error',
      );
    } finally {
      setDeleting(false);
    }
  }, [deleting, onDeleted, postId, toast]);

  // The attested exit: same call, carrying exactly what the owner was shown.
  const onAttestedDeactivate = useCallback(
    async (attestedSightingIds: string[]) => {
      if (deactivating) {
        return;
      }
      const result = await deactivate(postId, attestedSightingIds);
      if (result.outcome === 'held') {
        setAttestation(null);
        toast.show(heldToast(result.refundAfter));
        refresh();
      } else if (result.outcome === 'done') {
        // The trigger set emptied server-side (sightings aged out) — the
        // refund simply went through. A clean cancel, so the delete offer
        // applies here exactly as in onDeactivate.
        setAttestation(null);
        toast.show(deactivatedToast(result.result.refundedPence));
        refresh();
        offerDeleteRef.current = true;
      } else if (result.code === 'ATTESTATION_STALE') {
        // A sighting landed mid-confirm. Refresh the set and ask again.
        toast.show(result.message, 'error');
        try {
          const check = await exitCheck(postId);
          setAttestation(
            check.requiresAttestation
              ? { sightingIds: check.sightingIds, holdHours: check.holdHours }
              : null,
          );
        } catch (err) {
          // ⚠️ SILENT UNTIL 2026-09-02, and this is the branch that DROPS an
          // attestation requirement. The server re-checks on the next attempt,
          // so nothing is bypassed — but the owner is handed a clean sheet
          // after being told to attest, and until then no trace of that existed
          // anywhere. Matches the pre-flight's log below.
          log.warn('exit_check refresh failed, attestation cleared', {
            postId,
            code: err instanceof Error ? err.message : 'UNKNOWN',
          });
          setAttestation(null);
        }
      } else {
        toast.show(result.message, 'error');
      }
    },
    [deactivate, deactivating, postId, refresh, toast],
  );

  // Every deactivate entry point (the listing body's button, the sheet's row)
  // lands here. The pre-flight decides which door: recent sightings → the
  // attestation; none → the plain destructive confirm. A failed pre-flight
  // opens the plain confirm — enforcement is the SERVER's (the gate
  // re-checks), so degrading here costs honesty nothing.
  const requestDeactivate = useCallback(() => {
    void (async () => {
      // SKIPPED on a no-reward listing (ADR-0014): `exit_check` is purely
      // sighting-based and knows nothing about pricing, so it would open
      // ExitAttestation — "one thing before your refund", "your refund is sent
      // after N hours" — for a listing that has no refund and gets no hold.
      // deactivate-post already returns before the owner-denial gate for these,
      // so the sheet only ever asked a victim to attest under a false premise.
      if (owned?.bountyPence !== null) {
        try {
          const check = await exitCheck(postId);
          if (check.requiresAttestation) {
            setAttestation({ sightingIds: check.sightingIds, holdHours: check.holdHours });
            return;
          }
        } catch (err) {
          log.warn('exit_check pre-flight failed', {
            code: err instanceof Error ? err.message : 'UNKNOWN',
          });
        }
      }
      deactivateRef.current?.open();
    })();
  }, [postId, owned]);

  // Retrying a payout. Idempotent server-side (one transfer per post, forever),
  // so this needs no confirm — and `awaiting_payee` is reported as news rather
  // than as a failure, because it is: the spotter simply has not onboarded yet.
  const onReleasePayout = useCallback(async () => {
    if (releasing) {
      return;
    }
    setReleasing(true);
    try {
      const payout = await releasePayout(postId);
      if (payout.status === 'paid' && payout.transferPence !== null) {
        toast.show(`Sent. ${formatPounds(payout.transferPence)} is on its way to them.`);
        refresh(); // the post is `recovered` now — reload so the host agrees
      } else if (payout.status === 'held_for_review') {
        // Ours, not theirs: never the bank-details line here, or the owner
        // chases the spotter about a delay we caused on purpose.
        toast.show('We’re just double-checking this payout — no need to do anything.');
      } else {
        toast.show(
          'Not yet — they still need to add their bank details. It’ll send automatically when they do.',
        );
      }
    } catch (error) {
      toast.show(
        error instanceof RecoveryError ? error.message : 'We couldn’t send it. Please try again.',
        'error',
      );
    } finally {
      setReleasing(false);
    }
  }, [postId, refresh, releasing, toast]);

  const onShare = useCallback((target: PostDetail) => {
    // ⚠️ SPREAD, don't pass `url` as undefined. There is no website yet, so
    // buildSharePayload omits the key entirely; handing iOS `{ url: undefined }`
    // is not the same as handing it `{ message }`.
    const payload = buildSharePayload(target);
    // Share sheet cancel / no target rejects — nothing to recover from.
    void Share.share({ ...payload }).catch(() => {});
  }, []);

  const toRecovery = useCallback(() => {
    // Carries the pricing mode: the recovery screen's copy promises a refund
    // and a bounty payout, both false on a no-reward listing (ADR-0014).
    router.push({
      pathname: '/recover-post',
      params: owned ? { postId, bounty: bountyParam(owned.bountyPence) } : { postId },
    });
  }, [owned, postId, router]);

  const busy =
    deactivating || deleting || releasing || attestation !== null || editing !== null;
  useImperativeHandle(
    ref,
    () => ({
      openManage: () => manageRef.current?.open(),
      requestDeactivate,
      edit: (section: EditableSection) => setEditing(section),
      isBusy: () => busy,
    }),
    [requestDeactivate, busy],
  );

  if (!owned) {
    return null;
  }

  const editor = (allowed: boolean, section: EditableSection) =>
    allowed ? () => setEditing(section) : undefined;

  return (
    <>
      {/* The owner's sheet — every action for THIS listing in one place. Each
          row is passed only when allowed, so the sheet can never offer
          something the server would reject. */}
      <PostManageSheet
        ref={manageRef}
        sightingCount={owned.sightingCount}
        onViewSightings={() =>
          router.push({ pathname: '/post-sightings', params: { postId } })
        }
        onViewStats={() => router.push({ pathname: '/post-stats', params: { postId } })}
        onShare={() => onShare(owned)}
        onEditCarDetails={editor(canEditSafeSection(owned), 'car_details')}
        onEditPhotos={editor(canEditDraftSection(owned), 'photos')}
        onEditLastSeen={editor(canEditDraftSection(owned), 'last_seen')}
        onEditBounty={editor(canEditDraftSection(owned), 'bounty')}
        onEditDescription={editor(canEditSafeSection(owned), 'description')}
        onEditTheftContext={editor(canEditSafeSection(owned), 'theft_context')}
        onEditDistinctiveFeatures={editor(canEditSafeSection(owned), 'distinctive_features')}
        onDeactivate={canDeactivate(owned) ? requestDeactivate : undefined}
        onDeleteDraft={canDeleteDraft(owned) ? () => deleteDraftRef.current?.open() : undefined}
        onDeletePost={canDeletePost(owned) ? () => deletePostRef.current?.open() : undefined}
        onReleasePayout={canReleasePayout(owned, money) ? () => void onReleasePayout() : undefined}
        onArchive={archive && !archive.archived ? archive.toggle : undefined}
        onUnarchive={archive?.archived ? archive.toggle : undefined}
      />

      {/* The ONE deactivate confirm. The refund figure is an estimate; the
          exact amount is confirmed in the toast after the server refunds. */}
      {canDeactivate(owned) ? (
        <ConfirmDialog
          ref={deactivateRef}
          title="Deactivate this listing?"
          body={
            owned.bountyPence === null
              ? // No bounty means no refund, and the listing fee is not
                // refundable (ADR-0014). The destructive confirm must not
                // promise money back that is not coming.
                'We’ll take it down. Your listing fee isn’t refunded. This can’t be undone.'
              : // ADR-0020: the refund is the whole charge (reward + service
                // fee) minus the card fee. The listing's real charge when its
                // money has loaded; the fee-on-top price of its reward before.
                `We’ll take it down and refund about ${formatPounds(
                  estimateRefundPence(
                    money?.chargedPence ?? chargeBreakdown(owned.bountyPence).chargePence,
                  ),
                )} to your card — what you paid, minus the non-recoverable card fee. This can’t be undone.`
          }
          confirmLabel="Yes, deactivate"
          destructive
          onConfirm={onDeactivate}
        />
      ) : null}

      {/* The draft delete. Blunt on purpose — no tombstone, no undo — which it
          can be because a draft has been seen by nobody but its owner. It does
          NOT mention payment: if money HAS moved, the server refuses and the
          error explains it, which is the right moment for that sentence. */}
      {canDeleteDraft(owned) ? (
        <ConfirmDialog
          ref={deleteDraftRef}
          title="Delete this draft?"
          body="This deletes it for good. Nobody has seen it and nothing has been charged. This can’t be undone."
          confirmLabel="Yes, delete"
          destructive
          onConfirm={onDeleteDraft}
        />
      ) : null}

      {/* The ONE cancelled-post delete confirm — opened by the offer after a
          clean deactivation AND by the sheet's row. "Keep it" because both
          answers are fine; the body names the 30-day cleanup honestly. */}
      {canDeletePost(owned) ? (
        <ConfirmDialog
          ref={deletePostRef}
          title="Delete this listing?"
          body="This deletes the listing and its sighting history for good. If you keep it, it stays in My listings and is deleted automatically after 30 days. This can’t be undone."
          confirmLabel="Yes, delete"
          cancelLabel="Keep it"
          destructive
          onConfirm={onDeletePost}
        />
      ) : null}

      {/* Per-section edit overlay — full-screen over the host; on save it
          refreshes so the change shows. */}
      {editing ? (
        <PostSectionEditorHost
          section={editing}
          post={owned}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {/* The owner-denial attestation — full-screen and OPAQUE (the transparent
          Modal bleed-through lesson), over everything when the exit pre-flight
          found recent sightings. */}
      {attestation ? (
        <View style={[styles.attestationOverlay, { paddingTop: insets.top + spacing.lg }]}>
          <ExitAttestation
            postId={postId}
            sightingIds={attestation.sightingIds}
            holdHours={attestation.holdHours}
            busy={deactivating}
            onConfirm={(ids) => void onAttestedDeactivate(ids)}
            onCredit={() => {
              setAttestation(null);
              // Crediting IS the recovery flow — it already knows how to ask
              // which sighting and to move the money the right way.
              toRecovery();
            }}
            onCancel={() => setAttestation(null)}
          />
        </View>
      ) : null}
    </>
  );
}

/** The one sentence for a held refund, with the real date in it. */
function heldToast(refundAfter: string): string {
  const date = new Date(refundAfter);
  const when = Number.isNaN(date.getTime())
    ? 'the 72-hour window'
    : date.toLocaleString('en-GB', { weekday: 'long', hour: 'numeric', minute: '2-digit' });
  return `Listing deactivated. Your refund is sent after ${when}, unless a sighting is contested.`;
}

const makeStyles = (c: Palette) => StyleSheet.create({
  attestationOverlay: {
    // Explicit insets, not absoluteFillObject (typecheck) — and an OPAQUE
    // background: money copy must never render over half-visible content.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.background,
    padding: spacing.xl,
  },
});
