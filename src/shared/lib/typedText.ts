/**
 * WHAT:  withoutNul() — typed text with every NUL character (U+0000) removed.
 * WHY:   Postgres cannot store NUL in a text value, so a pasted NUL anywhere
 *        in what we send fails the WHOLE request with a raw database error —
 *        a sighting report, a message, a listing — for a character nobody can
 *        see or delete. It is removed where text enters the app: the shared
 *        TextField and the chat composer, the only two places anyone types.
 *        Only NUL: every other character is the field's own business (the
 *        sighting notes strip their wider hidden set themselves —
 *        features/sightings/lib/withdrawReasons.ts).
 * LINKS: src/shared/ui/TextField.tsx; src/features/chat/components/MessageInputBar.tsx;
 *        docs/SECURITY_AND_TRUST.md (free text).
 */

/** Built, not typed, so no escape in this file can land as a raw character. */
const NUL = String.fromCharCode(0);

/** The text without NUL characters — the same string when it has none. */
export function withoutNul(text: string): string {
  return text.includes(NUL) ? text.split(NUL).join('') : text;
}
