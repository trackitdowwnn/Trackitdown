/**
 * WHAT:  Explore tab placeholder — will become the map + list search of
 *        active stolen-car posts (features/search-map).
 * WHY:   Stands in so the tab bar is real and navigable now; includes a link
 *        to a full-screen route (outside the tab group) to demo that pushed
 *        flows naturally cover the bar.
 * LINKS: src/app/(tabs)/_layout.tsx; docs/BUILD_PLAN.md (Search).
 */

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, sizes, spacing, typography } from '@/shared/theme';

export default function ExploreScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>Explore</Text>
        <Text style={styles.body}>The map and list of active posts land here.</Text>
        <Link href="/wizard-demo" style={styles.link}>
          Open a full-screen flow (covers the tab bar) →
        </Link>
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
  link: {
    ...typography.label,
    color: colors.primary,
    paddingVertical: spacing.lg,
    minHeight: sizes.touchTarget,
  },
});
