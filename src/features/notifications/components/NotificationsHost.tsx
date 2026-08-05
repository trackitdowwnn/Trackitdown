/**
 * WHAT:  The app-wide notification host — registers this device's push token,
 *        decides how a notification presents while the app is open, and routes
 *        taps (warm AND cold start) to the right screen.
 * WHY:   Renders nothing. Mounted once at the root because a notification can
 *        arrive on any screen and, on a cold start, BEFORE there is a screen at
 *        all — that last case is the classic gap: expo-notifications has the
 *        response ready before expo-router has a navigator, so navigating
 *        immediately silently does nothing.
 *        Three guards make that safe: we wait for the navigator, wait for the
 *        session to resolve (so a tap never lands mid-splash), and hold the
 *        response in a queue until both. A module-level set of handled ids is
 *        shared by the cold-start read and the warm listener, because
 *        getLastNotificationResponseAsync keeps returning the SAME response —
 *        without the guard, a remount re-opens a notification the user already
 *        dealt with.
 *        Foreground presentation is a quiet in-app Toast, not a system banner
 *        over the app someone is already looking at.
 * LINKS: ../lib/pushRoute.ts (the pure mapping), ../hooks/usePushRegistration.ts;
 *        src/app/_layout.tsx (mounts this); src/shared/ui/Toast.tsx;
 *        https://docs.expo.dev/versions/v57.0.0/sdk/notifications/.
 */

import * as Notifications from 'expo-notifications';
import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useSession } from '@/features/auth';
import { createLogger } from '@/shared/lib/logger';
import { useToast } from '@/shared/ui';

import { markNotificationsReadByPayload } from '../api/notificationsApi';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { parsePushPayload } from '../lib/pushPayload';
import { pushRouteFor } from '../lib/pushRoute';

const log = createLogger('notifications');

/** Responses already acted on, by notification id. Module-level so a remount
 *  cannot re-open one — getLastNotificationResponseAsync is sticky. */
const handledResponseIds = new Set<string>();

/** Test seam. */
export function resetNotificationsHostForTests(): void {
  handledResponseIds.clear();
}

/** The shape we actually read off a response — kept local so the host is
 *  testable without constructing a full expo-notifications object. */
interface ResponseLike {
  notification: {
    request: {
      identifier: string;
      content: { title?: string | null; body?: string | null; data?: unknown };
    };
  };
}

/**
 * Drop a response for good, because we're mid-onboarding: finishing onboarding
 * should land on the feed, not jump into a stranger's post.
 *
 * Marking it handled is the LOAD-BEARING half. The launch response is sticky —
 * getLastNotificationResponseAsync keeps returning it — so an unmarked drop is
 * re-read the moment the reason for dropping goes away, and opens after all,
 * which is precisely what the drop exists to prevent. It lives in one function
 * because there are two drop sites and the first version of this forgot to
 * mark on one of them.
 */
function dropResponse(response: ResponseLike): void {
  handledResponseIds.add(response.notification.request.identifier);
  log.info('push_cold_start_dropped', { reason: 'onboarding' });
}

/**
 * How a notification behaves while the app is FOREGROUND. Suppresses the
 * system banner and list entry — we show a Toast with a View action instead,
 * which can't cover what the user is reading and matches the app's own voice.
 *
 * NOTE the field names: SDK 54 replaced `shouldShowAlert` with
 * `shouldShowBanner` + `shouldShowList`. Setting the old name here compiles
 * (it is merely deprecated) and silently shows a system banner anyway.
 */
const FOREGROUND_BEHAVIOUR = {
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
};

