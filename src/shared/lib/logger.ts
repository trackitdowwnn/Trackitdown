/**
 * WHAT:  The shared structured logger for the entire app — levelled,
 *        feature-tagged, privacy-redacting, with a ring buffer for
 *        device debugging and a pluggable sink for Sentry later.
 * WHY:   One consistent log format makes the app's behaviour readable
 *        by humans AND by Claude Code during debugging, and gives one
 *        central place to enforce privacy rules. Raw console.log is
 *        banned in app code (ESLint no-console) — this is the only file
 *        allowed to call it.
 *        Level: EXPO_PUBLIC_LOG_LEVEL (default debug in dev, info in a
 *        release build). Redaction mirrors the server's
 *        supabase/functions/_shared/redact.ts (keys at any depth up to 5,
 *        plus secret-shaped text); logger.test.ts pins the two together.
 * LINKS: docs/LOGGING.md (the standard — read it before logging),
 *        docs/SECURITY_AND_TRUST.md (privacy rules enforced here),
 *        docs/logging-decisions.md.
 */

 

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

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** EXPO_PUBLIC_LOG_LEVEL, read once (Expo inlines it at build time). */
export function thresholdFor(setting: string | undefined, dev: boolean): number {
  const level = setting?.toLowerCase();
  if (level && Object.hasOwn(LEVEL_RANK, level)) return LEVEL_RANK[level as LogLevel];
  return LEVEL_RANK[dev ? "debug" : "info"];
}
const threshold = thresholdFor(process.env.EXPO_PUBLIC_LOG_LEVEL, __DEV__);

// Data keys auto-masked as a safety net. Backstop only — never rely on
// this instead of simply not logging sensitive values. SAFETY: see
// docs/LOGGING.md privacy rules. ⚠️ The same list as the server's redact.ts.
export const SENSITIVE_KEY_PATTERN =
  /token|secret|password|passwd|authorization|cookie|key$|email|phone|iban|account_?number|sort_?code|lat$|lng$|latitude|longitude|coord|plate|address|postcode|birth|dob|url|link|content|nickname|note|body/i;

/** A number under one of these is a count, and kept (the server's rule). */
const COUNT_KEY = /(count|purged|sent|emailed|removed|skipped|total)$/i;

const MASK = "[REDACTED]";
const MAX_DEPTH = 5;

/** Secret-shaped text, masked wherever it appears (the server's list). */
const SECRET_TEXT: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK],
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, MASK],
  [/\bwhsec_[A-Za-z0-9]+/g, MASK],
  [/\b\w*_secret_\w+/g, MASK],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${MASK}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MASK],
  [/([?&](?:token|sig|signature|x-amz-signature)=)[^&\s"']+/gi, `$1${MASK}`],
  [/\b[A-Z]{2}[0-9]{2} ?[A-Z]{3}\b/g, MASK],
];

function scrubText(text: string): string {
  return SECRET_TEXT.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

const RING_BUFFER_SIZE = 300;
const ringBuffer: LogEntry[] = [];
const sinks: LogSink[] = [];

/** Masks sensitive keys at any depth up to 5, and secret-shaped text. Backstop, not a licence. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: scrubText(value.message) };
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const isCount = typeof item === "number" && COUNT_KEY.test(key);
    const isFlag = typeof item === "boolean" || item === null || item === undefined;
    out[key] = SENSITIVE_KEY_PATTERN.test(key) && !isCount && !isFlag ? MASK : redactValue(item, depth + 1);
  }
  return out;
}

function redactData(data: Record<string, unknown>): Record<string, unknown> {
  try {
    return redactValue(data) as Record<string, unknown>;
  } catch {
    return { redaction: "failed" };
  }
}

function emit(level: LogLevel, feature: string, message: string, data?: Record<string, unknown>): void {
  // Below the configured level (debug never runs in a release build by default).
  if (LEVEL_RANK[level] < threshold) return;

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

/**
 * Masks an email for logging: "oliver.best3@gmail.com" → "o***@gmail.com".
 * SAFETY: an email address is personal data (UK GDPR) and never appears in
 * logs in full — keep only the first local char + the domain (enough to debug
 * deliverability, not enough to identify the person). Non-emails → "***".
 */
export function redactEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}
