/**
 * WHAT:  The three closed vocabularies a bug report can carry — which area of
 *        the app, how bad it is, how often it happens — with the copy shown for
 *        each, plus the mapping from a tab route to an area.
 * WHY:   Each of these values ends up in a Postgres CHECK constraint, so an
 *        unrecognised one is a rejected report rather than a soft failure. One
 *        module, typed as closed unions, is what keeps the picker and the
 *        payload agreeing — and what makes "the client cannot send a value the
 *        column will refuse" a type error rather than a hope.
 *
 *        ⚠️ AREA IS A CLOSED VOCABULARY, NOT A ROUTE, AND THAT IS THE POINT.
 *        The original bug reporter refused to capture the current route because
 *        a route can be `/post/<id>`, which ties a report to one specific
 *        stolen car. Ten fixed area names give the triage value of "where were
 *        you" with no capacity to carry an id. If you are ever tempted to send
 *        the pathname instead, that is the thing this exists to prevent.
 * LINKS: supabase/migrations/20260824140000_bug_report_details.sql (the CHECK
 *          constraints these must match, one for one);
 *        ../screens/ReportBugScreen.tsx (renders them);
 *        ../api/bugReportApi.ts (sends them);
 *        ./lastArea.ts (supplies the pre-filled default).
 */

/** Where in the app the bug was met. Mirrors the `area` CHECK. */
export type BugArea =
  | 'explore'
  | 'watchlist'
  | 'messages'
  | 'my_cars'
  | 'posting'
  | 'sightings'
  | 'payments'
  | 'alerts'
  | 'account'
  | 'other';

/** How much the bug cost them. Mirrors the `severity` CHECK. */
export type BugSeverity = 'annoying' | 'blocked' | 'lost';

/** Whether it is worth trying to reproduce. Mirrors the `frequency` CHECK. */
export type BugFrequency = 'always' | 'sometimes' | 'once';

export interface BugOption<V extends string> {
  value: V;
  label: string;
}

/**
 * The ten areas, in the order they are offered.
 *
 * Ordered by how often a report is likely to concern them rather than
 * alphabetically or by tab order — someone scanning this list is looking for
 * their own case, and "Something else" has to be last to read as the fallback.
 * The labels are the user's words for these surfaces, not the codebase's:
 * nobody calls the watchlist a watchlist until they have used the app for a
 * week, hence "Saved cars".
 */
export const BUG_AREAS: BugOption<BugArea>[] = [
  { value: 'explore', label: 'Explore & map' },
  { value: 'posting', label: 'Posting a car' },
  { value: 'sightings', label: 'Reporting a sighting' },
  { value: 'messages', label: 'Messages' },
  { value: 'watchlist', label: 'Saved cars' },
  { value: 'my_cars', label: 'My cars' },
  { value: 'payments', label: 'Payments & bounties' },
  { value: 'alerts', label: 'Alerts & notifications' },
  { value: 'account', label: 'Signing in & my account' },
  { value: 'other', label: 'Something else' },
];

/**
 * Severity, worst last.
 *
 * ⚠️ The labels describe the COST TO THEM, not a priority for us. "High /
 * medium / low" asks a reporter to guess our triage order, which they cannot
 * know and will get wrong in both directions; "I lost money or data" is a
 * question about their own morning and it sorts the queue better than a
 * priority field ever would. `lost` is the one that should page someone.
 */
export const BUG_SEVERITIES: BugOption<BugSeverity>[] = [
  { value: 'annoying', label: 'Annoying' },
  { value: 'blocked', label: 'I couldn’t finish something' },
  { value: 'lost', label: 'I lost money or data' },
];

/** How often, most reproducible first — the order a triager wants to read. */
export const BUG_FREQUENCIES: BugOption<BugFrequency>[] = [
  { value: 'always', label: 'Every time' },
  { value: 'sometimes', label: 'Sometimes' },
  { value: 'once', label: 'Just once' },
];

/**
 * Tab route segment → the area to pre-fill.
 *
 * ⚠️ ONLY THE FOUR TAB NAMES ARE EVER RECORDED, never a pathname. The map is
 * deliberately partial and deliberately coarse: a tab name is a room, a
 * pathname is a room plus whose house it is. `inbox` reads as 'messages'
 * because that is what the tab shows and what a reporter would call it.
 */
export const TAB_TO_AREA: Record<string, BugArea> = {
  explore: 'explore',
  watchlist: 'watchlist',
  inbox: 'messages',
  profile: 'account',
};

/** Label lookup for a value, for the summary rows. Null if unrecognised. */
export function labelForArea(area: BugArea | null): string | null {
  return BUG_AREAS.find((option) => option.value === area)?.label ?? null;
}
