/**
 * WHAT:  BrandSplash — the calm cold-start / session-restore screen: the
 *        shared BrandLoader (wordmark + rotating waiting phrase) centred on
 *        the app background while the first screen's content loads.
 * WHY:   While the session, the onboarding flag and the first feed load
 *        resolve, the app must show something steady rather than flashing a
 *        wrong screen. It is deliberately painted in the SAME background the
 *        native splash uses (app.json splash.backgroundColor), so the handover
 *        from the OS splash to this is invisible — one screen, not two.
 *
 *        The old quiet spinner became the rotating phrase (2026-07-30, the
 *        one-loading-face unification): the periodic swap carries the same
 *        "something is happening" signal a spinner did — a frozen app stops
 *        rotating — in the product's own voice, and every other blocking
 *        wait (FullscreenLoader) now shows the identical face.
 *
 *        AuthGate owns when this lifts, and caps how long it can ever hold.
 * LINKS: src/shared/ui/BrandLoader.tsx (the one loading visual);
 *        src/features/auth/components/AuthGate.tsx (consumer + hold rules);
 *        src/shared/lib/appReady.ts (what it waits on);
 *        app.json (splash.backgroundColor must match colors.background).
 */

import { StyleSheet, View } from 'react-native';

import { colors } from '@/shared/theme';
import { BrandLoader } from '@/shared/ui';

export function BrandSplash() {
  return (
    <View style={styles.root} testID="brand-splash">
      <BrandLoader testID="brand-splash-loader" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
