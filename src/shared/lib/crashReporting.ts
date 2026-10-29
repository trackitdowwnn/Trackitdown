/**
 * WHAT:  Crash capture for the app until it has a native crash reporter:
 *        installCrashHandlers() chains React Native's global JS error
 *        handler and, in release builds, Hermes's unhandled-rejection
 *        tracker; reportCrash() is also called by the root ErrorBoundary
 *        (src/app/_layout.tsx). Each logs ONE `app_crash` event — kind,
 *        error type, top stack frame, OTA id — which the telemetry sink sends.
 * WHY:   docs/logging-decisions.md (decision 4): until now a crash on a
 *        tester's phone left no trace anywhere. App Sentry needs a native
 *        build (@sentry/react-native), so this is the OTA-shippable half.
 *        ⚠️ NO ERROR MESSAGE is sent: it can quote the value that failed (a
 *        plate, a name). The type, frame and OTA are enough to find the code.
 *        A FATAL error ends the app, so the report gets up to 1.5s to leave
 *        before RN's own handler runs; the buffer is otherwise lost.
 *        Rejections are tracked in RELEASE only: in dev, RN's own tracker
 *        shows the yellow box, and replacing it would hide that.
 * LINKS: ./telemetry.ts (flush, TELEMETRY_KEYS); ./logger.ts;
 *        src/app/_layout.tsx (installs it; ErrorBoundary);
 *        ./crashReporting.test.ts.
 */

import * as Updates from 'expo-updates';

import { createLogger } from './logger';
import { flush } from './telemetry';

const log = createLogger('app');

/** How long a fatal crash waits for its report before the app goes down. */
const FATAL_GRACE_MS = 1500;

type CrashKind = 'render' | 'fatal' | 'error' | 'rejection';
type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler | undefined;
  setGlobalHandler(handler: GlobalHandler): void;
}
interface HermesLike {
  enablePromiseRejectionTracker?(options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }): void;
}

/** The running OTA as 8 hex characters (not UUID-shaped, so telemetry keeps
 *  it); `embedded` for the build's own bundle. Matches `eas update:list`. */
export function otaId(): string {
  const id = Updates.updateId;
  return id ? id.replace(/-/g, '').slice(0, 8) : 'embedded';
}

/** `at onPress (address at …/bundle:1:23456)` → `onPress:1:23456`: the
 *  function and position, never the path (it carries a bundle id). */
export function topFrame(stack: string | undefined): string | undefined {
  const line = stack?.split('\n').find((l) => /^\s*at /.test(l));
  if (!line) return undefined;
  const name = line.trim().replace(/^at\s+/, '').split(/\s/)[0] || 'anonymous';
  const position = line.match(/:(\d+):(\d+)\)?\s*$/);
  return (position ? `${name}:${position[1]}:${position[2]}` : name).slice(0, 120);
}

/** Logs one `app_crash` and sends the telemetry buffer now. */
export function reportCrash(kind: CrashKind, error: unknown): Promise<void> {
  const e = error instanceof Error ? error : undefined;
  log.error('app_crash', {
    kind,
    type: e?.name ?? typeof error,
    frame: topFrame(e?.stack),
    ota: otaId(),
  });
  return flush().catch(() => undefined);
}

let installed = false;

export function installCrashHandlers(
  runtime: { errorUtils?: ErrorUtilsLike; hermes?: HermesLike; dev?: boolean } = {},
): void {
  if (installed) return;
  installed = true;
  const errorUtils =
    runtime.errorUtils ?? (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const hermes = runtime.hermes ?? (globalThis as { HermesInternal?: HermesLike }).HermesInternal;
  const dev = runtime.dev ?? __DEV__;

  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      const sent = reportCrash(isFatal ? 'fatal' : 'error', error);
      if (!isFatal) {
        previous?.(error, isFatal);
        return;
      }
      const grace = new Promise((resolve) => setTimeout(resolve, FATAL_GRACE_MS));
      void Promise.race([sent, grace]).finally(() => previous?.(error, isFatal));
    });
  }

  if (!dev) {
    hermes?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, rejection) => void reportCrash('rejection', rejection),
      onHandled: () => {},
    });
  }
}

/** Test seam. */
export function resetCrashHandlersForTests(): void {
  installed = false;
}
