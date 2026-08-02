/**
 * WHAT:  Edge Function that erases the calling user's account. Proves identity
 *        from the JWT, RE-CHECKS server-side that they hold no post with money
 *        in escrow, removes every storage object they own, records the erasure
 *        (with the Stripe Connect link, which is about to cascade away), then
 *        deletes the auth.users row — which cascades profiles, posts, sightings,
 *        watches, alerts and push tokens.
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

import { createServiceRoleClient } from '../_shared/clients.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/http.ts';

/**
 * Post statuses that BLOCK erasure: money is in escrow or a payout is pending.
 * Must stay in step with DELETION_BLOCKING_STATUSES in profileApi.ts — that
 * copy is advisory (it drives a friendlier dialog); THIS one is the enforcement.
 * The payments table's ON DELETE RESTRICT on post_id is the last-resort backstop
 * beneath both.
 */
const BLOCKING_STATUSES = ['active', 'pending_verification', 'recovery_claimed'];

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
] as const;

/*
 * SIGHTING PHOTOS — deliberately NOT swept. This is a product/legal decision,
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

  // --- Re-check the escrow block, server-side ---------------------------------
  // The client checks this too, to show a kinder dialog. That check is advisory:
  // it runs under RLS on a stale read and can be skipped entirely by calling
  // this function directly. This is the enforcement.
  const { count: blockingCount, error: blockingError } = await admin
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .in('status', BLOCKING_STATUSES);

  if (blockingError) {
    console.error('[profile] blocking-post check failed', blockingError.message);
    return errorResponse(
      'LOOKUP_FAILED',
      'We couldn’t delete your account. Please try again.',
      500,
    );
  }
  if ((blockingCount ?? 0) > 0) {
    return errorResponse(
      'ACCOUNT_HAS_ESCROW',
      'You have a live listing with a bounty in escrow. Cancel it first, then delete your account.',
      409,
    );
  }

  // --- Capture the Stripe Connect link BEFORE the cascade destroys it ---------
  // Not fatal if it fails: a missing audit row must never trap someone in an
  // account they asked to erase. Erasure is the user's right; the audit row is
  // our record-keeping, and the weaker of the two claims yields.
  let stripeAccountId: string | null = null;
  const { data: connect, error: connectError } = await admin
    .from('stripe_connected_accounts')
    .select('stripe_account_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (connectError) {
    console.error('[profile] connect lookup failed', connectError.message);
  } else if (connect) {
    stripeAccountId = connect.stripe_account_id as string;
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
  const { error: auditError } = await admin.from('account_deletions').insert({
    deleted_user_id: userId,
    stripe_account_id: stripeAccountId,
    storage_objects_removed: removedCount,
  });
  if (auditError) {
    // Non-fatal, deliberately — see the Connect note above.
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

  // ids only, never names or emails (docs/LOGGING.md).
  console.log('[profile] account erased', { userId, removedCount });
  return jsonResponse({ deleted: true, storageObjectsRemoved: removedCount });
});
