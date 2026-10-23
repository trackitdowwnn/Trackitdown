/**
 * WHAT:  Supabase reads/writes for the profile feature — my profile, edits,
 *        avatar upload (resize → own-folder storage → cache-busted URL), the
 *        narrow public spotter profile, the deletion blockers, sign-out (here
 *        or everywhere), and the delete-account invocation.
 * WHY:   One file owns every query so the RLS surface is auditable: clients
 *        may write ONLY display fields (the migration's column grants make
 *        counters unwritable), the public profile SELECT lists only the
 *        privacy-permitted columns, and deletion is a server-side Edge
 *        Function — the client's blockers read is advisory UX, the server
 *        re-check is the enforcement. Edits and deletion attempts are
 *        logged with the [profile] tag — ids and counts, never names/PII.
 * LINKS: supabase/migrations/20260710120000_profile_fields_and_avatars.sql;
 *        src/features/profile/types.ts (PublicProfile boundary);
 *        docs/SECURITY_AND_TRUST.md §1/§3; docs/LOGGING.md.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { z } from 'zod';

import {
  forgetAllPushTokens,
  resetInboxBadge,
  unregisterCurrentPushToken,
} from '@/features/notifications';
import { clearPostDraft } from '@/features/vehicles';
import { supabase } from '@/shared/api';
import { avatarUrlFromPath } from '@/shared/lib/avatarUrl';
import { forgetLocationMemory } from '@/shared/lib/location/locationMemory';
import { createLogger } from '@/shared/lib/logger';

import type { MyProfile, PublicProfile, ReputationCounters } from '../types';

const log = createLogger('profile');

/** Avatars upload at most this square edge — plenty for an avatarLg circle. */
const AVATAR_MAX_EDGE = 512;
const AVATAR_COMPRESS = 0.85;

interface ProfileRow {
  id: string;
  first_name: string;
  display_name: string;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
  sightings_reported: number;
  sightings_helpful: number;
  recoveries_credited: number;
}

const countersFromRow = (row: {
  sightings_reported: number;
  sightings_helpful: number;
  recoveries_credited: number;
}): ReputationCounters => ({
  sightingsReported: row.sightings_reported,
  sightingsHelpful: row.sightings_helpful,
  recoveriesCredited: row.recoveries_credited,
});

export async function fetchMyProfile(userId: string): Promise<MyProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, first_name, display_name, avatar_path, created_at, updated_at, sightings_reported, sightings_helpful, recoveries_credited',
    )
    .eq('id', userId)
    .single<ProfileRow>();
  if (error) {
    throw error;
  }
  return {
    id: data.id,
    firstName: data.first_name,
    displayName: data.display_name,
    avatarUrl: avatarUrlFromPath(data.avatar_path, data.updated_at),
    createdAt: data.created_at,
    counters: countersFromRow(data),
  };
}

export async function updateMyProfile(
  userId: string,
  fields: { firstName: string; displayName: string },
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ first_name: fields.firstName, display_name: fields.displayName })
    .eq('id', userId);
  if (error) {
    log.error('Profile update failed', { userId, code: error.code });
    throw error;
  }
  log.info('Profile updated', { userId }); // fields deliberately not logged
}

/**
 * Resize, upload to avatars/<userId>/avatar.jpg (replacing the old one), and
 * persist the storage PATH (the DB CHECK pins it to the user's own folder).
 */
export async function uploadAvatar(userId: string, localUri: string): Promise<void> {
  const context = ImageManipulator.manipulate(localUri);
  context.resize({ width: AVATAR_MAX_EDGE });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: AVATAR_COMPRESS, format: SaveFormat.JPEG });

  const response = await fetch(saved.uri);
  const body = await response.arrayBuffer();

  // Path starts with the user's id — the storage RLS own-folder rule AND
  // the profiles.avatar_path CHECK both require exactly this shape.
  const path = `${userId}/avatar.jpg`;
  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, body, { contentType: 'image/jpeg', upsert: true });
  if (uploadError) {
    // name/statusCode/message identify WHY (RLS, size limit, network) —
    // storage errors carry no user PII, unlike free-form row data.
    log.error('Avatar upload failed', {
      userId,
      error: uploadError.name,
      status: 'statusCode' in uploadError ? uploadError.statusCode : undefined,
      message: uploadError.message,
      bytes: body.byteLength, // 0 = the local file read failed, not storage
    });
    throw uploadError;
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId);
  if (updateError) {
    log.error('Avatar path update failed after upload', { userId, code: updateError.code });
    throw updateError;
  }
  log.info('Avatar updated', { userId });
}

