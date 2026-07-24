/**
 * WHAT:  Tests for the distinctive-features model + schema: description bounds
 *        (3–80, trimmed), the complete-draft rule (photo AND description), the
 *        cap (≤8), and add/update/remove preserving order.
 * WHY:   The description is what gives a photo meaning, so an orphan photo (no
 *        description) or a silently-dropped/duplicated pair is a real defect —
 *        and ordering is the owner's intended emphasis. All pinned here.
 * LINKS: src/features/vehicles/post/lib/distinctiveFeatures.ts.
 */

import {
  DESCRIPTION_MAX,
  MAX_DISTINCTIVE_FEATURES,
  addFeature,
  canAddMore,
  descriptionSchema,
  distinctiveFeaturesSchema,
  isCompleteDraft,
  removeFeatureAt,
  updateFeatureAt,
  type DistinctiveFeature,
} from './distinctiveFeatures';

const photo = (n: number) => ({ uri: `file://mark-${n}.jpg`, width: 400, height: 300 });
const feature = (n: number, description = `Mark ${n}`): DistinctiveFeature => ({
  photo: photo(n),
  description,
});

describe('descriptionSchema (length bounds, trimmed)', () => {
  it('rejects too-short (after trim) and too-long descriptions', () => {
    expect(descriptionSchema.safeParse('ab').success).toBe(false); // 2 chars
    expect(descriptionSchema.safeParse('   a  ').success).toBe(false); // 1 after trim
    expect(descriptionSchema.safeParse('a'.repeat(DESCRIPTION_MAX + 1)).success).toBe(false);
  });

  it('accepts an in-range description and trims it', () => {
    const parsed = descriptionSchema.parse('  Dent on driver’s door  ');
    expect(parsed).toBe('Dent on driver’s door');
    expect(descriptionSchema.safeParse('abc').success).toBe(true); // exactly min
    expect(descriptionSchema.safeParse('a'.repeat(DESCRIPTION_MAX)).success).toBe(true); // exactly max
  });
});

describe('isCompleteDraft (photo AND description required)', () => {
  it('needs both a photo and a valid description', () => {
    expect(isCompleteDraft(null, 'Cracked wing mirror')).toBe(false);
    expect(isCompleteDraft(photo(1), 'ab')).toBe(false); // description too short
    expect(isCompleteDraft(photo(1), '')).toBe(false);
    expect(isCompleteDraft(photo(1), 'Cracked wing mirror')).toBe(true);
  });
});

describe('add / update / remove preserve order', () => {
  it('appends in order and trims the description', () => {
    let list: DistinctiveFeature[] = [];
    list = addFeature(list, feature(1, '  Sticker, rear window  '));
    list = addFeature(list, feature(2));
    expect(list.map((f) => f.photo.uri)).toEqual(['file://mark-1.jpg', 'file://mark-2.jpg']);
    expect(list[0].description).toBe('Sticker, rear window');
  });

  it('updates the pair at an index without disturbing the rest', () => {
    const list = [feature(1), feature(2), feature(3)];
    const next = updateFeatureAt(list, 1, feature(9, 'Replaced'));
    expect(next.map((f) => f.description)).toEqual(['Mark 1', 'Replaced', 'Mark 3']);
    // Out-of-range is a no-op.
    expect(updateFeatureAt(list, 5, feature(9))).toBe(list);
  });

  it('removes the pair at an index, keeping the order of the rest', () => {
    const list = [feature(1), feature(2), feature(3)];
    expect(removeFeatureAt(list, 0).map((f) => f.description)).toEqual(['Mark 2', 'Mark 3']);
    expect(removeFeatureAt(list, 1).map((f) => f.description)).toEqual(['Mark 1', 'Mark 3']);
    // Out-of-range is a no-op.
    expect(removeFeatureAt(list, -1)).toBe(list);
  });
});

describe('cap at MAX_DISTINCTIVE_FEATURES', () => {
  it('canAddMore is false once the cap is reached', () => {
    const full = Array.from({ length: MAX_DISTINCTIVE_FEATURES }, (_, i) => feature(i));
    expect(canAddMore(full.slice(0, MAX_DISTINCTIVE_FEATURES - 1))).toBe(true);
    expect(canAddMore(full)).toBe(false);
  });

  it('the submit schema rejects more than the cap and defaults empty', () => {
    const over = Array.from({ length: MAX_DISTINCTIVE_FEATURES + 1 }, (_, i) => feature(i));
    expect(distinctiveFeaturesSchema.safeParse(over).success).toBe(false);
    expect(distinctiveFeaturesSchema.parse(undefined)).toEqual([]);
  });
});
