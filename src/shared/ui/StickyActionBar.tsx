/**
 * WHAT:  StickyActionBar — a solid bar pinned below a scrolling screen, holding
 *        the action that must not scroll away. Pass it to `Screen`'s `footer`.
 * WHY:   The Airbnb move: on mobile the primary action is pinned, not parked at
 *        the end of the content. The bug reporter grew to six questions and its
 *        Send button ended up below the fold.
 *
 *        ⚠️ IT LIVES IN shared/ WITH ONE CONSUMER, which is below
 *        ARCHITECTURE.md's usual "two features need the same thing" bar, so
 *        here is the reasoning rather than a pretence that the bar was met.
 *        This pairs with `Screen`'s `footer` slot — shared infrastructure that
 *        any screen with inputs can now use — and the two are useless apart:
 *        the slot with no bar is an unstyled child, the bar outside the slot is
 *        the keyboard bug described below.
 *
 *        `PostBottomBar` is the older precedent ("The Airbnb move — the primary
 *        action never scrolls away") and is deliberately NOT converted to this.
 *        It is a genuinely different pattern: an ABSOLUTE overlay floating over
 *        a photo-led scroll whose content padding compensates for it, on a
 *        screen with no text input and so no keyboard to dodge. Converting it
 *        would mean restructuring PostDetailScreen's layout to gain nothing.
 *        If a third screen wants a pinned action, use this one.
 *
 *        ⚠️ A FLEX CHILD, NOT AN ABSOLUTE OVERLAY. The obvious build is
 *        `position: absolute; bottom: 0` plus a matching bottom padding on the
 *        scroll content, and it is wrong on iOS: an absolute bar sits outside
 *        `Screen`'s KeyboardAvoidingView, so the keyboard rises over it and the
 *        Send button of a FORM disappears exactly while the form is being
 *        typed into. Rendered through `Screen`'s `footer` slot the bar is
 *        inside the lift, the ScrollView shrinks to fit, and no padding
 *        compensation exists to drift out of sync. WizardScreen's footer has
 *        the same shape for the same reason.
 *
 *        Android is edge-to-edge under Expo SDK 57, so the window does not
 *        resize for the keyboard and the bar has to lift itself —
 *        `useAndroidKeyboardHeight()` returns 0 on iOS, where
 *        KeyboardAvoidingView has already done it.
 * LINKS: src/features/profile/screens/ReportBugScreen.tsx (consumer);
 *        src/features/vehicles/components/PostBottomBar.tsx (the precedent);
 *        src/shared/ui/Screen.tsx (the `footer` slot);
 *        src/shared/wizard/WizardScreen.tsx (the same keyboard handling).
 */

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, useThemedStyles, type Palette } from '@/shared/theme';

import { useAndroidKeyboardHeight } from '../hooks';

export interface StickyActionBarProps {
  /** Usually one Button; a row of two also works. */
  children: ReactNode;
  testID?: string;
}

export function StickyActionBar({ children, testID }: StickyActionBarProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useAndroidKeyboardHeight();

  return (
    <View
      style={[styles.bar, { paddingBottom: insets.bottom + spacing.md + keyboardHeight }]}
      testID={testID}
    >
      {children}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    bar: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      backgroundColor: c.surface,
      // A hairline, not a shadow. Airbnb's own system runs ONE elevation tier
      // and takes depth from whitespace and radius; DESIGN_SYSTEM.md says
      // "prefer none". The line is doing separation, not lift.
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.border,
    },
  });
