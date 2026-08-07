/**
 * WHAT:  AuthGate — the app's front door. Shows the brand splash while the
 *        session + onboarding flag restore, sends a first launch to
 *        onboarding, lands everyone else — member or guest — in the tabs,
 *        and then fires the native startup permission prompts (no custom
 *        permissions UI — the OS dialogs are the ask).
 * WHY:   Guest-first (Airbnb's deferred-auth pattern): browsing is open, so the
 *        gate no longer polices sign-in state or profile completeness — gated
 *        ACTIONS do, via useRequireAuth + AuthSheet. Rendering the splash over
 *        the stack while loading is what stops the wrong screen flashing.
 * LINKS: src/app/_layout.tsx (mounts this around the Stack + AuthSheet);
 *        src/features/auth/hooks/useAuthGate.ts (the decision); BrandSplash;
 *        src/features/auth/gate/useRequireAuth.ts (the per-action gate).
 */

import { useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useStartupPermissionRequests } from '@/features/permissions';
import { useContentReady } from '@/shared/lib/appReady';

import { useAuthGate } from '../hooks/useAuthGate';
import { BrandSplash } from './BrandSplash';

/** Longest the splash will wait for content before showing the app regardless.
 *  Generous enough to cover a slow first feed on mobile data, short enough that
 *  a wedged request never reads as a broken app. */
const MAX_CONTENT_WAIT_MS = 6000;

export function AuthGate({ children }: { children: ReactNode }) {
  const route = useAuthGate();
  const router = useRouter();
  const segments = useSegments();
  // GLOBAL, not local: this component lives in the root layout, above the
  // screen, so useLocalSearchParams would never see the onboarding route's own
  // query string.
  const params = useGlobalSearchParams<{ revisit?: string }>();

  // Once the app has landed (new users: right after onboarding completes),
  // fire the native OS permission dialogs for whatever is still askable.
  useStartupPermissionRequests(route === 'app');

  useEffect(() => {
    if (route === 'loading') return;

    const seg = segments[0];
    const onOnboarding = seg === 'onboarding';
    // A DELIBERATE re-view from settings ("How Trackitdown works" pushes
    // /onboarding?revisit=1) is not the gate's business. Without this the gate
    // saw "flag already seen + we're on onboarding" and replaced the screen
    // with the feed before the first slide could paint, which made that
    // settings row look like it silently navigated to Explore — the bug it
    // was, from the day the row shipped until 2026-08-06.
    const revisiting = onOnboarding && params.revisit === '1';
    // The gate owns FIRST-LAUNCH onboarding and the index landing (seg
    // undefined); every other route is open to guests — deep links included.
    if (route === 'onboarding' && !onOnboarding) {
      router.replace('/onboarding');
    } else if (route === 'app' && ((onOnboarding && !revisiting) || seg === undefined)) {
      router.replace('/(tabs)/explore');
    }
  }, [route, segments, router, params.revisit]);

  // Keep the splash up past the routing decision, until the first screen has
  // something on it — otherwise the feed assembles itself in public and the
  // cold start reads as four transitions instead of one.
  //
  // ONLY for the 'app' route. Onboarding paints its own first slide instantly
  // and never loads a feed, so waiting on content there would hang forever.
  const contentReady = useContentReady();
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  const waitingForContent = route === 'app' && !contentReady && !waitedLongEnough;

  useEffect(() => {
    if (!waitingForContent) {
      return;
    }
    // The backstop. appReady is marked when the feed SETTLES, including on
    // error, so this only fires if a request neither resolves nor rejects — a
    // dead connection that never times out. Showing a half-loaded feed is bad;
    // showing a splash forever is far worse, so the wait is always bounded.
    const timer = setTimeout(() => setWaitedLongEnough(true), MAX_CONTENT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waitingForContent]);

  // Always render the navigator (Expo Router requires it mounted); cover it with
  // the splash while restoring, so the wrong screen never flashes underneath.
  return (
    <>
      {children}
      {route === 'loading' || waitingForContent ? (
        <View style={StyleSheet.absoluteFill}>
          <BrandSplash />
        </View>
      ) : null}
    </>
  );
}
