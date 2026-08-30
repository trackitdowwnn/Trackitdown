/**
 * WHAT:  The production log sink — the thing that was missing. Registers with
 *        `addLogSink` at app start, buffers the funnel events and errors that
 *        already exist across the app, and flushes them in batches to
 *        `record_telemetry_events`.
 * WHY:   ROADMAP critical path item #2. 86 distinct snake_case funnel events
 *        are already instrumented as `log.info('event_name', {...})` —
 *        gate_shown, feed_load, otp_verified, garage_nudge_shown and 82 more —
 *        and every one of them dies in the Metro console, because nothing ever
 *        registered a sink. logger.ts was built for exactly this: one
 *        registration turns all 86 on with ZERO call-site changes. Until it
 *        landed, ROADMAP's own words applied: "every product judgement in this
 *        file is a guess".
 *
 *        ⚠️ THE SESSION ID IS NEVER PERSISTED, AND THAT IS THE WHOLE DESIGN.
 *        Same contract as onboardingFunnel's run id, and the same warning: if
 *        you ever write this to AsyncStorage or SecureStore, stop. That one
 *        change turns an anonymous counter into tracking of a person. There is
 *        no user id here either, deliberately — see the migration header for
 *        why, and for what adding one would cost.
 *
 *        ⚠️ NEVER THROWS, NEVER BLOCKS, NEVER AWAITS ON A USER PATH. A counter
 *        that fails to write must be invisible. Every failure is swallowed and
 *        the cost is a slightly wrong number.
 *
 *        ⚠️ NEVER LOGS. Not once, not even on failure. This module is called
 *        BY the logger, so a `log.warn` in here would be re-entrant: the entry
 *        it emits arrives back at this sink, buffers, fails to flush, logs
 *        again. `FEATURE` below is excluded from capture as a second belt on
 *        the same hazard, but the first rule is simply not to log.
 * LINKS: ./logger.ts (addLogSink — the seam this fills);
 *        supabase/migrations/20260830120000_telemetry_sink.sql (the table, the
 *          RPC, and why anon may write to it);
 *        src/features/auth/lib/onboardingFunnel.ts (the fire-and-forget
 *          pattern this follows); docs/ROADMAP.md (critical path #2);
 *        docs/LOGGING.md; docs/SECURITY_AND_TRUST.md §2.
 */

import Constants from 'expo-constants';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

import { supabase } from '@/shared/api';

import { addLogSink, type LogEntry } from './logger';

/** This module's own logger tag. Entries from it are never captured. */
const FEATURE = 'telemetry';

/** Flush when the buffer reaches this. Matches the RPC's per-call cap. */
const BATCH_SIZE = 50;

/** …or when this long has passed, so a quiet session still reports. */
const FLUSH_INTERVAL_MS = 30_000;

/**
 * Hard ceiling on the buffer. If flushes are failing (offline, say) events
 * still arrive, and an unbounded array on a phone is a memory leak. At the cap
 * the OLDEST are dropped: the newest events are the ones nearest whatever went
 * wrong, and are worth more than the start of a session that is already lost.
 */
const MAX_BUFFERED = 200;

/**
 * A funnel event name — `log.info('feed_load', …)`. The convention that
 * separates an EVENT from a prose message, which is the only thing telling
 * them apart: `log.info('Sighting submitted', …)` is prose and is not sent.
 */
const EVENT_NAME = /^[a-z][a-z0-9_]{2,63}$/;

/**
 * ⚠️ SAFETY: keys that must never leave the device, dropped from every props
 * bag. The server enforces shape (scalars, 8 keys, 200 chars) but it cannot
 * know that `lat` means a coordinate — this is the half of the contract only
 * the client can keep.
 *
 * On a stolen-car app the two that matter most are a LOCATION and a PLATE:
 * either one turns an anonymous counter into a record of where a specific car
 * was. Matched as substrings, case-insensitively, so `lastSeenLat`,
 * `origin_lng` and `plateCanon` are all caught.
 */
const DENIED_KEY = /lat|lng|long|coord|plate|email|phone|address|postcode|token|secret|password/i;

interface QueuedEvent {
  event: string;
  feature: string;
  level: 'info' | 'error';
  props: Record<string, string | number | boolean>;
  platform: 'ios' | 'android' | null;
  app_version: string | null;
}

let sessionId: string | null = null;
let buffer: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: NativeEventSubscription | null = null;
let installed = false;
/**
 * One flush at a time. Two concurrent flushes would both take from the buffer
 * and both restore on failure, duplicating events. This guards ONLY that — it
 * is not a re-entrancy guard, and must not be used to gate `capture`.
 */
let flushing = false;

/**
 * A v4-shaped random id.
 *
 * ⚠️ DELIBERATELY NOT CRYPTOGRAPHIC, for the same reason as
 * onboardingFunnel.randomRunId: the only property needed is that two sessions
 * almost never collide. Guessing one lets you add a row to a table of counters
 * that holds nothing about anyone — which a caller can already do by inventing
 * a fresh id. If this ever becomes a key to something that matters, it needs a
 * real source first.
 */
function randomSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Web is not a target; the column accepts these two only. */
function platform(): 'ios' | 'android' | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

function appVersion(): string | null {
  const version = Constants.expoConfig?.version;
  // The column is format-checked to x.y.z; anything else is dropped rather
  // than sent to be rejected server-side.
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
}

