/**
 * WHAT:  useFullscreenLoader — screen-local driver for FullscreenLoader:
 *        run(fn, message?) shows the loader around an async operation and
 *        GUARANTEES it hides afterwards (finally), rethrowing errors for
 *        the caller's error handling; update(message) re-points the status
 *        line mid-flight.
 * WHY:   A stuck loader is the worst failure this component can have — the
 *        finally lives here, in one tested place, so no screen can forget
 *        it. A hook (not a context/singleton wrapper) keeps state with the
 *        screen like every other component in the kit, and spreads straight
 *        onto <FullscreenLoader {...loaderProps} />. The 600ms minimum
 *        display lives in the component, so even direct `visible` consumers
 *        can't flash. Overlapping run() calls are ref-counted: the loader
 *        hides only when the LAST one settles, and a run that brings a
 *        message wins the status line (message-less runs never blank it).
 *        The 600ms minimum assumes run() starts from an event handler; a
 *        run started AND settled within one microtask chain outside React's
 *        event batching may never mount the loader at all — which is fine
 *        (no flash), just not a visible 600ms.
 *        DELIBERATELY NO TIMEOUT: run() must not race fn() against a clock
 *        — declaring a payment "failed" while the charge may still complete
 *        server-side invites double-charging. Callers MUST pass operations
 *        that are already timeout-bounded at the network/API layer, where
 *        idempotency and retry live (docs/DOMAIN.md).
 * LINKS: src/shared/ui/FullscreenLoader.tsx; docs/DESIGN_SYSTEM.md
 *        (Loading — skeletons for lists/screens, this only for blocking).
 *
 * Usage:
 *   const { loaderProps, run, update } = useFullscreenLoader();
 *   const submit = () =>
 *     run(async () => {
 *       await uploadPhotos();
 *       update('Processing payment…');
 *       await payEscrow();
 *     }, 'Uploading photos…');
 */

import { useCallback, useRef, useState } from 'react';

export function useFullscreenLoader() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  // Overlapping runs: only the last settling run may hide the loader.
  const activeRunsRef = useRef(0);

  /** Change the status line while the loader is up. */
  const update = useCallback((nextMessage: string) => setMessage(nextMessage), []);

  /**
   * Show the loader around `fn`. Always hides afterwards — success or
   * throw — and rethrows so the caller surfaces the error. `fn` must be
   * timeout-bounded by its network layer; see the header for why there is
   * deliberately no timeout here.
   */
  const run = useCallback(
    async <T>(fn: () => Promise<T>, initialMessage?: string): Promise<T> => {
      activeRunsRef.current += 1;
      if (initialMessage !== undefined) {
        // Only replace the message when this run brings one — an overlapping
        // message-less run must not blank a sibling's status line.
        setMessage(initialMessage);
      }
      setVisible(true);
      try {
        return await fn();
      } finally {
        activeRunsRef.current -= 1;
        if (activeRunsRef.current === 0) {
          setVisible(false);
        }
      }
    },
    [],
  );

  return { loaderProps: { visible, message }, run, update };
}
