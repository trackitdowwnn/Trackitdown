/**
 * WHAT:  Tests for PhotoGridPicker's pure logic — ordering ops keep the
 *        cover-at-index-0 invariant, merge dedupes and clamps to max, the
 *        selection-limit and remaining-count maths, drag display/slot
 *        geometry, resize-target maths, confirm rule, and the zod schema.
 * WHY:   The array IS the post's photo answer and index 0 becomes the public
 *        cover image; an ordering slip here publishes the wrong cover without
 *        anyone noticing. Pinned exhaustively where it's cheap (no rendering).
 * LINKS: src/shared/ui/photoGridModel.ts; docs/TESTING.md.
 */

import {
  displayIndexDuringDrag,
  gridCellForIndex,
  gridHeightForSlots,
  gridSlotForPoint,
  makeCover,
  mergePhotos,
  movePhoto,
  photoListSchema,
  type PickedPhoto,
  remainingSlots,
  remainingToMin,
  removalNeedsConfirm,
  removePhoto,
  resizeTargetFor,
  tileAccessibilityLabel,
} from './photoGridModel';

const photo = (n: number): PickedPhoto => ({ uri: `file:///photo-${n}.jpg`, width: 400, height: 300 });
const photos = (count: number) => Array.from({ length: count }, (_, n) => photo(n));

describe('ordering operations', () => {
  it('movePhoto reorders and returns a new array', () => {
    const list = photos(4);
    const moved = movePhoto(list, 2, 0);
    expect(moved.map((p) => p.uri)).toEqual([2, 0, 1, 3].map((n) => photo(n).uri));
    expect(list.map((p) => p.uri)).toEqual(photos(4).map((p) => p.uri)); // untouched
  });

  it('movePhoto clamps out-of-range indices', () => {
    const list = photos(3);
    expect(movePhoto(list, 99, 0)[0].uri).toBe(photo(2).uri);
    expect(movePhoto(list, 0, -5)[0].uri).toBe(photo(0).uri);
    expect(movePhoto([], 0, 1)).toEqual([]);
  });

  it('makeCover puts the chosen photo at index 0 (cover invariant)', () => {
    const next = makeCover(photos(4), 3);
    expect(next[0].uri).toBe(photo(3).uri);
    expect(next).toHaveLength(4);
  });

  it('removePhoto removes; removing the cover promotes the next photo', () => {
    const next = removePhoto(photos(3), 0);
    expect(next[0].uri).toBe(photo(1).uri); // new cover by construction
    expect(next).toHaveLength(2);
  });

  it('every operation preserves cover = index 0 as the first element', () => {
    let list = photos(5);
    list = movePhoto(list, 4, 2);
    list = makeCover(list, 3);
    list = removePhoto(list, 1);
    list = mergePhotos(list, [photo(9)], 6);
    // The invariant is structural: whatever sits first IS the cover.
    expect(list[0]).toBeDefined();
    expect(list.map((p) => p.uri)).toHaveLength(new Set(list.map((p) => p.uri)).size);
  });
});

describe('mergePhotos', () => {
  it('appends in selection order, dedupes by uri, clamps to max', () => {
    const merged = mergePhotos(photos(2), [photo(1), photo(2), photo(3), photo(4)], 4);
    expect(merged.map((p) => p.uri)).toEqual([0, 1, 2, 3].map((n) => photo(n).uri));
  });

  it('dedupes within the incoming batch too', () => {
    const merged = mergePhotos([], [photo(0), photo(0), photo(1)], 6);
    expect(merged).toHaveLength(2);
  });

  it('never exceeds max even when existing already equals max', () => {
    expect(mergePhotos(photos(6), [photo(9)], 6)).toHaveLength(6);
  });
});

describe('limit maths', () => {
  it('remainingSlots is the picker selectionLimit', () => {
    expect(remainingSlots(0, 6)).toBe(6);
    expect(remainingSlots(4, 6)).toBe(2);
    expect(remainingSlots(6, 6)).toBe(0);
    expect(remainingSlots(9, 6)).toBe(0);
  });

  it('remainingToMin drives the gentle "add at least N more" copy', () => {
    expect(remainingToMin(0, 3)).toBe(3);
    expect(remainingToMin(1, 3)).toBe(2);
    expect(remainingToMin(3, 3)).toBe(0);
    expect(remainingToMin(5, 3)).toBe(0);
  });
});

describe('removalNeedsConfirm', () => {
  it('confirms only for the cover, and only when another photo remains', () => {
    expect(removalNeedsConfirm(0, 3)).toBe(true);
    expect(removalNeedsConfirm(1, 3)).toBe(false);
    expect(removalNeedsConfirm(5, 6)).toBe(false);
    // Last photo: no "next photo becomes cover" story — no confirm.
    expect(removalNeedsConfirm(0, 1)).toBe(false);
  });
});

