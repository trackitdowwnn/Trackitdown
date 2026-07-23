/**
 * WHAT:  The pending-intent store — the deferred-auth heart. When a guest taps
 *        a gated action, the action is stored here as a continuation and the
 *        AuthSheet opens; on auth success (session AND profile row confirmed)
 *        the intent is consumed and run. Dismissing the sheet clears it.
 * WHY:   ONE mechanism gates every protected action (Airbnb's deferred-auth
 *        pattern): the user finishes what they started without re-tapping. The
 *        continuation is a closure held in memory only — NEVER serialized: it
 *        dies with the JS session, because replaying half-remembered intents
 *        across app restarts is fragile (the user simply re-taps). Module-level
 *        useSyncExternalStore singleton per house convention (useOnboardingGate).
 * LINKS: src/features/auth/gate/useRequireAuth.ts (the only setter path);
 *        src/features/auth/components/AuthSheet.tsx (consumer/resolver);
 *        docs/LOGGING.md ([auth] gate funnel events).
 */

import { useSyncExternalStore } from 'react';

/** Which gate fired — drives the sheet's contextual title AND the funnel logs,
 *  so conversion can be read per action. Extend when a new action gets gated. */
export type GateContext =
  | 'report_sighting'
  | 'message_owner'
  | 'post_car'
  | 'edit_profile'
  | 'watch_post'
  | 'tab_my_cars'
  | 'tab_inbox'
  | 'tab_profile';

/** The sheet is an invitation tied to what the user wanted — never a generic
 *  wall (DESIGN_SYSTEM tone). */
export const GATE_TITLES: Record<GateContext, string> = {
  report_sighting: 'Log in to report a sighting',
  message_owner: 'Log in to message the owner',
  post_car: 'Log in to post your car',
  edit_profile: 'Log in to edit your profile',
  watch_post: 'Log in to watch this car',
  tab_my_cars: 'Log in to see your cars',
  tab_inbox: 'Log in to see your messages',
  tab_profile: 'Log in to see your profile',
};

export interface PendingIntent {
  context: GateContext;
  /** The continuation. Optional — tab invitations need none (the signed-in
   *  content appears reactively). Must read session/profile state at RUN time
   *  (via hooks/supabase), never captured at tap time. */
  run?: () => void;
}

let pending: PendingIntent | null = null;
// The last context that opened the sheet — NOT cleared on consume/clear, so
// the sheet's title survives the close animation (the intent itself is gone
// by then). Only ever replaced by the next gate.
let lastContext: GateContext | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  subscribers.forEach((cb) => cb());
}
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): PendingIntent | null {
  return pending;
}

/** Store the deferred action. One intent at a time — the sheet is modal, so a
 *  newer gate simply replaces a stale one. */
export function setPendingIntent(intent: PendingIntent): void {
  pending = intent;
  lastContext = intent.context;
  notify();
}

/** Take the intent for execution (auth succeeded). Clears the store BEFORE the
 *  caller runs it, so the sheet's onDismiss (which fires after close()) sees
 *  no pending intent and doesn't log a false dismissal. */
export function consumePendingIntent(): PendingIntent | null {
  const taken = pending;
  pending = null;
  notify();
  return taken;
}

/** Drop the intent (sheet dismissed / cancelled). Dropping is graceful and
 *  final — no nagging, no retry prompt. */
export function clearPendingIntent(): void {
  pending = null;
  notify();
}

/** Live view of the pending intent — the AuthSheet opens whenever this is
 *  non-null (and the user isn't already a member). */
export function usePendingIntent(): PendingIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function getLastContextSnapshot(): GateContext | null {
  return lastContext;
}

/** The context of the most recent gate — drives the sheet title, surviving
 *  consume/clear so the header doesn't blank mid-close-animation. */
export function useLastGateContext(): GateContext | null {
  return useSyncExternalStore(subscribe, getLastContextSnapshot);
}
