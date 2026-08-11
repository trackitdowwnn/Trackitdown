/**
 * WHAT:  startupTrace — marks the phases of a cold start and emits ONE
 *        `startup_trace` line the first time the feed paints.
 * WHY:   "The app is slow to load" was, until now, unfalsifiable. Only two
 *        calls on the boot path were timed (`feed_load`, `garage_load`), and
 *        the phases before them — font loading, which BLOCKS first paint by
 *        design (src/app/_layout.tsx returns null until the four Satoshi faces
 *        resolve), session restore, and location resolution — were dark. You
 *        cannot fix a startup you cannot see, and the obvious culprit is
 *        usually not the slow one: the feed's own RPC measured ~950ms on
 *        device while the garage call, which the Explore tab never renders,
 *        measured ~1,400ms.
 *
 *        Marks are cumulative-from-JS-start rather than deltas, because the
 *        phases overlap (location resolves while fonts load) and a list of
 *        deltas would imply a sequence that isn't real. `sinceJsStart` is the
 *        number that matters per phase; `total` is what the user actually
 *        waited.
 *
 *        Kept in the app rather than used once and deleted: a startup budget
 *        only holds if something keeps measuring it. One info line per launch
 *        is well inside the boundaries docs/LOGGING.md asks for.
 *
 * ⚠️ ONE TRACE PER JS CONTEXT, NOT PER LAUNCH IN DEV. Fast Refresh preserves
 *        module state, so `flushed` survives a reload and a second trace never
 *        fires — observed 2026-08-11, where a relaunch produced no trace at
 *        all. To re-measure in dev you need a full bundle reload (`r` in Metro
 *        or a cold start after `--clear`), not a hot reload. In production
 *        every launch is a fresh context, so this does not apply there.
 *
 * ⚠️ DEV NUMBERS ARE NOT PRODUCTION NUMBERS. Over Metro, `fonts_ready` is
 *        dominated by bundle download — it measured ~15.8s on device where a
 *        release build would be a fraction of that. Read the SHAPE (which
 *        phase owns the gap), not the totals.
 *
 * PRIVACY: phase names and millisecond durations only — never a coordinate, an
 *        id, or anything about what was loaded. Nothing here is user data.
 * LINKS: src/shared/lib/logger.ts; docs/LOGGING.md;
 *        src/app/_layout.tsx (fonts + splash handover).
 *
 * Usage:
 *   markStartup('fonts_ready');
 *   ...
 *   markStartup('feed_first_paint');   // the last mark flushes the trace
 */

import { createLogger } from './logger';

const log = createLogger('startup');

/**
 * The phases, in the order they are EXPECTED to complete. Declared as a list so
 * the emitted object has a stable key order however they actually land — an
 * out-of-order boot should be visible in the numbers, not hidden by them.
 */
const PHASES = [
  'fonts_ready',
  'session_ready',
  'location_ready',
  'feed_loaded',
  'feed_first_paint',
] as const;

export type StartupPhase = (typeof PHASES)[number];

/** The phase whose arrival flushes the trace — the moment the user sees cars. */
const FINAL_PHASE: StartupPhase = 'feed_first_paint';

/**
 * Module evaluation is the earliest moment JS runs, which is the closest thing
 * to "app start" reachable without native instrumentation. It UNDERSTATES the
 * true cold start — the native process, the OS splash and bundle load all
 * happen before this file is evaluated — so treat `total` as a floor, not a
 * measurement of what the user waited from tapping the icon.
 */
const jsStartedAt = Date.now();

const marks = new Map<StartupPhase, number>();
let flushed = false;

/**
 * Record a phase. Idempotent per phase: the FIRST arrival wins, so a remount
 * (a reload, a re-render, a screen revisited) cannot rewrite history or emit a
 * second trace.
 */
export function markStartup(phase: StartupPhase): void {
  if (flushed || marks.has(phase)) {
    return;
  }
  marks.set(phase, Date.now() - jsStartedAt);

  if (phase === FINAL_PHASE) {
    flushed = true;
    log.info('startup_trace', {
      // Cumulative ms from the first line of JS. A phase that never fired is
      // reported as null rather than omitted — a missing phase is itself a
      // finding, and dropping the key would hide it.
      ...Object.fromEntries(PHASES.map((name) => [name, marks.get(name) ?? null])),
      total: marks.get(FINAL_PHASE) ?? null,
    });
  }
}

/** Testing seam only — resets the module's one-shot state. */
export function __resetStartupTrace(): void {
  marks.clear();
  flushed = false;
}
