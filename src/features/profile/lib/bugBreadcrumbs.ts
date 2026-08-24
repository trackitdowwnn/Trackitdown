/**
 * WHAT:  readBreadcrumbs() — the last 50 log entries as `level feature:event`
 *        strings, with every data payload discarded.
 * WHY:   A trail of what the app was doing before it broke is the most useful
 *        thing a bug report can carry, and the log ring buffer is the only
 *        place that trail exists. Sending the buffer as-is was rejected outright
 *        when this feature was built, and that rejection still stands — this
 *        module exists to take the useful half and leave the dangerous half
 *        behind.
 *
 *        ⚠️ THE `data` PAYLOAD IS WHERE THE DANGER LIVES, AND IT IS DROPPED
 *        HERE. logger.ts's auto-redaction is key-name matching —
 *        /token|password|secret|authorization|apikey|api_key/i — with NO lat,
 *        lng or plate in the pattern, so coordinate and plate redaction is
 *        call-site discipline rather than enforcement. Worse, the buffer is
 *        dominated by bare UUIDs: a `postId` in a support queue is a durable
 *        pointer at a live victim's case, resolvable to an exact address by
 *        anyone holding service_role. `{ postId, lat, lng }` is exactly the
 *        shape that must never travel, and the only reliable way to guarantee
 *        that is to send NO payload at all rather than to filter one.
 *
 *        So: event NAMES only. 'sighting_submit_failed' tells you what broke.
 *        It cannot tell you whose car it was, and it never will.
 *
 *        The bar is startupTrace.ts, whose header states it exactly: "phase
 *        names and millisecond durations only — never a coordinate, an id".
 * LINKS: src/shared/lib/logger.ts (getRecentLogs, and the redaction this does
 *          not rely on);
 *        supabase/migrations/20260824140000_bug_report_details.sql (the
 *          breadcrumbs column and its bounds);
 *        docs/LOGGING.md (the privacy rules this is bounded by).
 */

import { getRecentLogs } from '@/shared/lib/logger';

/**
 * How many entries travel. The column accepts 50 and 4000 characters total;
 * this is the count, and `MAX_ENTRY_CHARS` keeps the total under the cap even
 * if every entry is at its longest.
 */
export const MAX_BREADCRUMBS = 50;

/** 4000 / 50 = 80, so 50 maximum-length entries still fit the column. */
const MAX_ENTRY_CHARS = 78;

/**
 * The last {@link MAX_BREADCRUMBS} log entries as `HH:MM:SS lvl feature:event`,
 * oldest first — reading order for a trail.
 *
 * Returns an empty array when nothing has been logged, which the caller should
 * send as null rather than as `[]`: an empty array in the operator's queue
 * looks like a trail that was captured and found empty, when it means no trail
 * existed.
 *
 * ⚠️ Only `timestamp`, `level`, `feature` and `message` are read. `data` is
 * never touched — see the header for why that is the whole design and not an
 * oversight.
 */
export function readBreadcrumbs(): string[] {
  return getRecentLogs()
    .slice(-MAX_BREADCRUMBS)
    .map((entry) => {
      // Time of day only. The date adds nothing a report's own created_at does
      // not already say, and a full ISO stamp spends 24 of the 78 characters.
      const time = entry.timestamp.slice(11, 19) || entry.timestamp.slice(0, 8);
      return `${time} ${entry.level} ${entry.feature}:${entry.message}`.slice(
        0,
        MAX_ENTRY_CHARS,
      );
    });
}
