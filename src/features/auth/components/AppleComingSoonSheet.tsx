/**
 * WHAT:  AppleComingSoonSheet — a small sheet saying Sign in with Apple is
 *        coming soon, shown when Android's "Continue with Apple" is tapped
 *        before Apple sign-in is switched on.
 * WHY:   2026-10-15 (owner: "add a continue with app[le] button on the sign in
 *        bottom sheet but make it open a bottom sheet that says coming soon …
 *        for the minute"). Apple on Android is built (#199) but waits on the
 *        Apple Developer setup; the button shows people it's on its way and
 *        points them at the ways that work today.
 *
 *        MOUNTED ONLY WHILE OPEN, and opens itself: the sign-in sheet tucks
 *        away beneath it and returns when it closes (the sheet library's
 *        stacking). Never mounted otherwise, so it costs the sign-in sheet
 *        nothing and can never be the sheet a dismissal reaches.
 * LINKS: ./AuthSheet.tsx (mounts it); ../api/authApi.ts
 *        (isAppleWebSignInConfigured — once true, the button signs in instead).
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

export function AppleComingSoonSheet({
  onClose,
  googleAvailable,
}: {
  onClose: () => void;
  /** Only point at Google when Google is actually offered. */
  googleAvailable: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const sheetRef = useRef<BottomSheetRef>(null);

  useEffect(() => {
    sheetRef.current?.open();
  }, []);

  return (
    <BottomSheet ref={sheetRef} title="Sign in with Apple" onDismiss={onClose}>
      <View style={styles.body} testID="apple-coming-soon">
        <Text style={styles.heading} accessibilityRole="header">
          Coming soon
        </Text>
        <Text style={styles.text}>
          Signing in with Apple is on its way. For now, continue with{' '}
          {googleAvailable ? 'Google or your email' : 'your email'} — it only takes a moment.
        </Text>
        <Button label="Got it" onPress={() => sheetRef.current?.close()} />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    body: {
      gap: spacing.md,
    },
    heading: {
      ...typography.heading,
      color: c.textPrimary,
    },
    text: {
      ...typography.body,
      color: c.textSecondary,
    },
  });
