/**
 * WHAT:  The pending "change which list this car is saved to" intent — set by
 *        the Change action on the save toast (and by Move on a collection
 *        card), consumed by the root-mounted CollectionPickerSheet.
 * WHY:   A module store rather than a React context, deliberately. The toast
 *        outlives the card that raised it — it is rendered at the app root and
 *        its action fires after the feed cell may already be recycled — so
 *        there is no component tree to hang a provider from at the moment the
 *        user taps Change.
 *
 *        It also makes "nothing happens if no sheet is mounted" the DEFAULT
 *        rather than a special case: a context would either throw (crashing a
 *        save, which this feature may never do) or need a no-op fallback that
 *        every test has to remember. Setting an intent nobody reads is
 *        harmless by construction.
 *
 *        In memory only, never serialised: a picker that opened on next launch
 *        would be a question about a car the user has long stopped thinking
 *        about.
 * LINKS: src/features/garage/lib/exitNudgeIntent.ts (the shape this copies);
 *        src/features/watchlist/components/CollectionPickerSheet.tsx (the
 *          consumer); src/features/watchlist/hooks/useWatchToggle.ts (setter).
 */

import { useSyncExternalStore } from 'react';

import type { CollectionId } from '../types';

export interface CollectionPickerIntent {
  postId: string;
  /** Where the car is filed right now — the row that shows a check. */
  currentCollectionId: CollectionId;
  /** Which surface asked, for the funnel logs. */
  source: 'save_toast' | 'collection_card';
}

let pending: CollectionPickerIntent | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): CollectionPickerIntent | null {
  return pending;
}

/** Ask for the picker. A second request replaces the first — the user can only
 *  be re-filing one car at a time, and the newest tap is the one they mean. */
export function requestCollectionPicker(intent: CollectionPickerIntent): void {
  pending = intent;
  notify();
}

/** Drop the intent — the sheet closed, however it closed. */
export function clearCollectionPicker(): void {
  if (pending === null) {
    return;
  }
  pending = null;
  notify();
}

export function useCollectionPickerIntent(): CollectionPickerIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Non-reactive read, for callers outside a component (and for tests). */
export function getCollectionPickerIntent(): CollectionPickerIntent | null {
  return pending;
}

/** Test seam — module state outlives a single test file otherwise. */
export function resetCollectionPickerForTests(): void {
  pending = null;
}
