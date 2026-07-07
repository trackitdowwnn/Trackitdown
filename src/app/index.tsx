/**
 * WHAT:  Placeholder home screen shown at the app root route, with a link into
 *        the dev component sandbox.
 * WHY:   Keeps the app runnable after the create-expo-app boilerplate was
 *        removed, and gives quick access to the shared-component playground
 *        while feature screens don't exist yet. Replaced once the first real
 *        feature screen is built.
 * LINKS: Rendered by src/app/_layout.tsx; links to src/app/sandbox.tsx. See
 *        docs/ARCHITECTURE.md for where real feature screens live.
 */

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trackitdown</Text>
      <Link href="/sandbox" style={styles.link}>
        Open component sandbox →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
});
