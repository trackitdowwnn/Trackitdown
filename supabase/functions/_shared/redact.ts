/**
 * WHAT:  Redaction for server log lines. `redact(data)` masks values under
 *        sensitive key names (any depth up to 5) and scrubs secret-shaped text
 *        out of every string; `describeError(err)` turns any thrown value into
 *        a small, safe object — name, code, cause chain, stack frames.
 * WHY:   docs/logging-decisions.md (Conventions → Redaction) and the never-log
 *        list in docs/LOGGING.md. Two nets, because either alone misses: a
 *        key check never sees a token pasted inside an error message, and a
 *        pattern check never sees a sort code under `sortCode`.
 *        ⚠️ A STRIPE ERROR'S MESSAGE IS DROPPED, never scrubbed: it can repeat
 *        the rejected bank value back, in a shape no pattern recognises. Its
 *        type, code and request id are enough to find it in Stripe.
 *        Pure and Deno-free, so Jest loads it (redact.test.ts).
 * LINKS: ./log.ts (the only caller of redact); ./redact.test.ts;
 *        docs/logging-decisions.md; docs/LOGGING.md.
 */

const MASK = '[redacted]';
const MAX_DEPTH = 5;
const MAX_MESSAGE = 300;
const MAX_FRAMES = 15;

/** Keys whose VALUE never reaches a log, whatever it is. */
const SENSITIVE_KEY =
  /token|secret|password|passwd|authorization|cookie|key$|email|phone|iban|account_?number|sort_?code|lat$|lng$|latitude|longitude|coord|plate|address|postcode|birth|dob|url|link|content|nickname|note|body/i;

/** Secret-shaped text, masked wherever it appears in a string. */
const SECRET_TEXT: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK], // JWT
  [/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/g, MASK], // Stripe secret / restricted key
  [/\bwhsec_[A-Za-z0-9]+/g, MASK], // webhook signing secret
  [/\b\w*_secret_\w+/g, MASK], // pi_…_secret_…, seti_…_secret_…, accs_secret__…
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${MASK}`],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, MASK], // email
  [/([?&](?:token|sig|signature|x-amz-signature)=)[^&\s"']+/gi, `$1${MASK}`], // signed links
  [/\b[A-Z]{2}[0-9]{2} ?[A-Z]{3}\b/g, MASK], // a current-format UK plate
];

/** Masks every secret-shaped run in `text`. */
export function scrubText(text: string): string {
  return SECRET_TEXT.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

/** `LOG_REDACT_KEYS=a,b` → a matcher for those exact key names (any case). */
export function extraKeyMatcher(list: string | undefined): RegExp | undefined {
  const names = (list ?? '')
    .split(',')
    .map((name) => name.trim().replace(/[^A-Za-z0-9_-]/g, ''))
    .filter(Boolean);
  return names.length ? new RegExp(`^(?:${names.join('|')})$`, 'i') : undefined;
}

/** A copy of `value` that is safe to log. Never throws on odd input. */
export function redact(value: unknown, extraKeys?: RegExp, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' ? value.toString() : value;
  }
  if (value instanceof Error) return describeError(value);
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (Array.isArray(value)) return value.map((item) => redact(item, extraKeys, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      SENSITIVE_KEY.test(key) || extraKeys?.test(key) ? MASK : redact(item, extraKeys, depth + 1);
  }
  return out;
}

/** True for anything Stripe's SDK threw (StripeCardError, StripeInvalidRequestError, …). */
function isStripeError(err: Record<string, unknown>): boolean {
  return (
    (typeof err.type === 'string' && err.type.startsWith('Stripe')) ||
    typeof err.rawType === 'string'
  );
}

/**
 * Any thrown value — an Error, a Stripe error, a PostgREST `{ message, code }`
 * object, a string — as a small safe object. PostgREST's `details` and `hint`
 * are dropped: they quote the row that failed ("Key (plate)=(…)").
 */
export function describeError(err: unknown, depth = 0): Record<string, unknown> {
  if (err === null || typeof err !== 'object') {
    return { message: scrubText(String(err)).slice(0, MAX_MESSAGE) };
  }
  const e = err as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof e.name === 'string') out.name = e.name;

  if (isStripeError(e)) {
    for (const key of ['type', 'code', 'decline_code', 'statusCode'] as const) {
      if (e[key] !== undefined) out[key] = e[key];
    }
    if (typeof e.requestId === 'string') out.stripe_request_id = e.requestId;
  } else {
    if (typeof e.message === 'string') out.message = scrubText(e.message).slice(0, MAX_MESSAGE);
    if (typeof e.code === 'string' || typeof e.code === 'number') out.code = e.code;
  }

  // Frames only: a stack's first line repeats the message, which for Stripe
  // is exactly what must not be logged.
  if (typeof e.stack === 'string') {
    const frames = e.stack
      .split('\n')
      .filter((line) => /^\s*at /.test(line))
      .slice(0, MAX_FRAMES)
      .map((line) => scrubText(line.trim()));
    if (frames.length) out.stack = frames.join('\n');
  }

  if (e.cause !== undefined && depth < 3) out.cause = describeError(e.cause, depth + 1);
  return out;
}
