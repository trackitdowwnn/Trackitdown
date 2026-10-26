/**
 * WHAT:  isOwnCleanPath — a storage path the service role may sign for `owner`.
 * WHY:   Security audit lead 10. A stored path like '<uid>/../<victim>/x.jpg'
 *        passed a prefix check and was then signed with the service role, which
 *        ignores storage policies. The database now refuses such paths
 *        (public.is_clean_storage_path, 20261026160000); this is the same rule
 *        at the signer, for rows written before it and as a second lock.
 * LINKS: supabase/functions/export-my-data/index.ts;
 *        supabase/functions/notify-bug-report/index.ts.
 */

export function isOwnCleanPath(path: string, owner: string | null | undefined): boolean {
  if (!owner || !path.startsWith(`${owner}/`)) return false;
  if (/[\\%?#]/.test(path)) return false;
  if ([...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false;
  return !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}
