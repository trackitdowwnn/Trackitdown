/**
 * WHAT:  KeepAliveFace — one face of a segmented surface, kept MOUNTED whether
 *        or not it is the one being looked at, and hidden from touch and from
 *        both platforms' screen readers when it is not.
 * WHY:   Switching a segment by swapping components unmounts the other one:
 *        scroll position gone, data refetched, entrance animation replayed
 *        every single time. Keeping both mounted and hiding one fixes that —
 *        but a hidden-by-opacity subtree is still fully present, so hiding it
 *        VISUALLY is only a third of the job.
 *
 *        ⚠️ THE THREE PROPS ARE A SET, AND TWO OF THEM ARE SINGLE-PLATFORM.
 *        `accessibilityElementsHidden` is iOS-only and
 *        `importantForAccessibility` is Android-only, so dropping either one
 *        leaves a whole invisible screen readable on that platform — a
 *        conversation list announced on top of a notification list — while
 *        looking perfect to a sighted reviewer. `pointerEvents` is the third:
 *        an invisible list must not catch a touch. They are together here so
 *        that a caller cannot get two out of three right.
 *
 *        ⚠️ OPACITY, NOT `display: 'none'`. Setting display collapses the
 *        subtree to 0×0 in Yoga, so a virtualized list inside it measures an
 *        empty viewport, drops its rendered window, and has to re-measure on
 *        reveal — the blank first frame this component exists to remove, plus
 *        the scroll offset at risk. Opacity keeps it laid out, so the switch is
 *        a hard cut.
 *
 *        ⚠️ SHARED PARTLY BECAUSE IT COULD NOT BE TESTED WHERE IT LIVED. This
 *        began as a local component inside `src/app/(tabs)/inbox.tsx`, which
 *        was the right call for a single consumer — until it turned out that
 *        expo-router's `require.context` bundles EVERY `.tsx` under the app
 *        root (only `+api`/`+html`/`+middleware` are excluded), so a test file
 *        beside a route pulls the test library into the app bundle and breaks
 *        `expo export`. A contract this easy to half-implement should not be
 *        the one piece of the app that cannot have a test.
 * LINKS: src/app/(tabs)/inbox.tsx (the consumer);
 *        docs/design-refs/inbox/GAP_ANALYSIS.md ("Verify before trusting").
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

export interface KeepAliveFaceProps {
  /** Whether this face is the one on screen. */
  active: boolean;
  children: ReactNode;
  testID?: string;
}

export function KeepAliveFace({ active, children, testID }: KeepAliveFaceProps) {
  return (
    <View
      style={[styles.face, !active && styles.hidden]}
      pointerEvents={active ? 'auto' : 'none'}
      // iOS
      accessibilityElementsHidden={!active}
      // Android
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
      testID={testID}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    ...StyleSheet.absoluteFill,
  },
  hidden: {
    opacity: 0,
    // Belt and braces: parent `pointerEvents` has historically been unreliable
    // on Android, and a fully-laid-out invisible surface must not catch a touch.
    zIndex: -1,
  },
});
