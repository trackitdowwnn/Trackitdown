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

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

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
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
  log.info('Signed out');
}

/**
 * Invoke the server-side delete-account Edge Function (outlined in the
 * profile migration; not built yet). The server re-checks blocking posts —
 * the enforcement lives THERE, this call just requests it.
 */
export async function requestAccountDeletion(): Promise<void> {
  log.info('Account deletion requested');
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) {
    // Name only — server-controlled message strings stay out of the log.
    log.warn('Account deletion failed or unavailable', { error: error.name });
    throw error;
  }
  // The server deleted auth.users; drop the now-orphaned local tokens too.
  await supabase.auth.signOut().catch(() => {
    // Tokens are dead either way; failing to clear them locally is harmless.
  });
  log.info('Account deletion completed');
}
