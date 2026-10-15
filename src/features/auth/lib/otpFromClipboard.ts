/**
 * WHAT:  extractOtp — the sign-in code in a piece of clipboard text, or null.
 * WHY:   2026-10-15 (code autofill). On Android an emailed code can't be
 *        autofilled by the system, so the code step reads the clipboard when
 *        the spotter comes back from their email. A wrong guess costs a sign-in
 *        attempt — and only two emails an hour — so this is STRICT: it takes a
 *        code only when the clip plainly IS one, never a number that happens to
 *        be lying around (a bank reference, a phone number).
 * LINKS: ../hooks/useClipboardCode.ts (the reader); ../components/AuthSheet.tsx.
 */

/** A clip longer than this is a paragraph, not a code someone just copied. */
const MAX_CLIP_LENGTH = 120;

/**
 * The code, if the clip is:
 *   • the code itself, however spaced — "12345678", "1234 5678", "1234-5678"
 *     (Gmail's "Copy code" copies just the digits); or
 *   • a short text holding exactly ONE standalone run of `length` digits.
 * Anything else — two candidates, a longer number, a long text — is null.
 */
export function extractOtp(text: string, length = 8): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_CLIP_LENGTH) return null;

  const compact = trimmed.replace(/[\s-]/g, '');
  if (new RegExp(`^\\d{${length}}$`).test(compact)) return compact;

  // Every maximal run of digits, then only those exactly `length` long — so
  // "123456789" is not a code with a digit to spare. (No lookbehind: kept to
  // what every JS engine the app runs on supports.)
  const runs = (trimmed.match(/\d+/g) ?? []).filter((run) => run.length === length);
  return runs.length === 1 ? (runs[0] ?? null) : null;
}
