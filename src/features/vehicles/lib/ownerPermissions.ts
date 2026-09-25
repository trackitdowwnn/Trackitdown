/**
 * WHAT:  What an owner may do to their own listing, by status — the rules that
 *        decide which pencils, sheet rows and buttons appear.
 * WHY:   Two surfaces now offer these actions: the listing page and the Manage
 *        sheet raised by a long-press on My listings (PostOwnerActions). One
 *        copy of the rules means the two can never disagree about what is
 *        allowed. They decide VISIBILITY only — the server enforces every one.
 *        (Moved verbatim from PostDetailScreen, 2026-09-24.)
 * LINKS: src/features/vehicles/components/PostOwnerActions.tsx;
 *        src/features/vehicles/screens/PostDetailScreen.tsx.
 */

import type { PostStatus } from '@/shared/types';

import type { PostDetail } from '../types';
import { canSendReward, type PostMoney } from './postMoney';

/** Photos, last-seen and the bounty are editable ONLY while the post is a draft:
 *  imagery and where the car was taken from must not move once the crowd is
 *  matching against them, and the bounty is frozen by escrow. The server enforces
 *  this too. */
export function canEditDraftSection(post: PostDetail): boolean {
  return post.isOwner && post.status === 'draft';
}

/** The money-neutral sections — car details, theft context, distinctive features,
 *  description — stay editable once the post is LIVE. A wrong colour or model
 *  actively harms the search, and the details worth adding ("cracked nearside
 *  mirror", "keys were taken") are exactly what an owner remembers after people
 *  start looking; the alternative was deactivate + refund + repost, which costs
 *  the hours that matter most. Mirrors the four RPCs' status array
 *  (20260731100000_edit_safe_sections_when_live.sql,
 *  20260731110000_edit_car_details_when_live.sql); `pending_verification` is kept
 *  for posts predating live-on-payment. The PLATE is not editable by any of them.
 *  Server-enforced — this only decides whether the pencil shows. */
export function canEditSafeSection(post: PostDetail): boolean {
  return (
    post.isOwner &&
    (post.status === 'draft' ||
      post.status === 'pending_verification' ||
      post.status === 'active')
  );
}

/** The owner can deactivate + refund any PAID post — one whose bounty is held in
 *  escrow (active or pending_verification). A draft has nothing to refund. The
 *  server re-enforces this; the button is only convenience. */
export function canDeactivate(post: PostDetail): boolean {
  return post.isOwner && (post.status === 'active' || post.status === 'pending_verification');
}

/**
 * The owner can DELETE an unpaid draft. A draft has no escrow to refund, so
 * its delete removes the ledger rows outright; a paid post keeps its money
 * record forever (see canDeletePost below — its delete detaches the ledger
 * rather than deleting it).
 *
 * Deliberately not `!canDeactivate(post)`: the statuses that are neither
 * (recovered, expired…) must offer nothing at all, and writing it as a
 * negation would quietly hand them a delete the server would refuse.
 */
export function canDeleteDraft(post: PostDetail): boolean {
  return post.isOwner && post.status === 'draft';
}

/**
 * The owner can DELETE a cancelled post — the third mutually-exclusive
 * destructive action. "A paid listing can never be deleted" softened on
 * 2026-09-21 to "a paid listing's LEDGER can never be deleted": the server
 * detaches the money record and removes the post, and refuses while a refund
 * or dispute is still settling. A cancelled post left alone is deleted
 * automatically 30 days after it closed, so this button is "now", not "ever".
 * Server-enforced (delete_cancelled_post); this only decides what shows.
 */
export function canDeletePost(post: PostDetail): boolean {
  return post.isOwner && post.status === 'cancelled';
}

/** The owner can mark an ACTIVE post recovered. Narrower than canDeactivate on
 *  purpose: `claim_recovery` accepts `active` and nothing else, so offering
 *  this on a pending_verification post would show a button that always fails. */
export function canMarkRecovered(post: PostDetail): boolean {
  return post.isOwner && post.status === 'active';
}

/** The closed statuses — the only ones an owner may archive (owner's call,
 *  2026-09-24). Mirrors set_post_archived's NOT_CLOSED check
 *  (20260924130000_archive_listings.sql). */
const ARCHIVABLE: readonly PostStatus[] = ['recovered', 'recovered_no_spotter', 'cancelled', 'expired'];

/**
 * The owner can ARCHIVE a finished listing — tuck it into the collapsed
 * "Archived" section of My listings. Never a live one: an owner must not lose
 * sight of a car that is still being searched for, so anything still open
 * (live, draft, awaiting payout…) stays in the main list. Takes just the status
 * so My listings can decide from a card, without loading the full listing.
 */
export function canArchive(status: PostStatus): boolean {
  return ARCHIVABLE.includes(status);
}

/** A credited spotter is waiting to be paid. `recovery_claimed` means the winner
 *  is chosen and the reward is still in escrow — usually because they have not
 *  given Stripe their details yet, which is the expected first answer, not a
 *  fault. Before this row existed the owner had NO action on such a listing:
 *  every other one requires `active`, so crediting someone made the app go
 *  silent on the post it cared most about.
 *
 *  ⚠️ STATUS ALONE IS NOT ENOUGH (fixed 2026-09-25). A "found it another way"
 *  recovery whose refund is HELD also sits in `recovery_claimed` — with nobody
 *  credited — and this used to offer it "Send the reward", which then failed
 *  with "No spotter is credited on this listing". The listing's MONEY must say
 *  a spotter is owed it (awaiting_payee / sending); unknown money shows no row. */
export function canReleasePayout(
  post: PostDetail,
  money: PostMoney | null,
  moneyReadFailed = false,
): boolean {
  if (!post.isOwner || post.status !== 'recovery_claimed') {
    return false;
  }
  // The money read FAILED: offer the row rather than silently taking the
  // owner's only action away. The server refuses it with a clear message if
  // nobody is actually credited, so the degraded case costs one tap, not money.
  return canSendReward(money) || (money === null && moneyReadFailed);
}
