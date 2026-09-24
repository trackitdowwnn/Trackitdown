/**
 * WHAT:  applyUpdateOnLaunch — check for an OTA update, download it, and if
 *        the app is still in its first seconds, reload into it NOW rather
 *        than on the next cold start. Pure: takes an Updates-shaped object
 *        and a clock, returns what it did.
 * WHY:   expo-updates' default (`checkAutomatically: ON_LOAD`,
 *        `fallbackToCacheTimeout: 0`) launches whatever is cached, downloads
 *        a newer update in the background, and RUNS IT ON THE LAUNCH AFTER.
 *        So every published change needed two genuine cold starts to show,
 *        and "I see no changes on my phone" (2026-09-22, three times in one
 *        afternoon) was usually the first of the two. This closes that gap:
 *        when the download lands inside LAUNCH_APPLY_WINDOW_MS the app is
 *        still on its splash or the first feed paint, so a reload costs a
 *        second and loses nothing. Past the window it DEFERS to the default
 *        — a reload under someone mid-form, mid-chat or mid-report would be
 *        far worse than a stale build, and the update still applies next
 *        launch.
 *
 *        ⚠️ NEVER in dev, Expo Go or a build with updates off: every call
 *        rejects there (SDK 57 docs), and `isEnabled` is false. Checked first
 *        so a dev client never even asks. Every failure is swallowed into a
 *        result — an update check must not be able to take the app down.
 *
 *        The decision lives here, unhooked, so it can be tested with a fake
 *        Updates and a fake clock; the one-line hook in
 *        useApplyUpdateOnLaunch.ts is the only thing that touches the native
 *        module.
 * LINKS: ./useApplyUpdateOnLaunch.ts (the hook, wired in src/app/_layout.tsx);
 *        https://docs.expo.dev/versions/v57.0.0/sdk/updates/ (the contract);
 *        ./startupTrace.ts (the same "module evaluation ≈ launch" clock).
 */

/** The shape of `expo-updates` this needs — so tests hand in a fake. */
export interface UpdatesLike {
  isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean }>;
  reloadAsync(): Promise<void>;
}

/**
 * How long after launch a downloaded update may still reload the app.
 * Generous enough for a cold start on a slow connection to check AND
 * download (a bundle is ~8MB), short enough that nobody has started
 * anything they would mind losing.
 */
export const LAUNCH_APPLY_WINDOW_MS = 8_000;

export type ApplyUpdateResult =
  /** Dev, Expo Go, or updates off — nothing was asked. */
  | 'disabled'
  /** Checked; the running build is the newest. */
  | 'current'
  /** Downloaded and reloaded into — the caller should expect to be gone. */
  | 'reloaded'
  /** Downloaded, but too late to reload safely; applies on the next launch. */
  | 'deferred'
  /** The check or download threw; nothing changed. */
  | 'failed';

export async function applyUpdateOnLaunch(
  updates: UpdatesLike,
  launchedAt: number,
  now: () => number = Date.now,
  isDev: boolean = __DEV__,
): Promise<ApplyUpdateResult> {
  if (isDev || !updates.isEnabled) {
    return 'disabled';
  }
  try {
    const check = await updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return 'current';
    }
    const fetched = await updates.fetchUpdateAsync();
    if (!fetched.isNew) {
      return 'current';
    }
    if (now() - launchedAt > LAUNCH_APPLY_WINDOW_MS) {
      return 'deferred';
    }
    await updates.reloadAsync();
    return 'reloaded';
  } catch {
    return 'failed';
  }
}
