/**
 * WHAT:  Pure logic for PhotoGridPicker — ordering operations (move, make
 *        cover, remove, merge) that keep "cover = index 0" true, the grid's
 *        slot geometry (index ↔ position, for the drag-to-reorder worklets),
 *        selection-limit maths, resize-target maths, accessibility labels,
 *        and the wizard-facing zod schema.
 * WHY:   The photo list becomes the post's public images and the first entry
 *        becomes the VehicleCard cover, so every mutation of the array lives
 *        here as a pure function the tests can hammer without rendering
 *        (precedent: moneySliderMath.ts). Geometry functions are worklets so
 *        the drag gesture can call them on the UI thread.
 * LINKS: src/shared/ui/PhotoGridPicker.tsx (consumer);
 *        src/shared/wizard/types.ts (schema gates the wizard's Next);
 *        docs/DESIGN_SYSTEM.md (grid, motion).
 */

import { z } from 'zod';

/** One selected local photo. The component never uploads — consumers do. */
export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

/** The grid's fixed shape: a full-width cover row, then two columns. */
export const GRID_COLUMNS = 2;
/** Tile shape matches the VehicleCard photo (width / height). */
export const PHOTO_ASPECT_RATIO = 4 / 3;

/** A slot's rectangle inside the grid, in layout points. */
export interface GridCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rect for a slot index: slot 0 is the full-width cover row; the rest flow
 *  left-to-right in two columns beneath it. */
export function gridCellForIndex(index: number, containerWidth: number, gap: number): GridCell {
  'worklet';
  const coverHeight = containerWidth / PHOTO_ASPECT_RATIO;
  if (index <= 0) {
    return { x: 0, y: 0, width: containerWidth, height: coverHeight };
  }
  const n = index - 1;
  const column = n % GRID_COLUMNS;
  const row = Math.floor(n / GRID_COLUMNS);
  const width = (containerWidth - gap) / GRID_COLUMNS;
  const height = width / PHOTO_ASPECT_RATIO;
  return {
    x: column * (width + gap),
    y: coverHeight + gap + row * (height + gap),
    width,
    height,
  };
}

/** Total height the grid needs to show `slotCount` slots (photos + pending
 *  placeholders + the add tile). Zero slots need zero height. */
export function gridHeightForSlots(slotCount: number, containerWidth: number, gap: number): number {
  'worklet';
  if (slotCount <= 0) {
    return 0;
  }
  const last = gridCellForIndex(slotCount - 1, containerWidth, gap);
  return last.y + last.height;
}

/** The slot whose centre is nearest a point — where a dragged tile would
 *  land. Only photo slots (0..photoCount-1) are candidates. */
export function gridSlotForPoint(
  x: number,
  y: number,
  photoCount: number,
  containerWidth: number,
  gap: number,
): number {
  'worklet';
  let best = 0;
  let bestDistance = Number.MAX_VALUE;
  for (let index = 0; index < photoCount; index += 1) {
    const cell = gridCellForIndex(index, containerWidth, gap);
    const dx = cell.x + cell.width / 2 - x;
    const dy = cell.y + cell.height / 2 - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

/** Where a tile should DISPLAY while a drag is in flight: the dragged tile
 *  shows at the hovered slot and the tiles between shift by one to make room.
 *  `from === -1` means no drag — every tile sits at its own index. */
export function displayIndexDuringDrag(index: number, from: number, over: number): number {
  'worklet';
  if (from < 0 || from === over) {
    return index;
  }
  if (index === from) {
    return over;
  }
  if (from < over && index > from && index <= over) {
    return index - 1;
  }
  if (from > over && index >= over && index < from) {
    return index + 1;
  }
  return index;
}

/** Move a photo between positions. Out-of-range indices clamp; the returned
 *  array is new and index 0 is always the cover. */
export function movePhoto(photos: PickedPhoto[], from: number, to: number): PickedPhoto[] {
  const lastIndex = photos.length - 1;
  const fromIndex = Math.min(lastIndex, Math.max(0, from));
  const toIndex = Math.min(lastIndex, Math.max(0, to));
  if (photos.length === 0 || fromIndex === toIndex) {
    return [...photos];
  }
  const next = [...photos];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** Promote a photo to cover (index 0). */
export function makeCover(photos: PickedPhoto[], index: number): PickedPhoto[] {
  return movePhoto(photos, index, 0);
}

/** Remove a photo. When the cover is removed, the next photo becomes cover
 *  simply by taking index 0 — the invariant holds by construction. */
export function removePhoto(photos: PickedPhoto[], index: number): PickedPhoto[] {
  return photos.filter((_, photoIndex) => photoIndex !== index);
}

/** Append newly picked photos: same-uri duplicates are dropped, order of the
 *  incoming selection is preserved, and the result never exceeds max. NOTE:
 *  this only catches unprocessed duplicates — a resized photo gets a fresh
 *  cache uri, so re-picking the same oversized gallery photo is NOT deduped. */
export function mergePhotos(
  existing: PickedPhoto[],
  incoming: PickedPhoto[],
  maxPhotos: number,
): PickedPhoto[] {
  const seen = new Set(existing.map((photo) => photo.uri));
  const fresh = incoming.filter((photo) => {
    if (seen.has(photo.uri)) {
      return false;
    }
    seen.add(photo.uri);
    return true;
  });
  return [...existing, ...fresh].slice(0, Math.max(0, maxPhotos));
}

/** How many more photos may be added — the picker's `selectionLimit`. */
export function remainingSlots(count: number, maxPhotos: number): number {
  return Math.max(0, maxPhotos - count);
}

/** How many more photos are needed before the step is valid. */
export function remainingToMin(count: number, minPhotos: number): number {
  return Math.max(0, minPhotos - count);
}

/** Removing the cover changes the post's public face — that one confirms.
 *  With a single photo there is no "next photo becomes your cover" story to
 *  tell, so the confirm (and its copy) would mislead: just remove. */
export function removalNeedsConfirm(index: number, count: number): boolean {
  return index === 0 && count > 1;
}

/** Resize instruction for expo-image-manipulator, or null when the photo is
 *  already within bounds. Only the longest edge is given; the manipulator
 *  preserves aspect ratio for the other. */
export function resizeTargetFor(
  width: number,
  height: number,
  maxEdge: number,
): { width: number } | { height: number } | null {
  if (width <= maxEdge && height <= maxEdge) {
    return null;
  }
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/** Screen-reader label for a photo tile. Cover wording is skipped where the
 *  cover concept is hidden (single-photo configurations like the V5C). */
export function tileAccessibilityLabel(
  index: number,
  count: number,
  withCoverPrefix = true,
): string {
  const base = `Photo ${index + 1} of ${count}`;
  return index === 0 && withCoverPrefix ? `Cover photo, ${base.toLowerCase()}` : base;
}

/** Form-level validation for a wizard step's photo answer: an ordered list
 *  of local assets, at least min and at most max. */
export function photoListSchema(minPhotos: number, maxPhotos: number) {
  return z
    .array(
      z.object({
        uri: z.string().min(1),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    )
    .min(minPhotos)
    .max(maxPhotos);
}
