/**
 * WHAT:  Email validation — a single `isValidEmail` predicate over zod's email
 *        format, so screens gate "Continue" consistently.
 * WHY:   The auth flow (and any future email field) needs one shared notion of
 *        "a valid email", not a hand-rolled regex per screen. Pure and
 *        dependency-light (zod only), so it lives in shared/lib.
 * LINKS: src/features/auth/components/AuthSheet.tsx (consumer);
 *        src/shared/lib/logger.ts (redactEmail — the logging counterpart).
 */

import { z } from 'zod';

const emailSchema = z.email();

/** True when `value` (trimmed) is a well-formed email address. */
export function isValidEmail(value: string): boolean {
  return emailSchema.safeParse(value.trim()).success;
}