// SAFETY: the ONLY columns an owner may learn about a spotter (DOMAIN.md /
// SECURITY_AND_TRUST §1: first name + reputation only). display_name is
// deliberately absent — it may contain a surname. Widening this select is a
// privacy decision; update docs/DOMAIN.md and the PublicProfile type first.
export async function fetchPublicProfile(userId: string): Promise<PublicProfile> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      // updated_at is fetched ONLY to cache-bust the avatar URL — never rendered.
      'first_name, avatar_path, created_at, updated_at, sightings_reported, sightings_helpful, recoveries_credited',
    )
    .eq('id', userId)
    .single<Omit<ProfileRow, 'id' | 'display_name'>>();
  if (error) {
    throw error;
  }
  return {
    firstName: data.first_name,
    avatarUrl: avatarUrlFromPath(data.avatar_path, data.updated_at),
    createdAt: data.created_at,
    counters: countersFromRow(data),
  };
}

/**
 * A reason the account can't be deleted yet, from account_deletion_blockers()
 * (20261023120000) — the SAME definition the delete-account Edge Function
 * enforces. Advisory here: it can be a beat stale, and the server re-checks.
 */
export interface DeletionBlocker {
  code: string;
  count: number;
}

const blockersSchema = z.array(z.object({ code: z.string(), count: z.number().int() }));

/** What stops the caller deleting their account right now; empty = nothing. */
export async function fetchDeletionBlockers(): Promise<DeletionBlocker[]> {
  const { data, error } = await supabase.rpc('account_deletion_blockers');
  if (error) {
    log.warn('account_deletion_blockers failed', { code: error.code });
    throw error;
  }
  return blockersSchema.parse(data).filter((blocker) => blocker.count > 0);
}

/**
 * The caller's live listings — active or being checked. When nothing blocks,
 * these are listings with no reward money held, and deleting the account
 * TAKES THEM DOWN (20261023140000), so the delete screen names them before
 * the button. Their own rows, read under the owner's RLS.
 */
export async function fetchLiveListingCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .in('status', ['active', 'pending_verification']);
  if (error) {
    log.warn('live listing count failed', { code: error.code });
    throw error;
  }
  return count ?? 0;
}

/**
 * What leaving an account clears on THIS device, whichever way they leave —
 * log out, sign out everywhere, or delete. One list, so a new piece of local
 * state can't be forgotten on one of the three paths (deletion used to skip
 * the badge reset). Never throws.
 */
async function forgetThisDevice(): Promise<void> {
  // The Inbox badge halves are module-level and would otherwise survive into
  // the NEXT account's session.
  resetInboxBadge();
  // SAFETY: the unfinished report holds where the car was last seen — on a
  // driveway theft, a home. Leaving deliberately is the hand-over point for
  // a shared or sold phone, so it goes here, not on the SIGNED_OUT event:
  // that also fires when a session merely expires, and the owner keeps their
  // own work then.
  await clearPostDraft();
  // …and the in-memory location caches (recent points and place labels).
  forgetLocationMemory();
}

/**
 * Log out. `everywhere` also signs out every OTHER device (all refresh tokens
 * revoked) and stops pushes to all of them — the lost-phone case.
 *
 * ⚠️ Another device's ACCESS token stays valid until it expires (up to an
 * hour — Supabase can't recall a JWT it has issued); it just can't refresh.
 */
export async function signOut({ everywhere = false }: { everywhere?: boolean } = {}): Promise<void> {
  // SAFETY: release push tokens FIRST. The RPCs pin the delete to auth.uid(),
  // so once the session is gone there is no way to prove a token was ours —
  // and a stale row keeps delivering this user's sighting and message pushes
  // to whoever holds the handset. Everywhere: every device's token
  // (20261023130000); otherwise just this one. Never blocks the sign-out.
  if (everywhere) {
    // ⚠️ Refuse rather than half-work: signing the other phones out while
    // their push tokens survive would leave a lost phone getting this
    // person's sightings, with the screen saying it worked. The caller shows
    // "couldn't log out — try again".
    const forgotten = await forgetAllPushTokens().catch(() => false);
    if (!forgotten) {
      throw new Error('PUSH_TOKENS_NOT_FORGOTTEN');
    }
  } else {
    // .catch is belt to pushTokenApi's braces: the helper swallows its own
    // errors by contract, but nothing should be able to trap someone in a
    // session because a token release failed.
    await unregisterCurrentPushToken().catch(() => {});
  }
  await forgetThisDevice();
  // ⚠️ The scope is ALWAYS explicit: supabase-js defaults signOut() to
  // 'global', so a bare call made every Log out sign out every device too (code
  // review of #261). 'local' still revokes this device's own refresh token.
  const { error } = await supabase.auth.signOut({ scope: everywhere ? 'global' : 'local' });
  if (error) {
    throw error;
  }
  log.info(everywhere ? 'Signed out everywhere' : 'Signed out');
}

