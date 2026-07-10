/**
 * WHAT:  Profile tab placeholder — will become the user profile with
 *        reputation and badges (features/profile). Hosts the dev links
 *        (component sandbox, wizard demo) and badge toggles that exercise
 *        the tab bar's dot / count / 9+ states.
 * WHY:   Stands in so the tab bar is real and navigable now; the badge
 *        toggles make the AppTabBar demo self-contained on device.
 * LINKS: src/app/(tabs)/_layout.tsx; src/shared/ui/AppTabBar.tsx
 *        (useTabBadges); docs/BUILD_PLAN.md (Profile).
 */

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, sizes, spacing, typography } from '@/shared/theme';
import { Button, useTabBadges } from '@/shared/ui';

export default function ProfileScreen() {
  const { badges, setBadge } = useTabBadges();
  const inbox = typeof badges.inbox === 'number' ? badges.inbox : 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>Profile</Text>
        <Text style={styles.body}>Reputation and settings land here.</Text>

        <View style={styles.group}>
          <Button
            label={`Inbox unread +1 (now ${inbox})`}
            variant="secondary"
            fullWidth={false}
            onPress={() => setBadge('inbox', inbox + 1)}
          />
          <Button
            label="Clear inbox badge"
            variant="ghost"
            fullWidth={false}
            onPress={() => setBadge('inbox', 0)}
          />
          <Button
            label={badges.myCars ? 'Clear My cars dot' : 'Show My cars dot'}
            variant="secondary"
            fullWidth={false}
            onPress={() => setBadge('myCars', !badges.myCars)}
          />
        </View>

        <View style={styles.group}>
          <Link href="/sandbox" style={styles.link}>
            Component sandbox →
          </Link>
          <Link href="/onboarding?revisit=1" style={styles.link}>
            How Trackitdown works →
          </Link>
        </View>
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
    gap: spacing.lg,
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
  group: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  link: {
    ...typography.label,
    color: colors.primary,
    paddingVertical: spacing.lg,
    minHeight: sizes.touchTarget,
  },
});