export function NotificationsHost() {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const segments = useSegments();
  const toast = useToast();
  const { status } = useSession();

  // --- Readiness: all three must hold before a tap may navigate -------------
  // 1. the navigator exists (router.push before this is a no-op)
  const navigatorReady = Boolean(navigationState?.key);
  // 2. the session has resolved, so we don't route out from under the splash
  const sessionResolved = status !== 'loading';
  // 3. we're not mid-onboarding — a first-run user must not be yanked into a
  //    post detail before they've seen what the app is.
  const onOnboarding = segments[0] === 'onboarding';
  /** Navigator + session settled: we now KNOW which screen we're on. */
  const gatesResolved = navigatorReady && sessionResolved;
  const ready = gatesResolved && !onOnboarding;

  usePushRegistration(ready);

  // Listeners and the async cold-start read close over these; refs keep them
  // reading live values. Synced in the FIRST effect so they are already
  // correct by the time the async read below resolves. Written in an effect,
  // not during render — reactCompiler is on, and a render-phase ref write is
  // exactly what it is allowed to reorder.
  const gatesRef = useRef(gatesResolved);
  const onboardingRef = useRef(onOnboarding);
  useEffect(() => {
    gatesRef.current = gatesResolved;
    onboardingRef.current = onOnboarding;
  }, [gatesResolved, onOnboarding]);
  /** Responses that arrived before we knew where we were. An ARRAY, not one
   *  slot: the cold-start read can resolve while a warm tap is already queued,
   *  and overwriting would lose one silently AND leave it unmarked. */
  const pendingRef = useRef<{ response: ResponseLike; coldStart: boolean }[]>([]);

  const openResponse = useCallback(
    (response: ResponseLike, coldStart: boolean) => {
      const { identifier, content } = response.notification.request;
      if (handledResponseIds.has(identifier)) return;

      const payload = parsePushPayload(content.data);
      if (!payload) {
        // Unrecognised or over-wide payload (the strict schema failing closed).
        // Mark it handled so we don't re-parse it forever, and just leave the
        // user wherever the app opened.
        handledResponseIds.add(identifier);
        log.warn('push_opened_unroutable', { coldStart });
        return;
      }
      handledResponseIds.add(identifier);
      // The center's row for this push flips read — a push you tapped is a
      // notification you saw. By payload match, not id: push data is shared
      // across recipients, so no per-user row id rides it. Fire-and-forget;
      // a lost mark costs one stale dot until the next focus refetch. Chat
      // pushes are skipped: they never have center rows (the one exclusion),
      // so the RPC would be a guaranteed no-op round trip.
      if (payload.type !== 'message') {
        void markNotificationsReadByPayload(payload.type, payload);
      }
      router.push(pushRouteFor(payload));
      // The engagement metric for the whole product: sent vs tapped.
      // threadId is deliberately excluded — it correlates two identities.
      // (The dispute-loop kinds carry a sightingId instead of a postId; the
      // type alone is the metric there.)
      log.info('push_opened', {
        type: payload.type,
        postId: 'postId' in payload ? payload.postId : undefined,
        coldStart,
      });
    },
    [router],
  );

  /**
   * Decide as soon as the response arrives. The decision has to happen HERE
   * rather than only in the flush effect: an async cold-start read can resolve
   * long after that effect last ran, and a response left sitting in the queue
   * would then be opened by the next unrelated re-render — including the one
   * where the user simply finished onboarding.
   */
  const handleResponse = useCallback(
    (response: ResponseLike, coldStart: boolean) => {
      if (!gatesRef.current) {
        // We don't yet know which screen we're on — hold it for the flush.
        pendingRef.current.push({ response, coldStart });
        return;
      }
      if (onboardingRef.current) {
        dropResponse(response);
        return;
      }
      openResponse(response, coldStart);
    },
    [openResponse],
  );

  // Set from the effect rather than at module scope: an import-time side
  // effect fires before anything can observe it, survives Fast Refresh oddly,
  // and makes the module untestable. This host mounts in the root layout, so
  // "on mount" is as early as the app itself.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    Notifications.setNotificationHandler(FOREGROUND_BEHAVIOUR);
  }, []);

  // Listeners and the one-shot read below reach handleResponse through a ref so
  // their effects can take [] deps. Without it, any change to handleResponse's
  // identity re-runs the cold-start effect — which the read-once guard then
  // early-returns from, discarding the launch response FOREVER while the
  // in-flight promise's result is thrown away by a stale `cancelled`. That is
  // latent today only because useRouter() happens to return a stable
  // singleton; adding one dep to openResponse would make it live, and it would
  // break the single case this component exists for.
  const handleResponseRef = useRef(handleResponse);
  useEffect(() => {
    handleResponseRef.current = handleResponse;
  }, [handleResponse]);

  // --- Cold start: the app was KILLED and launched by tapping a push --------
  // Read ONCE, on mount. The launch response is sticky, so there is nothing to
  // cancel and nothing to re-read: whatever comes back is routed or queued by
  // handleResponse, and handledResponseIds stops it being acted on twice.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleResponseRef.current(response as unknown as ResponseLike, true);
      })
      .catch(() => {
        // No notification module / no launch response. Nothing to do.
      });
  }, []);

  // --- Warm taps -----------------------------------------------------------
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handleResponseRef.current(response as unknown as ResponseLike, false);
    });
    return () => subscription.remove();
  }, []);

  // --- Foreground arrival: a quiet Toast, never a system banner -------------
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const { content, identifier } = notification.request;
      const payload = parsePushPayload(content.data);
      if (!payload) return;
      log.debug('push_received_foreground', { type: payload.type });
      toast.show(content.body ?? content.title ?? 'New alert', 'success', {
        label: 'View',
        // handleResponse, NOT openResponse: View must respect the same
        // onboarding guard as a tap. Otherwise a push arriving mid-onboarding
        // offers a button that yanks a first-run user into a stranger's post.
        onPress: () =>
          handleResponseRef.current(
            { notification: { request: { identifier, content } } } as ResponseLike,
            false,
          ),
      });
    });
    return () => subscription.remove();
  }, [toast]);

  // --- Flush anything that arrived too early -------------------------------
  // Waits on gatesResolved (NOT `ready`) so the onboarding case is reachable:
  // once we know where we are, a queued response is either opened or dropped,
  // never left pending forever.
  useEffect(() => {
    if (!gatesResolved || pendingRef.current.length === 0) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    for (const { response, coldStart } of queued) {
      // dropResponse, not a bare log: the drop MUST mark the response handled
      // or the sticky launch response is re-read the moment onboarding ends.
      if (onOnboarding) dropResponse(response);
      else openResponse(response, coldStart);
    }
  }, [gatesResolved, onOnboarding, openResponse]);

  return null;
}
