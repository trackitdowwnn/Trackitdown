/**
 * WHAT:  How long a bug report's message has to be, and the line under the box
 *        that says how far along it is.
 * WHY:   ⚠️ ONE SOURCE, TWO CONSUMERS, and they must never disagree. The zod
 *        schema in bugReportFlow decides whether Next is enabled; the counter
 *        in bugWizardSteps tells the user why it isn't. Written separately,
 *        those drift the first time either number is tuned, and the failure is
 *        the worst kind on this screen: a disabled button with a caption
 *        cheerfully saying the answer is long enough.
 *
 *        ⚠️ THE MINIMUM IS CLIENT-SIDE ONLY. The server does not enforce it —
 *        `submit_bug_report` accepts any non-empty message — so this is a
 *        quality nudge, not a validation boundary, and it must never be
 *        described as one. It exists because a two-word report ("map broken")
 *        cannot be triaged and quietly wastes the one round-trip we get with
 *        someone annoyed enough to have written in at all.
 *
 *        Deliberately NOT next to BUG_REPORT_MAX_LENGTH in bugReportApi: that
 *        constant mirrors a real server limit, and sitting beside it would
 *        imply this one does too.
 * LINKS: ./bugReportFlow.tsx (gates on it); ../components/bugWizardSteps.tsx
 *        (shows it); ../api/bugReportApi.ts (the max, which IS the server's).
 */

/**
 * The shortest message the flow will advance on.
 *
 * 20 characters is about four words — enough to force a sentence rather than a
 * label, and low enough that "the map is blank on android" passes on the first
 * try. Raising it costs reports; the people this filters out are the ones
 * already least willing to write.
 */
export const BUG_REPORT_MIN_LENGTH = 20;

/** Trimmed length, so leading spaces never count toward the minimum. */
export function bugMessageLength(message: string): number {
  return message.trim().length;
}

/** Words, counting any run of whitespace as one separator. */
export function bugMessageWordCount(message: string): number {
  const trimmed = message.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * The line under the box: how many words so far, and how much further to go.
 *
 * ⚠️ IT SAYS WHAT IS MISSING, not just what is there. A bare "3 words" next to
 * a disabled Next is a scoreboard, not an explanation — the user has no way to
 * know whether the button is broken or they are. Below the minimum the count is
 * followed by the exact shortfall; at or above it, the shortfall disappears
 * rather than turning into a tick, because a report that is long enough is
 * simply normal and does not need congratulating.
 */
export function describeMessageProgress(message: string): string {
  const length = bugMessageLength(message);
  // Nothing typed yet: a "0 words" scoreboard before the first keystroke reads
  // as a failure state on a field nobody has touched. State the ask instead.
  if (length === 0) return `At least ${BUG_REPORT_MIN_LENGTH} characters`;

  const words = bugMessageWordCount(message);
  const counted = words === 1 ? '1 word' : `${words} words`;
  if (length >= BUG_REPORT_MIN_LENGTH) return counted;

  const short = BUG_REPORT_MIN_LENGTH - length;
  return `${counted} · ${short} more character${short === 1 ? '' : 's'}`;
}
