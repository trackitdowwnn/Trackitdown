/**
 * WHAT:  Remembers which TAB the user was last on, so the bug reporter can
 *        pre-select the right area instead of asking a question the app can
 *        already answer.
 * WHY:   The area picker is ten options long, and nine times in ten the answer
 *        is "wherever I just was". Pre-filling it turns the commonest report
 *        into one less decision while the annoyance is still fresh.
 *
 *        ⚠️ A TAB NAME. NOT A ROUTE. NOT A HISTORY. This module holds ONE
 *        string, one of four, in memory. It is the smallest thing that answers
 *        the question, and it is small on purpose: the original bug reporter
 *        refused to capture the current route because a route can be
 *        `/post/<id>`, which points at one specific stolen car. Recording
 *        `'explore'` cannot. Do not extend this to pathnames, to a stack, or to
 *        a trail of visited screens — each of those reintroduces exactly the
 *        thing that was rejected, and it would arrive looking like a small
 *        convenience.
 *
 *        Memory only, deliberately: it does not survive a relaunch, because a
 *        tab visited before the app restarted is not evidence about the bug
 *        being reported now, and persisting it would mean writing a fact about
 *        someone's usage to disk for no gain.
 * LINKS: ./bugReportOptions.ts (TAB_TO_AREA — the mapping);
 *        src/app/(tabs)/_layout.tsx (the only writer);
 *        ../screens/ReportBugScreen.tsx (the only reader).
 */

import { useEffect } from 'react';

import { TAB_TO_AREA, type BugArea } from './bugReportOptions';

/** The one piece of state. Module-level, so it survives a screen unmount. */
let lastTab: string | null = null;

/**
 * Record the tab the user is on. Ignores anything that is not one of the four
 * known tabs, so an unexpected segment leaves the previous value alone rather
 * than storing something unvetted.
 */
export function noteVisitedTab(tab: string | null | undefined): void {
  // ⚠️ Object.hasOwn, NOT `in`. `'toString' in TAB_TO_AREA` is TRUE — the
  // prototype chain answers for it — so the first version of this accepted
  // 'toString', 'constructor' and '__proto__', and readLastArea() then handed
  // back a FUNCTION typed as BugArea. A test written for the route-rejection
  // rule caught it. The whole value of this module is that it stores one of
  // four known strings, so the membership check has to actually mean that.
  if (tab && Object.hasOwn(TAB_TO_AREA, tab)) {
    lastTab = tab;
  }
}

/** The area to pre-select, or null if no tab has been seen this launch. */
export function readLastArea(): BugArea | null {
  // Re-checked on the way out as well: the writer is the guard, and a guard
  // with a second lock costs nothing here.
  if (lastTab === null || !Object.hasOwn(TAB_TO_AREA, lastTab)) return null;
  return TAB_TO_AREA[lastTab] ?? null;
}

/** Test seam — resets the module state between cases. */
export function resetLastArea(): void {
  lastTab = null;
}

/**
 * Records the active tab for as long as the calling layout is mounted.
 *
 * Lives here rather than inline in the route file so `(tabs)/_layout.tsx` stays
 * declarative wiring (ARCHITECTURE.md rule 3).
 */
export function useTrackVisitedTab(tab: string | null | undefined): void {
  useEffect(() => {
    noteVisitedTab(tab);
  }, [tab]);
}