/** Error carrying user-facing copy plus the server's machine `code`. */
export class AccountDeletionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AccountDeletionError';
    this.code = code;
  }
}

/** Server codes that deserve their own words. Anything else gets the fallback —
 *  a server message is never shown raw, so a 500's internals can't reach a
 *  screen. */
const DELETION_MESSAGES: Record<string, string> = {
  ACCOUNT_HAS_ESCROW:
    'You have a live listing with a reward held in escrow. Cancel it first, then delete your account.',
  NOT_AUTHENTICATED: 'Please log in again, then try deleting your account.',
  // The server's reasons it can't go yet (account_deletion_blockers_for,
  // 20261023120000) — each says what to do, never "try again".
  LIVE_LISTING: 'A listing has a reward or a recovery in progress. Close it first.',
  MONEY_HELD: "Money from one of your listings is still being returned. Try again once it's back.",
  // Usually they haven't set up payouts, and nothing pays it until they do.
  REWARD_ON_ITS_WAY: 'A reward is waiting for you. Set up payouts to receive it first.',
  PAYOUT_ON_ITS_WAY: "A payout is still on its way to your bank. Try again once it's arrived.",
  DISPUTE_OPEN: "A dispute is still being decided. Try again once it's settled.",
  REVIEW_OPEN: "A payment is still being reviewed. Try again once it's done.",
  INTENT_NOT_CANCELLED: 'A payment is still being processed. Try again in a moment.',
};
const DELETION_FALLBACK = "We couldn't delete your account. Please try again.";

/**
 * Invoke the server-side delete-account Edge Function. The server re-checks
 * every blocker — the enforcement lives THERE, this call just requests it.
 *
 * Its refusals are worth distinguishing: fetchDeletionBlockers can be a beat
 * stale (a draft can go live between the read and the tap), and the payout
 * balance is only checked at the server, so a user CAN legitimately reach the
 * button and still be refused. Telling them what to do is actionable; "try
 * again" would be a lie that never comes true.
 */
/**
 * "Download your data" (UK GDPR Art. 15/20, 2026-10-23): asks export-my-data
 * for a copy of everything about the caller. It returns a 15-minute link to a
 * PDF (which links to a machine-readable JSON copy) — the same file again if
 * one was made today — which the caller
 * opens in the browser. Throws calm copy; never logs the link.
 */
export async function requestDataExport(): Promise<{ url: string; expiresAt: string }> {
  const { data, error } = await supabase.functions.invoke('export-my-data');
  if (error) {
    log.warn('data export failed', { code: error.name });
    throw new Error('We couldn’t put your data together. Please try again.');
  }
  const parsed = dataExportSchema.safeParse(data);
  if (!parsed.success) {
    log.warn('data export reply malformed');
    throw new Error('We couldn’t put your data together. Please try again.');
  }
  log.info('data export ready', { reused: parsed.data.reused ?? false });
  return { url: parsed.data.url, expiresAt: parsed.data.expiresAt };
}

const dataExportSchema = z.object({
  url: z.url(),
  expiresAt: z.string(),
  reused: z.boolean().optional(),
});

export async function requestAccountDeletion(): Promise<void> {
  log.info('Account deletion requested');
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) {
    let code = 'UNKNOWN';
    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { code?: string };
        code = body.code ?? 'UNKNOWN';
      } catch {
        // Non-JSON body (a gateway error page); the fallback copy covers it.
      }
    }
    // Code only — server-controlled message strings stay out of the log.
    log.warn('Account deletion failed', { code });
    // Own-property lookup: bracket access on a plain object also resolves
    // inherited keys, so a `code` of 'constructor' would otherwise map to a
    // function (the guard paymentsApi's parseFunctionError uses).
    const message = Object.hasOwn(DELETION_MESSAGES, code)
      ? DELETION_MESSAGES[code]
      : DELETION_FALLBACK;
    throw new AccountDeletionError(message, code);
  }
  // SAFETY: the account is gone, so is its unfinished report (a last-seen
  // location). No token release: the push_tokens rows cascaded with the
  // profile, and there is no session left to release them with anyway.
  await forgetThisDevice();
  // The server deleted auth.users; drop the now-orphaned local tokens too.
  // 'local': there is nothing left to revoke anywhere else.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {
    // Tokens are dead either way; failing to clear them locally is harmless.
  });
  log.info('Account deletion completed');
}
