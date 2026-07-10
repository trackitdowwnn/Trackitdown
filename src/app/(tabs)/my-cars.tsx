/**
 * WHAT:  My Cars tab placeholder — will list the owner's posts and their
 *        status (features/vehicles).
 * WHY:   Stands in so the tab bar is real and navigable now.
 * LINKS: src/app/(tabs)/_layout.tsx; docs/BUILD_PLAN.md (Post a car).
 */

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/shared/theme';

export default function MyCarsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>My cars</Text>
        <Text style={styles.body}>Your posts and their status land here.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
