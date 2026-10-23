/**
 * WHAT:  The delete sheet's words for each reason the account can't go yet
 *        (account_deletion_blockers' codes, 20261023120000): a short row
 *        title and a one-line detail saying what to do.
 * WHY:   A blocked deletion that says only "not yet" leaves someone guessing
 *        what to fix. Split into title + detail (2026-10-23) because the sheet
 *        shows them as ListRows — the app's row language — whose title is one
 *        line; a whole sentence there would be cut off. Kept apart from
 *        profileApi's DELETION_MESSAGES on purpose: those are toasts for a
 *        refused REQUEST (one sentence); these are a list read before anything
 *        is pressed, and can count ("2 listings").
 * LINKS: supabase/migrations/20261023120000_an_account_can_be_deleted.sql
 *        (account_deletion_blockers_for — the codes);
 *        src/features/profile/components/DeleteAccountSheet.tsx.
 */

import type { DeletionBlocker } from '../api/profileApi';

export interface DeletionReason {
  title: string;
  detail: string;
}

export function deletionReason({ code, count }: DeletionBlocker): DeletionReason {
  switch (code) {
    // Since 20261023140000 only a listing holding reward money, or with a
    // recovery claimed, blocks — a live one without either goes with the
    // account. "Close" covers both exits (take it down / finish the recovery).
    case 'LIVE_LISTING':
      return {
        title: count > 1 ? `${count} listings in progress` : 'A listing in progress',
        detail: 'A reward or a recovery is still open. Close it first.',
      };
    case 'MONEY_HELD':
      return {
        title: 'Money on its way back',
        detail: 'A refund from a listing hasn’t landed yet.',
      };
    case 'REWARD_ON_ITS_WAY':
      return { title: 'A reward for you', detail: 'Set up payouts to receive it first.' };
    case 'DISPUTE_OPEN':
      return { title: 'A dispute', detail: 'It’s still being decided.' };
    case 'REVIEW_OPEN':
      return { title: 'A payment under review', detail: 'It’s still being checked.' };
    default:
      // A code added server-side before the app knows it: still a reason.
      return { title: 'Something in progress', detail: 'Try again a little later.' };
  }
}
