/**
 * WHAT:  Tests for what the owner's sighting page reads from the LISTING:
 *        all the owner's marks (the wizard's own list), and the "Got your car
 *        back?" door — only on the owner's own ACTIVE listing (the real
 *        vehicles rule), with the no-reward wording and the encoded `bounty`
 *        param. And the hook: nothing while disabled, the facts once the
 *        listing is read, nothing when it can't be, and never the LAST
 *        listing's facts after the id changes.
 * WHY:   The door is the way from a confirmation to the money: on a listing
 *        that can't be recovered it is a button that always fails, and a
 *        wrong `bounty` param puts refund and payout promises on a no-reward
 *        listing (ADR-0014). The marks must be the same list the spotter was
 *        asked about.
 * LINKS: src/features/sightings/hooks/useSightingPost.ts.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { canMarkRecovered, type PostDetail, type PostDetailResult } from '@/features/vehicles';
import { NO_BOUNTY_PARAM } from '@/shared/lib';

import { sightingPostFacts, useSightingPost, type VehiclesLoader } from './useSightingPost';

// The vehicles barrel loads the whole feature (Supabase client, storage) at
// import. The page needs only the REAL recovery rule, whose module has no
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

const MARKS = [
  { id: 'm1', description: 'Dent on the rear door', photoUrl: 'https://x/m1.jpg' },
  { id: 'm2', description: 'Roof box', photoUrl: '' },
];

const visible = (
  bountyPence: number | null,
  fields: Partial<PostDetail> = { status: 'active', isOwner: true },
): PostDetailResult => ({
  kind: 'visible',
  // The fields the page and the wizard's mapping read.
  post: {
    make: 'VW',
    model: 'Golf',
    colour: 'red',
    plate: 'AB12CDE',
    photos: [],
    rewardEnded: false,
    distinctiveFeatures: MARKS,
    ...fields,
    bountyPence,
  } as unknown as PostDetail,
});

describe('sightingPostFacts', () => {
  it('lists every mark on the listing, in order — the list the spotter was asked about', () => {
    expect(sightingPostFacts(visible(5000), canMarkRecovered)?.marks).toEqual([
      { id: 'm1', description: 'Dent on the rear door', photoUrl: 'https://x/m1.jpg' },
      { id: 'm2', description: 'Roof box', photoUrl: undefined },
    ]);
  });

  it('opens the door on the owner’s active reward listing, carrying its bounty', () => {
    expect(sightingPostFacts(visible(5000), canMarkRecovered)?.recovery).toEqual({
      noReward: false,
      bounty: '5000',
    });
  });

  it('⚠️ says "no reward" with the explicit token — never an absent param', () => {
    expect(sightingPostFacts(visible(null), canMarkRecovered)?.recovery).toEqual({
      noReward: true,
      bounty: NO_BOUNTY_PARAM,
    });
  });

  it.each([
    ['someone else’s listing', { status: 'active', isOwner: false }],
    ['a listing still being checked', { status: 'pending_verification', isOwner: true }],
    ['a listing already recovered', { status: 'recovered', isOwner: true }],
  ] as const)('⚠️ keeps the door shut on %s — the marks still list', (_, fields) => {
    const facts = sightingPostFacts(visible(5000, fields), canMarkRecovered);
    expect(facts?.recovery).toBeNull();
    expect(facts?.marks).toHaveLength(2);
  });

  it.each([
    ['hidden', { kind: 'hidden', closedReason: 'recovered' } as PostDetailResult],
    ['not found', { kind: 'notFound' } as PostDetailResult],
  ])('has nothing for a %s listing', (_, result) => {
    expect(sightingPostFacts(result, canMarkRecovered)).toBeNull();
  });
});

describe('useSightingPost', () => {
  /** A loader whose listing this test controls. Built ONCE per test, outside
   *  render: a new loader each render is a new effect dependency, and the
   *  hook would refetch forever. */
  const loaderFor = (fetchPostDetail: (postId: string) => Promise<PostDetailResult>) => {
    const load: VehiclesLoader = jest.fn(async () => ({ canMarkRecovered, fetchPostDetail }));
    return load;
  };

  it('offers nothing, and reads nothing, while disabled', async () => {
    const load = loaderFor(async () => visible(5000));
    const { result } = await renderHook(() => useSightingPost('p1', false, load));
    expect(result.current).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('offers the listing’s facts once it is read', async () => {
    const fetchPost = jest.fn(async () => visible(5000));
    const load = loaderFor(fetchPost);
    const { result } = await renderHook(() => useSightingPost('p1', true, load));
    await waitFor(() =>
      expect(result.current?.recovery).toEqual({ noReward: false, bounty: '5000' }),
    );
    expect(result.current?.marks).toHaveLength(2);
    expect(fetchPost).toHaveBeenCalledWith('p1');
  });

  it('offers nothing when the listing can’t be read — never an error', async () => {
    const fetchPost = jest.fn(async (): Promise<PostDetailResult> => {
      throw new Error('offline');
    });
    const load = loaderFor(fetchPost);
    const { result } = await renderHook(() => useSightingPost('p1', true, load));
    await waitFor(() => expect(fetchPost).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('⚠️ never shows the last listing’s facts while the new one is being read', async () => {
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
      ({ postId }: { postId: string }) => useSightingPost(postId, true, load),
      { initialProps: { postId: 'p1' } },
    );
    await waitFor(() => expect(result.current?.recovery?.bounty).toBe('5000'));

    // A no-reward listing, still on its way: the reward door must not linger.
    await rerender({ postId: 'p2' });
    expect(result.current).toBeNull();

    await act(async () => answerP2(visible(null)));
    expect(result.current?.recovery).toEqual({ noReward: true, bounty: NO_BOUNTY_PARAM });
  });
});
