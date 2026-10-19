/**
 * WHAT:  Tests for the sighting page's "Got your car back?" door: shown only
 *        for the owner's own ACTIVE listing (the real vehicles rule); the
 *        no-reward wording and the encoded `bounty` param; and the hook —
 *        nothing while disabled, the door once the post is read, nothing when
 *        it can't be, and never the LAST post's door after the id changes.
 * WHY:   This is the way from a confirmation to the money. A door on a
 *        listing that can't be recovered is a button that always fails, and
 *        a wrong `bounty` param puts refund and payout promises on a
 *        no-reward listing (ADR-0014).
 * LINKS: src/features/sightings/hooks/useRecoveryDoor.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { canMarkRecovered, type PostDetail, type PostDetailResult } from '@/features/vehicles';
import { NO_BOUNTY_PARAM } from '@/shared/lib';

import { recoveryDoorFrom, useRecoveryDoor, type VehiclesLoader } from './useRecoveryDoor';

// The vehicles barrel loads the whole feature (Supabase client, storage) at
// import. The door needs only the REAL recovery rule, whose module has no
// runtime imports — so the barrel is stood in by exactly that.
jest.mock('@/features/vehicles', () => ({
  canMarkRecovered: jest.requireActual('@/features/vehicles/lib/ownerPermissions').canMarkRecovered,
}));

// Focus effects run like plain effects here: the screen is always focused.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useEffect } = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});

const visible = (
  bountyPence: number | null,
  fields: Partial<PostDetail> = { status: 'active', isOwner: true },
): PostDetailResult => ({
  kind: 'visible',
  // Only the fields the door and the rule read.
  post: { ...fields, bountyPence } as PostDetail,
});

describe('recoveryDoorFrom (the real rule)', () => {
  it('opens on the owner’s active reward listing, carrying its bounty', () => {
    expect(recoveryDoorFrom(visible(5000), canMarkRecovered)).toEqual({
      noReward: false,
      bounty: '5000',
    });
  });

  it('⚠️ says "no reward" with the explicit token — never an absent param', () => {
    expect(recoveryDoorFrom(visible(null), canMarkRecovered)).toEqual({
      noReward: true,
      bounty: NO_BOUNTY_PARAM,
    });
  });

  it.each([
    ['someone else’s listing', { status: 'active', isOwner: false }],
    ['a listing still being checked', { status: 'pending_verification', isOwner: true }],
    ['a listing already recovered', { status: 'recovered', isOwner: true }],
  ] as const)('⚠️ stays shut on %s', (_, fields) => {
    expect(recoveryDoorFrom(visible(5000, fields), canMarkRecovered)).toBeNull();
  });

  it.each([
    ['hidden', { kind: 'hidden', closedReason: 'recovered' } as PostDetailResult],
    ['not found', { kind: 'notFound' } as PostDetailResult],
  ])('stays shut for a %s listing', (_, result) => {
    expect(recoveryDoorFrom(result, canMarkRecovered)).toBeNull();
  });
});

describe('useRecoveryDoor', () => {
  /** A loader whose post this test controls. */
  const loaderFor = (fetchPostDetail: (postId: string) => Promise<PostDetailResult>) => {
    const load: VehiclesLoader = jest.fn(async () => ({ canMarkRecovered, fetchPostDetail }));
    return load;
  };

  it('offers nothing, and reads nothing, while disabled', async () => {
    const load = loaderFor(async () => visible(5000));
    const { result } = await renderHook(() => useRecoveryDoor('p1', false, load));
    expect(result.current).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('offers the door once the post is read', async () => {
    const fetchPost = jest.fn(async () => visible(5000));
    // Built ONCE, outside render: a new loader each render is a new effect
    // dependency, and the hook would refetch forever.
    const load = loaderFor(fetchPost);
    const { result } = await renderHook(() => useRecoveryDoor('p1', true, load));
    await waitFor(() => expect(result.current).toEqual({ noReward: false, bounty: '5000' }));
    expect(fetchPost).toHaveBeenCalledWith('p1');
  });

  it('offers nothing when the post can’t be read — never an error', async () => {
    const fetchPost = jest.fn(async (): Promise<PostDetailResult> => {
      throw new Error('offline');
    });
    const load = loaderFor(fetchPost);
    const { result } = await renderHook(() => useRecoveryDoor('p1', true, load));
    await waitFor(() => expect(fetchPost).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('⚠️ never shows the last post’s door while the new one is being read', async () => {
    let answerP2: (result: PostDetailResult) => void = () => {};
    const fetchPost = jest.fn((postId: string) =>
      postId === 'p1'
        ? Promise.resolve(visible(5000))
        : new Promise<PostDetailResult>((resolve) => {
            answerP2 = resolve;
          }),
    );
    const load = loaderFor(fetchPost);
    const { result, rerender } = await renderHook(
      ({ postId }: { postId: string }) => useRecoveryDoor(postId, true, load),
      { initialProps: { postId: 'p1' } },
    );
    await waitFor(() => expect(result.current?.bounty).toBe('5000'));

    // A no-reward listing, still on its way: the reward door must not linger.
    await rerender({ postId: 'p2' });
    expect(result.current).toBeNull();

    await act(async () => answerP2(visible(null)));
    expect(result.current).toEqual({ noReward: true, bounty: NO_BOUNTY_PARAM });
  });
});
