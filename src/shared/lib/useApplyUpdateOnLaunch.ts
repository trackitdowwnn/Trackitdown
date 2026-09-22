/**
 * WHAT:  useApplyUpdateOnLaunch — runs applyUpdateOnLaunch once per app
 *        launch and logs what it did.
 * WHY:   The only file that imports the native `expo-updates` module, kept
 *        apart from otaUpdate.ts so the decision stays testable without it.
 *        Once per LAUNCH, not per mount: a module-level flag, like
 *        startupTrace's, so Fast Refresh or a root remount cannot ask twice
 *        — and cannot reload the app in a loop.
 * LINKS: ./otaUpdate.ts (the decision); src/app/_layout.tsx (the caller).
 */

import * as Updates from 'expo-updates';
import { useEffect } from 'react';

import { createLogger } from './logger';
import { applyUpdateOnLaunch } from './otaUpdate';

const log = createLogger('startup');

/** Module evaluation is the closest thing to "launch" JS can see (startupTrace). */
const launchedAt = Date.now();
let asked = false;

export function useApplyUpdateOnLaunch(): void {
  useEffect(() => {
    if (asked) return;
    asked = true;
    void applyUpdateOnLaunch(Updates, launchedAt).then((result) => {
      // 'disabled' is every dev session; not worth a line.
      if (result !== 'disabled') {
        log.info('ota_update_on_launch', { result, sinceLaunchMs: Date.now() - launchedAt });
      }
    });
  }, []);
}
