/**
 * WHAT:  The delete screen's words for each reason the account can't go yet
 *        (account_deletion_blockers' codes, 20261023120000) — one short line
 *        each, saying what to do.
 * WHY:   A blocked deletion that says only "not yet" leaves someone guessing
 *        what to fix. Kept apart from profileApi's DELETION_MESSAGES on
 *        purpose: those are toasts for a refused REQUEST (one sentence, the
 *        server's single code); these are a LIST read before anything is
 *        pressed, and can count ("2 live listings").
 * LINKS: supabase/migrations/20261023120000_an_account_can_be_deleted.sql
 *        (account_deletion_blockers_for — the codes);
 *        src/features/profile/screens/DeleteAccountScreen.tsx.
 */

import type { DeletionBlocker } from '../api/profileApi';

export function deletionReason({ code, count }: DeletionBlocker): string {
  switch (code) {
    case 'LIVE_LISTING':
      return count > 1
        ? `You have ${count} live listings. Deactivate them first.`
        : 'You have a live listing. Deactivate it first.';
    case 'MONEY_HELD':
      return 'Money from a listing is still being returned to you.';
    case 'REWARD_ON_ITS_WAY':
      return 'A reward is waiting for you. Set up payouts to receive it.';
    case 'DISPUTE_OPEN':
      return 'A dispute is still being decided.';
    case 'REVIEW_OPEN':
      return 'A payment is still being reviewed.';
    default:
      // A code added server-side before the app knows it: still a reason.
      return 'Something on your account is still in progress.';
  }
}
