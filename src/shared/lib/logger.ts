/**
 * WHAT:  The shared structured logger for the entire app — levelled,
 *        feature-tagged, privacy-redacting, with a ring buffer for
 *        device debugging and a pluggable sink for Sentry later.
 * WHY:   One consistent log format makes the app's behaviour readable
 *        by humans AND by Claude Code during debugging, and gives one
 *        central place to enforce privacy rules. Raw console.log is
 *        banned in app code (ESLint no-console) — this is the only file
 *        allowed to call it.
 * LINKS: docs/LOGGING.md (the standard — read it before logging),
 *        docs/SECURITY_AND_TRUST.md (privacy rules enforced here).
 */

/* eslint-disable no-console -- this is the one sanctioned console user */

type LogLevel = "debug" | "info" | "warn" | "error";

/** One captured log entry, kept in the ring buffer for device debugging. */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  feature: string;
  message: string;
  data?: Record<string, unknown>;
}

/** A destination for log entries beyond the console (e.g. Sentry in prod). */
export type LogSink = (entry: LogEntry) => void;

// Emoji prefixes render reliably in Metro, device logs, and CI — this is
// the portable "colour coding". DevTools adds native warn/error colours.
const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "🐛 DEBUG",
  info: "ℹ️ INFO ",
  warn: "⚠️ WARN ",
  error: "🔴 ERROR",
};

const CONSOLE_METHOD: Record<LogLevel, "log" | "warn" | "error"> = {
  debug: "log",
  info: "log",
  warn: "warn",
  error: "error",
};

// Data keys auto-masked as a safety net. Backstop only — never rely on
// this instead of simply not logging sensitive values. SAFETY: see
// docs/LOGGING.md privacy rules.
const SENSITIVE_KEY_PATTERN = /token|password|secret|authorization|apikey|api_key/i;

const RING_BUFFER_SIZE = 300;
const ringBuffer: LogEntry[] = [];
const sinks: LogSink[] = [];

/** Masks sensitive-looking keys one level deep. Backstop, not a licence. */
function redactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return out;
}

function emit(level: LogLevel, feature: string, message: string, data?: Record<string, unknown>): void {
  // Debug logs never run in production builds.
  if (level === "debug" && !__DEV__) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    feature,
    message,
    data: data ? redactData(data) : undefined,
  };

  // Ring buffer: keep the last N entries for the dev "copy logs" action.
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();

  // Console output — the single consistent line format from LOGGING.md.
  const line = `${LEVEL_PREFIX[level]} [${feature}] ${message}`;
  const method = CONSOLE_METHOD[level];
  if (entry.data !== undefined) console[method](line, entry.data);
  else console[method](line);

  // Forward to any registered sinks (e.g. Sentry in Phase 5).
  for (const sink of sinks) {
    try {
      sink(entry);
    } catch {
      // A broken sink must never break the app; console already has the log.
    }
  }
}

/**
 * Creates a feature-scoped logger. Call once at the top of a feature's
 * api/hook files with the feature folder name as the tag.
 *
 * @example
 * const log = createLogger("sightings");
 * log.info("Sighting submitted", { postId, hasPhoto: true });
 */
export function createLogger(feature: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => emit("debug", feature, message, data),
    info: (message: string, data?: Record<string, unknown>) => emit("info", feature, message, data),
    warn: (message: string, data?: Record<string, unknown>) => emit("warn", feature, message, data),
    error: (message: string, data?: Record<string, unknown>) => emit("error", feature, message, data),
  };
}

/**
 * Registers an extra log destination (production error reporting).
 * Phase 5 wires Sentry here — call sites never change.
 */
export function addLogSink(sink: LogSink): void {
  sinks.push(sink);
}

/** Returns a copy of recent entries — powers the dev "copy logs" action. */
export function getRecentLogs(): LogEntry[] {
  return [...ringBuffer];
}

/** Recent logs as text, ready for the clipboard / pasting into a chat. */
export function formatRecentLogs(): string {
  return ringBuffer
    .map((e) => `${e.timestamp} ${LEVEL_PREFIX[e.level]} [${e.feature}] ${e.message}${e.data ? " " + JSON.stringify(e.data) : ""}`)
    .join("\n");
}

/**
 * Redacts a UK plate for logging: "AB12 CDE" → "AB12***".
 * SAFETY: full plates are personal data and never appear in logs.
 */
export function redactPlate(plate: string): string {
  const compact = plate.replace(/\s+/g, "");
  return compact.length <= 4 ? "***" : `${compact.slice(0, 4)}***`;
}

/**
 * Coarsens coordinates for logging to ~1km precision (2 decimal places).
 * SAFETY: precise locations live in the database, never in logs.
 */
export function redactLocation(lat: number, lng: number): string {
  return `~(${lat.toFixed(2)}, ${lng.toFixed(2)})`;
}
