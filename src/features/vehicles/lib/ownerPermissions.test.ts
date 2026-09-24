/**
 * WHAT:  Tests for canArchive — which statuses an owner may archive.
 * WHY:   The allowlist must match set_post_archived's NOT_CLOSED check. If it
 *        drifts wider, the sheet offers a row the server refuses; if it drifts
 *        to include a live status, an owner could be offered to hide a car
 *        that is still being searched for.
 * LINKS: src/features/vehicles/lib/ownerPermissions.ts;
 *        supabase/migrations/20260924130000_archive_listings.sql.
 */

import type { PostStatus } from '@/shared/types';

import { canArchive } from './ownerPermissions';

describe('canArchive', () => {
  it.each<[PostStatus, boolean]>([
    ['recovered', true],
    ['recovered_no_spotter', true],
    ['cancelled', true],
    ['expired', true],
    ['draft', false],
    ['pending_verification', false],
    ['active', false],
    ['recovery_claimed', false],
    ['rejected', false],
  ])('%s → %s', (status, expected) => {
    expect(canArchive(status)).toBe(expected);
  });
});
