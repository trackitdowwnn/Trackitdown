/**
 * WHAT:  The onboarding completion funnel — a run id held in memory, and one
 *        fire-and-forget call per step reached.
 * WHY:   The intro was redesigned on a reference spec and a judgement call,
 *        with no measurement on either side of it. This answers the plainest
 *        question available: of the people who see slide 1, how many reach the
 *        end, and which slide loses the rest.
 *
 *        ⚠️ THE RUN ID IS NEVER PERSISTED, AND THAT IS THE WHOLE DESIGN. It is
 *        generated when the intro opens, lives in one module-level variable,
 *        and is thrown away when the run ends. It is not a device id, not an
 *        install id, and not a session. Two runs by the same person are
 *        unlinkable; a run is unlinkable to the account they may later create.
 *        Onboarding happens BEFORE sign-in, so this is data collected from
 *        somebody who has not agreed to anything — being unable to follow them
 *        is what makes collecting it defensible at all.
 *
 *        ⚠️ IF YOU EVER WRITE THIS TO AsyncStorage, STOP. That one change turns
 *        an anonymous counter into tracking of a person who has not signed up,
 *        and every argument in the migration header stops holding. There is a
 *        real temptation here — a persistent id would let you tell repeat
 *        launches apart and link the funnel to sign-ups, and it was considered
 *        and declined (owner call, 2026-08-24).
 *
 *        ⚠️ NEVER THROWS, NEVER BLOCKS, NEVER AWAITS. Somebody reading four
 *        slides must not see a spinner, an error, or a delay because a counter
 *        did not write. Every call here is fire-and-forget and every failure is
 *        swallowed — the cost of a lost row is a slightly wrong number, and the
 *        cost of the alternative is a broken first impression.
 * LINKS: supabase/migrations/20260824190000_onboarding_funnel.sql (the table
 *          and the RPC, and why anon may write to it);
 *        ../screens/OnboardingScreen.tsx (the only caller).
 */

import { Platform } from 'react-native';

import { supabase } from '@/shared/api';

/** The steps the funnel counts. Mirrors the migration's CHECK. */
export type OnboardingFunnelStep = 'slide_viewed' | 'completed' | 'skipped';

/**
 * The current run, or null between runs.
 *
 * Module-level rather than React state on purpose: the id must survive a
 * re-render and must NOT survive the app being closed.
 */
let runId: string | null = null;

/**
 * A v4-shaped random id.
 *
 * ⚠️ DELIBERATELY NOT CRYPTOGRAPHIC — `Math.random`, no dependency added. It
 * says "uuid" and someone will assume otherwise, so: the only property needed
 * here is that two runs almost never collide. Unguessability buys nothing,
 * because guessing a run id lets you add a row to a table of counters that
 * holds nothing about anyone — which a caller can already do by inventing a
 * fresh id. If this value ever becomes a key to something that matters, it
 * needs a real source first.
 */
function randomRunId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Web is not a target for the funnel; the column accepts these two only. */
function platform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

/**
 * Begin a run. Safe to call again — a second call while one is open is a
 * re-mount, not a new journey, and keeps the id it already had.
 */
export function startOnboardingRun(): void {
  if (runId === null) runId = randomRunId();
}

/** End the run and forget the id. */
export function endOnboardingRun(): void {
  runId = null;
}

/**
 * Record one step. Does nothing if no run is open — which is the case in
 * revisit mode, where somebody is re-reading the intro from Settings and must
 * not be counted as a fresh journey through it.
 */
export function trackOnboardingStep(step: OnboardingFunnelStep, slide?: number): void {
  if (runId === null) return;

  // Swallowed on purpose — see the header. Not even logged: a warning per step
  // would fill the log tail of a screen whose whole job is to make a first
  // impression, and there is nothing a reader could do about it.
  //
  // Wrapped rather than `.catch`ed directly: the builder is a PromiseLike, not
  // a Promise, so it has no `.catch` to hang the handler on — and an unhandled
  // rejection here would surface as a red box over the first thing anyone sees.
  void (async () => {
    try {
      await supabase.rpc('record_onboarding_step', {
        p_run_id: runId,
        p_step: step,
        p_slide: step === 'slide_viewed' ? (slide ?? null) : null,
        p_platform: platform(),
      });
    } catch {
      // Deliberately empty.
    }
  })();
}

/** Test seam — clears the run between cases. */
export function resetOnboardingRunForTests(): void {
  runId = null;
}