/**
 * Reduce a log entry's `data` to what may leave the device: scalars only, at
 * most 8 keys, denied keys removed, strings truncated. Mirrors the migration's
 * trigger, and is deliberately the STRICTER of the two — the server rejects a
 * bad bag, this one quietly shapes it, so a valid event is never lost to a
 * field nobody cared about.
 */
export function sanitiseProps(
  data: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!data) return out;

  for (const [key, value] of Object.entries(data)) {
    if (Object.keys(out).length >= 8) break;
    if (DENIED_KEY.test(key)) continue;
    // The server's key rule. Anything else is dropped rather than renamed:
    // a mangled key is worse than a missing one when someone reads this back.
    if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;

    if (typeof value === 'boolean' || typeof value === 'number') {
      // NaN and Infinity are not valid JSON and would fail the insert.
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > 200 ? value.slice(0, 200) : value;
    }
    // Objects, arrays, null and undefined are dropped: the trigger rejects
    // them, and a dropped field costs less than a dropped event.
  }
  return out;
}

/**
 * Should this entry be sent at all?
 *
 * Two things go: funnel events (an `info` whose message is a snake_case event
 * name) and errors (all of them, regardless of message shape — an error is
 * worth having even when its message is a sentence). Everything else stays in
 * the console and the ring buffer, which is where prose belongs.
 */
export function shouldCapture(entry: LogEntry): boolean {
  if (entry.feature === FEATURE) return false; // Re-entrancy. See the header.
  if (entry.level === 'error') return true;
  return entry.level === 'info' && EVENT_NAME.test(entry.message);
}

/**
 * Turn an error entry's prose message into something that fits the event
 * column's format check. `"Sighting submit failed"` becomes
 * `error_sighting_submit_failed`, truncated to 64 chars.
 */
function eventNameFor(entry: LogEntry): string {
  if (entry.level === 'error') {
    const slug = entry.message
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `error_${slug || 'unnamed'}`.slice(0, 64);
  }
  return entry.message;
}

/**
 * The sink itself. Buffers; never awaits; never throws.
 *
 * ⚠️ DOES NOT SKIP WHILE A FLUSH IS IN FLIGHT, deliberately. An earlier draft
 * had `if (flushing) return` here as a second re-entrancy belt, and it was
 * wrong: a flush is a network round trip, so that dropped every event from
 * every OTHER feature for as long as it took — silently, and worst exactly
 * when the network is slow and the events matter most. Re-entrancy is handled
 * where it actually arises, by `shouldCapture` refusing this module's own
 * feature, and by this module never logging at all.
 */
function capture(entry: LogEntry): void {
  if (!shouldCapture(entry)) return;

  buffer.push({
    event: eventNameFor(entry),
    feature: entry.feature,
    level: entry.level === 'error' ? 'error' : 'info',
    props: sanitiseProps(entry.data),
    platform: platform(),
    app_version: appVersion(),
  });

  // Drop the OLDEST past the ceiling — see MAX_BUFFERED.
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
  if (buffer.length >= BATCH_SIZE) void flush();
}

/**
 * Send what is buffered. Safe to call at any time and safe to call twice.
 *
 * The buffer is taken BEFORE the await and restored on failure, so events that
 * arrive mid-flight are not lost and a failed batch is retried on the next
 * flush rather than dropped. Restored at the FRONT, so ordering survives.
 */
export async function flush(): Promise<void> {
  if (flushing || buffer.length === 0 || sessionId === null) return;

  const batch = buffer.slice(0, BATCH_SIZE);
  buffer = buffer.slice(BATCH_SIZE);
  flushing = true;

  try {
    const { error } = await supabase.rpc('record_telemetry_events', {
      p_session_id: sessionId,
      p_events: batch,
    });
    if (error) {
      buffer = [...batch, ...buffer].slice(-MAX_BUFFERED);
    }
  } catch {
    // Deliberately empty, and deliberately not logged — see the header.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFERED);
  } finally {
    flushing = false;
  }
}

/**
 * Register the sink. Call ONCE, as early as possible — events emitted before
 * this are not captured, so anything before it in the startup sequence is
 * invisible to the funnel.
 *
 * Idempotent: a second call is a Fast Refresh, not a second session, and must
 * not register a second sink or mint a new id.
 */
export function installTelemetrySink(): void {
  if (installed) return;
  installed = true;
  sessionId = randomSessionId();

  addLogSink(capture);

  timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);

  // Backgrounding is the last reliable moment to send: the interval stops
  // firing and the process may not come back. This is what makes the final
  // events of a session — the ones nearest whatever made someone leave —
  // arrive at all.
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') void flush();
  });
}

/** Test seam — unregisters nothing (logger has no removal API), resets state. */
export function resetTelemetryForTests(): void {
  if (timer !== null) clearInterval(timer);
  appStateSub?.remove();
  timer = null;
  appStateSub = null;
  buffer = [];
  sessionId = null;
  installed = false;
  flushing = false;
}

/** Test seam — what is waiting to be sent. */
export function bufferedForTests(): QueuedEvent[] {
  return [...buffer];
}

/** Test seam — drives capture without going through the logger. */
export function captureForTests(entry: LogEntry): void {
  capture(entry);
}

/** Test seam — installs with a known session id, skipping timers. */
export function installForTests(id: string): void {
  installed = true;
  sessionId = id;
  addLogSink(capture);
}
