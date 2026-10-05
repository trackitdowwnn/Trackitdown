/**
 * WHAT:  Tests for canArchive — which statuses an owner may archive — and
 *        canChangeReward — where the change / add reward row is offered.
 * WHY:   The allowlist must match set_post_archived's NOT_CLOSED check. If it
 *        drifts wider, the sheet offers a row the server refuses; if it drifts
 *        to include a live status, an owner could be offered to hide a car
 *        that is still being searched for.
 * LINKS: src/features/vehicles/lib/ownerPermissions.ts;
 *        supabase/migrations/20260924130000_archive_listings.sql.
 */

import type { PostStatus } from '@/shared/types';

import type { PostDetail } from '../types';
import { canArchive, canChangeReward } from './ownerPermissions';

// The reward can change (or be added) on a LIVE listing only — the statuses
// set_reward_renewal_amount accepts. Offering it anywhere else shows a row
// whose screen can only say "this listing isn't live".
describe('canChangeReward', () => {
  it.each<[PostStatus, boolean]>([
    ['active', true],
    ['pending_verification', true],
    ['draft', false],
    ['recovery_claimed', false],
    ['recovered', false],
    ['cancelled', false],
  ])('%s → %s', (status, expected) => {
    expect(canChangeReward({ isOwner: true, status } as PostDetail)).toBe(expected);
  });

  it('is never offered to someone who is not the owner', () => {
    expect(canChangeReward({ isOwner: false, status: 'active' } as PostDetail)).toBe(false);
  });
});

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
