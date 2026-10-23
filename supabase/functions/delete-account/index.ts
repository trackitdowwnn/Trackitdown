/**
 * WHAT:  Edge Function that erases the calling user's account. Proves identity
 *        from the JWT, then (2026-10-23, 20261023120000):
 *          1. the reasons it can't go yet — account_deletion_blockers_for, the
 *             same list the app's delete screen shows — and money still on
 *             their payout account (PAYOUT_ON_ITS_WAY): each a 409 with its
 *             own code, never "try again";
 *          2. stray unpaid intents cancelled at Stripe, as proof for…
 *          3. delete_account_data: their listings through the afterlife (money
 *             records KEPT, detached), payments to them detached, settled
 *             reviews/disputes on others' listings anonymised — so the RESTRICT
 *             FKs that used to fail this for anyone with money history no
 *             longer can;
 *        then removes every storage object they own, records the erasure,
 *        deletes the auth.users row (cascading the rest), and closes their
 *        payout account at Stripe (best effort, recorded in the audit row).
 * WHY:   Apple and Google both require an in-app deletion path, and UK GDPR
 *        Art. 17 requires erasure on request. The client has had the whole
 *        flow — blocking-post pre-check, confirm dialog, the lot — since
 *        2026-07-10, calling a function that was never written; it failed with
 *        "not available in this build yet". SECURITY_AND_TRUST §3 records that
 *        as an open erasure gap. This closes it.
 *
 *        NOTHING here is client-controlled. The body is ignored entirely: the
 *        only input is the caller's own JWT, so this function cannot be aimed
 *        at another user's account no matter what is sent.
 *
 * ORDER IS LOAD-BEARING — storage BEFORE auth.users:
 *        Storage objects do NOT cascade from auth.users (they are rows in the
 *        storage schema keyed by path, not by a FK). If the account were
 *        deleted first and the sweep then failed, the objects would be orphaned
 *        with no owner left to retry for — permanently undeletable personal
 *        data, i.e. exactly the GDPR breach this exists to prevent. Sweeping
 *        first inverts the failure: a sweep that fails aborts before anything
 *        irreversible, and a sweep that succeeds but is followed by a failed
 *        account delete leaves a live account the user can simply delete again
 *        (removing already-removed objects is a no-op). Every step is therefore
 *        safe to retry.
 *
 * SAFETY: the sweep deletes through the STORAGE API, never by deleting rows
 *        from storage.objects. A direct row delete removes the DB record but
 *        leaves the bytes in the backing store — orphaned files that no longer
 *        appear in any listing and so can never be found again. SQL is used
 *        only to FIND the paths.
 * LINKS: supabase/functions/_shared/clients.ts, _shared/http.ts;
 *        supabase/functions/deactivate-post/index.ts (the auth + re-check
 *          pattern this mirrors);
 *        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
 *          (the FUTURE WORK outline this implements);
 *        supabase/migrations/20260802190000_account_deletions_audit.sql;
 *        src/features/profile/api/profileApi.ts (requestAccountDeletion);
 *        docs/SECURITY_AND_TRUST.md §3; docs/DOMAIN.md (lifecycle).
 */

