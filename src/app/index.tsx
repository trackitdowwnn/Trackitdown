/**
 * WHAT:  App root route — pure gate: first launch goes through the
 *        onboarding intro, everyone else lands on the main tabs.
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): the gate
 *        logic lives in the auth feature's useOnboardingGate; this file
 *        only maps its three states to render-nothing / intro / tabs.
 *        Rendering nothing while the flag loads prevents a flash before
 *        the redirect. The old placeholder home is retired — the dev links
 *        (sandbox, wizard demo) now live on the Profile tab.
 * LINKS: src/features/auth (useOnboardingGate); src/app/onboarding.tsx;
 *        src/app/(tabs)/_layout.tsx.
 */

import { Redirect } from 'expo-router';

import { useOnboardingGate } from '@/features/auth';

export default function RootGate() {
  const gate = useOnboardingGate();

  if (gate === 'loading') {
    return null; // a blank frame beats a flash before the redirect
  }
  if (gate === 'unseen') {
    return <Redirect href="/onboarding" />;
  }
  return <Redirect href="/(tabs)/explore" />;
}
