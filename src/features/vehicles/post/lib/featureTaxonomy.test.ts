/**
 * WHAT:  Integrity tests for the client feature taxonomy — non-empty, unique
 *        keys, and featureLabel resolving known keys (and degrading gracefully
 *        for an unknown one, so an old/renamed key never blanks the review).
 * WHY:   This constant mirrors the seeded vehicle_feature table; a duplicate or
 *        empty entry would corrupt the picker and the review summary. create_post
 *        validates the chosen keys against the DB, so drift can only under-offer.
 * LINKS: src/features/vehicles/post/lib/featureTaxonomy.ts, docs/TESTING.md.
 */

import { VEHICLE_FEATURES, featureLabel } from './featureTaxonomy';

describe('VEHICLE_FEATURES', () => {
  it('is non-empty with unique keys and complete entries', () => {
    expect(VEHICLE_FEATURES.length).toBeGreaterThan(0);
    const keys = VEHICLE_FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const feature of VEHICLE_FEATURES) {
      expect(feature.key).toBeTruthy();
      expect(feature.label).toBeTruthy();
      expect(feature.icon).toBeTruthy();
    }
  });
});

describe('featureLabel', () => {
  it('resolves a known key to its label', () => {
    expect(featureLabel('tow_bar')).toBe('Tow bar');
  });

  it('falls back to the raw key for an unknown one', () => {
    expect(featureLabel('mystery_key')).toBe('mystery_key');
  });
});
