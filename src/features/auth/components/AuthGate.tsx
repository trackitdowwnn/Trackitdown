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

import { useRouter, useSegments } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { useStartupPermissionRequests } from '@/features/permissions';

import { useAuthGate } from '../hooks/useAuthGate';
import { BrandSplash } from './BrandSplash';

export function AuthGate({ children }: { children: ReactNode }) {
  const route = useAuthGate();
  const router = useRouter();
  const segments = useSegments();

  // Once the app has landed (new users: right after onboarding completes),
  // fire the native OS permission dialogs for whatever is still askable.
  useStartupPermissionRequests(route === 'app');

  useEffect(() => {
    if (route === 'loading') return;

    const seg = segments[0];
    const onOnboarding = seg === 'onboarding';
    // The gate owns onboarding and the index landing (seg undefined); every
    // other route is open to guests — deep links included.
    if (route === 'onboarding' && !onOnboarding) {
      router.replace('/onboarding');
    } else if (route === 'app' && (onOnboarding || seg === undefined)) {
      router.replace('/(tabs)/explore');
    }
  }, [route, segments, router]);

  // Always render the navigator (Expo Router requires it mounted); cover it with
  // the splash while restoring, so the wrong screen never flashes underneath.
  return (
    <>
      {children}
      {route === 'loading' ? (
        <View style={StyleSheet.absoluteFill}>
          <BrandSplash />
        </View>
      ) : null}
    </>
  );
}