describe('grid geometry', () => {
  const WIDTH = 328;
  const GAP = 8;
  const half = (WIDTH - GAP) / 2;

  it('slot 0 is the full-width 4:3 cover row', () => {
    expect(gridCellForIndex(0, WIDTH, GAP)).toEqual({
      x: 0,
      y: 0,
      width: WIDTH,
      height: WIDTH * (3 / 4),
    });
  });

  it('later slots flow left-to-right in two columns under the cover', () => {
    const coverHeight = WIDTH * (3 / 4);
    const tileHeight = half * (3 / 4);
    expect(gridCellForIndex(1, WIDTH, GAP)).toEqual({
      x: 0,
      y: coverHeight + GAP,
      width: half,
      height: tileHeight,
    });
    expect(gridCellForIndex(2, WIDTH, GAP).x).toBe(half + GAP);
    expect(gridCellForIndex(3, WIDTH, GAP).y).toBe(coverHeight + GAP + tileHeight + GAP);
  });

  it('gridHeightForSlots reaches exactly the bottom of the last slot', () => {
    expect(gridHeightForSlots(0, WIDTH, GAP)).toBe(0);
    expect(gridHeightForSlots(1, WIDTH, GAP)).toBe(WIDTH * (3 / 4));
    const cell3 = gridCellForIndex(3, WIDTH, GAP);
    expect(gridHeightForSlots(4, WIDTH, GAP)).toBe(cell3.y + cell3.height);
  });

  it('gridSlotForPoint picks the slot whose centre is nearest', () => {
    const cover = gridCellForIndex(0, WIDTH, GAP);
    expect(gridSlotForPoint(WIDTH / 2, cover.height / 2, 4, WIDTH, GAP)).toBe(0);
    const cell2 = gridCellForIndex(2, WIDTH, GAP);
    expect(
      gridSlotForPoint(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2, 4, WIDTH, GAP),
    ).toBe(2);
    // A point far below everything still lands on the last photo slot.
    expect(gridSlotForPoint(0, 9999, 4, WIDTH, GAP)).toBe(3);
  });
});

describe('displayIndexDuringDrag', () => {
  it('no drag in flight: identity', () => {
    expect(displayIndexDuringDrag(2, -1, -1)).toBe(2);
    expect(displayIndexDuringDrag(2, 3, 3)).toBe(2);
  });

  it('dragging forward shifts the passed-over tiles back by one', () => {
    // from 0 → over 2: dragged shows at 2; tiles 1,2 shift to 0,1; tile 3 stays.
    expect(displayIndexDuringDrag(0, 0, 2)).toBe(2);
    expect(displayIndexDuringDrag(1, 0, 2)).toBe(0);
    expect(displayIndexDuringDrag(2, 0, 2)).toBe(1);
    expect(displayIndexDuringDrag(3, 0, 2)).toBe(3);
  });

  it('dragging backward shifts the passed-over tiles forward by one', () => {
    // from 3 → over 1: dragged shows at 1; tiles 1,2 shift to 2,3; tile 0 stays.
    expect(displayIndexDuringDrag(3, 3, 1)).toBe(1);
    expect(displayIndexDuringDrag(1, 3, 1)).toBe(2);
    expect(displayIndexDuringDrag(2, 3, 1)).toBe(3);
    expect(displayIndexDuringDrag(0, 3, 1)).toBe(0);
  });

  it('matches what movePhoto commits — display preview equals final order', () => {
    const list = photos(5);
    for (let from = 0; from < 5; from += 1) {
      for (let over = 0; over < 5; over += 1) {
        const committed = movePhoto(list, from, over).map((p) => p.uri);
        const previewed = new Array<string>(5);
        for (let index = 0; index < 5; index += 1) {
          previewed[displayIndexDuringDrag(index, from, over)] = list[index].uri;
        }
        expect(previewed).toEqual(committed);
      }
    }
  });
});

describe('resizeTargetFor', () => {
  it('returns null when both edges are within bounds', () => {
    expect(resizeTargetFor(2000, 1500, 2000)).toBeNull();
    expect(resizeTargetFor(800, 600, 2000)).toBeNull();
  });

  it('targets the longest edge only', () => {
    expect(resizeTargetFor(4000, 3000, 2000)).toEqual({ width: 2000 });
    expect(resizeTargetFor(3000, 4000, 2000)).toEqual({ height: 2000 });
    expect(resizeTargetFor(2001, 2001, 2000)).toEqual({ width: 2000 }); // square → width
  });
});

describe('tileAccessibilityLabel', () => {
  it('labels the cover and positions', () => {
    expect(tileAccessibilityLabel(0, 4)).toBe('Cover photo, photo 1 of 4');
    expect(tileAccessibilityLabel(2, 4)).toBe('Photo 3 of 4');
  });

  it('drops the cover wording where the cover concept is hidden (V5C)', () => {
    expect(tileAccessibilityLabel(0, 1, false)).toBe('Photo 1 of 1');
  });
});

describe('photoListSchema', () => {
  const schema = photoListSchema(3, 6);

  it('gates the wizard Next on the minimum and maximum', () => {
    expect(schema.safeParse(photos(2)).success).toBe(false);
    expect(schema.safeParse(photos(3)).success).toBe(true);
    expect(schema.safeParse(photos(6)).success).toBe(true);
    expect(schema.safeParse(photos(7)).success).toBe(false);
  });

  it('rejects malformed assets', () => {
    expect(schema.safeParse([{ uri: '', width: 1, height: 1 }]).success).toBe(false);
    expect(
      schema.safeParse([...photos(2), { uri: 'file:///x.jpg', width: 0, height: 300 }]).success,
    ).toBe(false);
  });

  it('the V5C configuration (min 1, max 1) works', () => {
    const v5c = photoListSchema(1, 1);
    expect(v5c.safeParse([]).success).toBe(false);
    expect(v5c.safeParse(photos(1)).success).toBe(true);
    expect(v5c.safeParse(photos(2)).success).toBe(false);
  });
});