import { createServiceRoleClient, createStripeClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

// What blocks erasure lives in ONE place now: account_deletion_blockers_for
// (20261023120000) — the app's delete screen reads the same definition through
// account_deletion_blockers(), and delete_account_data re-checks it under its
// lock. No status list here to drift from it.

/**
 * Where a user's OWN bytes live. All three are uid-first paths
 * (`<uid>/...`), matching their storage policies' `foldername(name)[1]`.
 *
 * `sighting-photos` is DELIBERATELY ABSENT — see SIGHTING PHOTOS below.
 */
const BUCKETS = [
  { id: 'avatars', uidSegment: 1 },
  { id: 'post-photos', uidSegment: 1 },
  { id: 'verification-documents', uidSegment: 1 },
  // Bug-report screenshots (`<uid>/…`, 20260824140000). Their rows cascade
  // with the account, but the files do not — until 2026-10-21 they outlived
  // it (docs/RECORD_OF_PROCESSING.md §5). The reporter's own, unlike sighting
  // photos below: nobody else's case depends on them.
  { id: 'bug-screenshots', uidSegment: 1 },
] as const;

/*
 * SIGHTING PHOTOS — not swept HERE, but they do NOT survive the account.
 * ⚠️ Updated 2026-10-22: the reasoning below was written 2026-08 and is now
 * history. The spotter's sightings cascade with the account, and since
 * 20260921110000 every deleted sighting_photos row queues its file for the
 * hourly sweep, which removes it through the Storage API — so the photos
 * are erased within the hour. The owner chose to keep that (the privacy
 * policy now says so, and docs/RECORD_OF_PROCESSING.md §5 records it).
 * Keeping evidence on a live listing would mean anonymising the sighting
 * instead of cascading it — a schema change, not an edit to this list.
 *
 * The original reasoning, kept for context:
 * This is a product/legal decision,
 * not an oversight, and it is the one call in this function worth arguing with.
 *
 * A sighting photo is uploaded by the SPOTTER but belongs to somebody else's
 * post: the path is `<postId>/<uid>/...` (hence its policies key on segment
 * [2], not [1]). So a spotter's photos are evidence attached to OTHER people's
 * stolen-car listings — listings that may be live right now. The escrow block
 * above only guarantees the DELETING user has no live post; it says nothing
 * about the victims whose cases they contributed to.
 *
 * Sweeping them would let anyone delete their account and, as a side effect,
 * strip the only photographic evidence from a stranger's active theft case —
 * irreversible harm to a third party who has no say in it.
 *
 * Retaining them is defensible because the erasure still severs the link: the
 * spotter's profile, sighting rows and identity cascade away, leaving an
 * anonymous image. And per ADR-0003 these are camera-only shots of a VEHICLE
 * in a public place — they depict the stolen car, not the spotter. UK GDPR
 * Art. 17(3)(e) (establishment/exercise/defence of legal claims) covers
 * evidence in a live crime report.
 *
 * If that balance is ever judged wrong, adding `{ id: 'sighting-photos',
 * uidSegment: 2 }` to BUCKETS above is the whole change — the sweep already
 * handles segment-2 paths.
 */

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return preflightResponse();
  }
  if (request.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
  }

  // --- Authenticate the caller from the forwarded JWT -------------------------
  // The ONLY input. The request body is never read: an account id taken from
  // the body would be an "erase anyone" endpoint one typo away.
  const authHeader = request.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }

  const admin = createServiceRoleClient();
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) {
    return errorResponse('NOT_AUTHENTICATED', 'You need to be signed in.', 401);
  }
  const userId = userData.user.id;

  // --- The reasons it can't go yet, server-side (20261023120000) -------------
  // The SAME definition the app's delete screen shows. That read is advisory
  // (stale, skippable by calling this directly); this is the enforcement, and
  // delete_account_data re-checks it again under its lock.
  const { data: blockers, error: blockersError } = await admin.rpc(
    'account_deletion_blockers_for',
    { p_user_id: userId },
  );
  if (blockersError) {
    console.error('[profile] blocker check failed', blockersError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete your account. Please try again.', 500);
  }
  const firstBlocker = (blockers as { code: string }[] | null)?.[0]?.code;
  if (firstBlocker) {
    return blocked(firstBlocker);
  }

  // --- The payout account: the Stripe link, and money still on its way -------
  // Captured BEFORE the cascade destroys it. A balance still on the connected
  // account (a payout not yet landed, or funds not yet paid out) blocks the
  // deletion: closing the account would strand it, and money owed is never
  // forfeited silently.
  let stripeAccountId: string | null = null;
  const { data: connect, error: connectError } = await admin
    .from('stripe_connected_accounts')
    .select('stripe_account_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (connectError) {
    console.error('[profile] connect lookup failed', connectError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete your account. Please try again.', 500);
  }
  if (connect) {
    stripeAccountId = connect.stripe_account_id as string;
  }

  const stripe = createStripeClient();
  if (stripeAccountId) {
    try {
      const balance = await stripe.balance.retrieve({}, { stripeAccount: stripeAccountId });
      const owed = [...balance.available, ...balance.pending].reduce(
        (sum, entry) => sum + Math.max(0, entry.amount),
        0,
      );
      if (owed > 0) {
        return blocked('PAYOUT_ON_ITS_WAY');
      }
    } catch (err) {
      // An account Stripe no longer knows has nothing to strand; anything
      // else is "can't tell", and we don't delete on a guess.
      const code = (err as { code?: string }).code;
      if (code !== 'account_invalid' && code !== 'resource_missing') {
        console.error('[profile] payout balance check failed', (err as Error).message);
        return errorResponse('LOOKUP_FAILED', 'We couldn’t delete your account. Please try again.', 500);
      }
    }
  }

  // --- Cancel stray unpaid intents AT STRIPE, recording what we WATCHED die --
  // As delete-post does: only never-captured rows on their listings. The RPC
  // treats this list as evidence; an intent we can't prove dead isn't named,
  // and the deletion refuses (INTENT_NOT_CANCELLED) rather than guess.
  const { data: strays, error: straysError } = await admin
    .from('payments')
    .select('stripe_payment_intent_id, posts!inner(owner_id)')
    .eq('posts.owner_id', userId)
    .in('status', ['requires_payment', 'failed']);
  if (straysError) {
    console.error('[profile] stray-intent read failed', straysError.message);
    return errorResponse('LOOKUP_FAILED', 'We couldn’t delete your account. Please try again.', 500);
  }
  const cancelled: string[] = [];
  for (const row of strays ?? []) {
    const intentId = row.stripe_payment_intent_id as string;
    try {
      const intent = await stripe.paymentIntents.cancel(intentId);
      if (intent.status === 'canceled') cancelled.push(intentId);
    } catch (err) {
      try {
        const current = await stripe.paymentIntents.retrieve(intentId);
        if (current.status === 'canceled') cancelled.push(intentId);
      } catch (retrieveErr) {
        console.warn('[profile] intent state unknown', {
          message: (retrieveErr as Error).message,
          original: (err as Error).message,
        });
      }
    }
  }

  // --- Their data: listings through the afterlife, the person detached -------
  // Money records stay (detached, with snapshots); nothing that identifies the
  // person does. Irreversible — so everything above had to pass first.
  const { error: dataError } = await admin.rpc('delete_account_data', {
    p_user_id: userId,
    p_cancelled_intent_ids: cancelled,
  });
  if (dataError) {
    const message = dataError.message ?? '';
    const blockedCode = /ACCOUNT_BLOCKED:.*"code"\s*:\s*"([A-Z_]+)"/.exec(message)?.[1];
    if (blockedCode) return blocked(blockedCode);
    // A listing's own guard (a race with the check above): the same reasons.
    if (message.includes('LIVE_LISTING')) return blocked('LIVE_LISTING');
    if (message.includes('MONEY_IN_FLIGHT')) return blocked('MONEY_HELD');
    if (message.includes('DISPUTE_OPEN')) return blocked('DISPUTE_OPEN');
    if (message.includes('PAYMENT_REVIEW_OPEN')) return blocked('REVIEW_OPEN');
    if (message.includes('INTENT_NOT_CANCELLED')) {
      console.warn('[profile] deletion refused — an intent could not be proven cancelled', {
        cancelledCount: cancelled.length,
      });
      return errorResponse(
        'INTENT_NOT_CANCELLED',
        'A payment is still being processed. Please try again in a moment.',
        409,
      );
    }
    console.error('[profile] account data deletion failed', message);
    return errorResponse('DELETE_FAILED', 'We couldn’t delete your account. Please try again.', 500);
  }

  // --- Sweep storage (BEFORE the account — see the ORDER note in the header) --
  // Find paths in SQL (service role reads the storage schema directly), then
  // delete them through the Storage API so the bytes go too.
  let removedCount = 0;
  for (const bucket of BUCKETS) {
    // Match on the owner column OR the path convention. Both, because `owner`
    // is null for anything uploaded outside an authenticated client session,
    // and the path is null-proof; either alone would leave objects behind.
    const uidPattern = bucket.uidSegment === 1 ? `${userId}/%` : `%/${userId}/%`;
    const { data: rows, error: listError } = await admin
      .schema('storage')
      .from('objects')
      .select('name')
      .eq('bucket_id', bucket.id)
      .or(`owner.eq.${userId},name.like.${uidPattern}`);

    if (listError) {
      // FAIL CLOSED. Abort before touching auth.users: aborting here is
      // retryable and destroys nothing, whereas proceeding would orphan
      // personal data with no owner left to erase it.
      console.error('[profile] storage listing failed', {
        bucket: bucket.id,
        message: listError.message,
      });
      return errorResponse(
        'STORAGE_SWEEP_FAILED',
        'We couldn’t delete your account. Please try again.',
        500,
      );
    }

    const paths = (rows ?? []).map((row) => row.name as string);
    if (paths.length === 0) {
      continue;
    }

    // Chunked: `remove` takes a bounded list, and a prolific spotter can hold
    // hundreds of sighting photos.
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: removeError } = await admin.storage.from(bucket.id).remove(chunk);
      if (removeError) {
        console.error('[profile] storage remove failed', {
          bucket: bucket.id,
          message: removeError.message,
        });
        return errorResponse(
          'STORAGE_SWEEP_FAILED',
          'We couldn’t delete your account. Please try again.',
          500,
        );
      }
      removedCount += chunk.length;
    }
  }

  // --- Record the erasure -----------------------------------------------------
  // Written BEFORE the delete so the Stripe link is durable even if the delete
  // then fails. A retry inserts a second row; that is the right trade — a
  // duplicate audit row is noise, a missing one is an unreconcilable payout.
  // Non-fatal: a missing audit row must never trap someone in an account they
  // asked to erase.
  const { data: audit, error: auditError } = await admin
    .from('account_deletions')
    .insert({
      deleted_user_id: userId,
      stripe_account_id: stripeAccountId,
      storage_objects_removed: removedCount,
    })
    .select('id')
    .maybeSingle();
  if (auditError) {
    console.error('[profile] audit insert failed', auditError.message);
  }

  // --- Delete the account (cascades the rest) ---------------------------------
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('[profile] auth user delete failed', deleteError.message);
    return errorResponse(
      'DELETE_FAILED',
      'We couldn’t delete your account. Please try again.',
      500,
    );
  }

  // --- Close their payout account at Stripe (best effort) ---------------------
  // The balance was checked as zero above. Not fatal: the account is already
  // gone, and the audit row says whether this happened (RECORD_OF_PROCESSING
  // §4.13) so a failure can be closed by hand.
  if (stripeAccountId) {
    let closed = false;
    try {
      const result = await stripe.accounts.del(stripeAccountId);
      closed = result.deleted === true;
    } catch (err) {
      console.error('[profile] payout account close failed', (err as Error).message);
    }
    if (audit?.id) {
      const { error: closeAuditError } = await admin
        .from('account_deletions')
        .update({ stripe_account_closed: closed })
        .eq('id', audit.id);
      if (closeAuditError) {
        console.error('[profile] audit close update failed', closeAuditError.message);
      }
    }
  }

  // ids only, never names or emails (docs/LOGGING.md).
  console.log('[profile] account erased', { userId, removedCount });
  return jsonResponse({ deleted: true, storageObjectsRemoved: removedCount });
});

/** A reason it can't go yet (account_deletion_blockers_for's codes, plus
 *  PAYOUT_ON_ITS_WAY): 409 with the code the app maps to its own words. */
function blocked(code: string): Response {
  return errorResponse(code, 'You can’t delete your account just yet.', 409);
}
