/**
 * WHAT:  Supabase reads/writes for the profile feature — my profile, edits,
 *        avatar upload (resize → own-folder storage → cache-busted URL), the
 *        narrow public spotter profile, the deletion pre-check, sign-out,
 *        and the delete-account invocation.
 * WHY:   One file owns every query so the RLS surface is auditable: clients
 *        may write ONLY display fields (the migration's column grants make
 *        counters unwritable), the public profile SELECT lists only the
 *        privacy-permitted columns, and deletion is a server-side Edge
 *        Function — the client's blocking-post check is advisory UX, the
 *        server re-check is the enforcement. Edits and deletion attempts are
 *        logged with the [profile] tag — ids and counts, never names/PII.
 * LINKS: supabase/migrations/20260710120000_profile_fields_and_avatars.sql;
 *        src/features/profile/types.ts (PublicProfile boundary);
 *        docs/SECURITY_AND_TRUST.md §1/§3; docs/LOGGING.md.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { resetInboxBadge, unregisterCurrentPushToken } from '@/features/notifications';
import { supabase } from '@/shared/api';
import { avatarUrlFromPath } from '@/shared/lib/avatarUrl';
import { createLogger } from '@/shared/lib/logger';

import type { MyProfile, PublicProfile, ReputationCounters } from '../types';

const log = createLogger('profile');

/** Avatars upload at most this square edge — plenty for an avatarLg circle. */
const AVATAR_MAX_EDGE = 512;
const AVATAR_COMPRESS = 0.85;

/** Post statuses with money in escrow — these block account deletion. */
export const DELETION_BLOCKING_STATUSES = [
  'active',
  'pending_verification',
  'recovery_claimed',
] as const;

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

/** Posts with escrowed money that block deletion (advisory pre-check). */
export async function countDeletionBlockingPosts(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('posts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .in('status', [...DELETION_BLOCKING_STATUSES]);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

export async function signOut(): Promise<void> {
  // SAFETY: release this device's push token FIRST. The unregister RPC pins
  // the delete to auth.uid(), so once the session is gone there is no way to
  // prove the token was ours — and a stale row would keep delivering this
  // user's sighting and message notifications to whoever holds the handset
  // next. Never throws, never blocks the sign-out.
  // .catch is belt to pushTokenApi's braces: that helper swallows its own
  // errors by contract, but nothing should be able to trap someone in a
  // session because a token release failed.
  await unregisterCurrentPushToken().catch(() => {});
  // The Inbox badge halves are module-level and would otherwise survive into
  // the NEXT account's session — this is the one place they must be zeroed.
  resetInboxBadge();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
  log.info('Signed out');
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
    'You have a live listing with a bounty in escrow. Cancel it first, then delete your account.',
  NOT_AUTHENTICATED: 'Please sign in again, then try deleting your account.',
};
const DELETION_FALLBACK = "We couldn't delete your account. Please try again.";

/**
 * Invoke the server-side delete-account Edge Function. The server re-checks
 * blocking posts — the enforcement lives THERE, this call just requests it.
 *
 * The escrow rejection is worth distinguishing: the pre-check in
 * countDeletionBlockingPosts can be a beat stale (a draft can go active between
 * the check and the confirm tap), so a user CAN legitimately reach the confirm
 * dialog and still be refused. Telling them "cancel your listing first" is
 * actionable; "try again" would be a lie that never comes true.
 */
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
  // The server deleted auth.users; drop the now-orphaned local tokens too.
  await supabase.auth.signOut().catch(() => {
    // Tokens are dead either way; failing to clear them locally is harmless.
  });
  log.info('Account deletion completed');
}
