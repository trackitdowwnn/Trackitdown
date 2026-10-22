/**
 * WHAT:  Tests for reportSeedFromDetail: the marks, the car and the live
 *        reward the report wizard is seeded with, from each post-detail outcome.
 * WHY:   The car card is the spotter's last check that it's the right car; a
 *        mapping slip shows the wrong identity, or crashes the wizard on a
 *        plate-less or photo-less listing. A hidden post must seed nothing.
 *        The live reward is what the success screen promises — a stale one
 *        would promise money that went back to the owner (ADR-0020).
 * LINKS: src/features/sightings/lib/reportSeed.ts.
 */

import type { PostDetail } from '@/features/vehicles';

import { EMPTY_REPORT_SEED, reportSeedFromDetail } from './reportSeed';

function post(overrides: Partial<PostDetail> = {}): PostDetail {
  return {
    id: 'p1',
    isOwner: false,
    status: 'active',
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    bountyPence: 50000,
    rewardEnded: false,
    lastSeenAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    owner: { memberSince: '2026-01-01' },
    photos: [{ uri: 'https://example.test/hero.jpg' }, { uri: 'https://example.test/2.jpg' }],
    features: [],
    distinctiveFeatures: [
      { id: 'm1', description: 'Bee sticker', photoUrl: 'https://example.test/m1.jpg' },
      { description: 'Old cached mark, no id', photoUrl: '' },
      { id: 'm2', description: 'Roof rack', photoUrl: '' },
    ],
    sightingCount: 0,
    viewerHasSighting: false,
    ...overrides,
  } as PostDetail;
}

describe('reportSeedFromDetail', () => {
  it('seeds the car (first photo) and the confirmable marks', () => {
    const seed = reportSeedFromDetail({ kind: 'visible', post: post() });
    expect(seed.reportedCar).toEqual({
      make: 'BMW',
      model: '3 Series',
      colour: 'Blue',
      plate: 'AB12 CDE',
      photoUrl: 'https://example.test/hero.jpg',
      rewardPence: 50000,
    });
    // The id-less mark is dropped (a sighting references marks by id); an
    // empty photo becomes "no photo".
    expect(seed.confirmableFeatures).toEqual([
      { id: 'm1', description: 'Bee sticker', photoUrl: 'https://example.test/m1.jpg' },
      { id: 'm2', description: 'Roof rack', photoUrl: undefined },
    ]);
  });

  it('seeds what else the listing says — year, body type, finish, the live reward', () => {
    const seed = reportSeedFromDetail({
      kind: 'visible',
      post: post({
        year: 2018,
        bodyType: 'Hatchback',
        colourFinish: 'metallic',
        bountyPence: 20000,
      }),
    });
    expect(seed.reportedCar).toMatchObject({
      year: 2018,
      bodyType: 'Hatchback',
      finish: 'Metallic',
      rewardPence: 20000,
    });
  });

  it('leaves out "Not sure", an ended reward and what the owner never said', () => {
    const seed = reportSeedFromDetail(
      {
        kind: 'visible',
        post: post({ bodyType: 'Not sure', bountyPence: null, rewardEnded: true }),
      },
      'Not sure', // BODY_TYPE_UNKNOWN, passed in by the screen's deferred import
    );
    expect(seed.reportedCar?.bodyType).toBeUndefined();
    expect(seed.reportedCar?.rewardPence).toBeUndefined();
    expect(seed.reportedCar?.year).toBeUndefined();
    expect(seed.reportedCar?.finish).toBeUndefined();
  });

  it('copes with a plate-less, photo-less listing', () => {
    const seed = reportSeedFromDetail({
      kind: 'visible',
      post: post({ plate: null, photos: [], distinctiveFeatures: [] }),
    });
    expect(seed.reportedCar).toEqual({
      make: 'BMW',
      model: '3 Series',
      colour: 'Blue',
      plate: null,
      photoUrl: undefined,
      rewardPence: 50000,
    });
    expect(seed.confirmableFeatures).toEqual([]);
  });

  it('seeds nothing for a hidden or missing post', () => {
    expect(reportSeedFromDetail({ kind: 'hidden', closedReason: 'recovered' })).toBe(
      EMPTY_REPORT_SEED,
    );
    expect(reportSeedFromDetail({ kind: 'notFound' })).toBe(EMPTY_REPORT_SEED);
    expect(EMPTY_REPORT_SEED.reportedCar).toBeUndefined();
    // No reward either: the success screen then falls back to the route param.
    expect(EMPTY_REPORT_SEED.reward).toBeUndefined();
  });

  // The success screen promises the reward AS IT IS NOW, not as it was when
  // the spotter tapped "I've seen this car" (ADR-0020).
  describe('live reward', () => {
    it('carries the live reward amount', () => {
      const seed = reportSeedFromDetail({ kind: 'visible', post: post({ bountyPence: 20000 }) });
      expect(seed.reward).toEqual({ bountyPence: 20000, rewardEnded: false });
    });

    it('carries a lapsed reward as a null bounty with rewardEnded', () => {
      const seed = reportSeedFromDetail({
        kind: 'visible',
        post: post({ bountyPence: null, rewardEnded: true }),
      });
      expect(seed.reward).toEqual({ bountyPence: null, rewardEnded: true });
    });

    it('carries a fee listing as a null bounty, not ended', () => {
      const seed = reportSeedFromDetail({ kind: 'visible', post: post({ bountyPence: null }) });
      expect(seed.reward).toEqual({ bountyPence: null, rewardEnded: false });
    });
  });
});
