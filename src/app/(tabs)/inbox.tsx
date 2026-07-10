/**
 * WHAT:  Inbox tab placeholder — will become owner ↔ spotter chat
 *        (features/chat). Includes a dev toggle that hides the tab bar via
 *        the standard tabBarStyle mechanism, to exercise the animated hide.
 * WHY:   Stands in so the tab bar is real and navigable now, and gives a
 *        live way to feel the hide/show slide in the running app.
 * LINKS: src/app/(tabs)/_layout.tsx; src/shared/ui/AppTabBar.tsx (hide
 *        behaviour); docs/BUILD_PLAN.md (Chat).
 */

import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/shared/theme';
import { Button } from '@/shared/ui';

export default function InboxScreen() {
  const navigation = useNavigation();
  const [barHidden, setBarHidden] = useState(false);

  // The standard per-screen mechanism AppTabBar animates on. Cleanup restores
  // the bar so a flow leaving mid-hide never strands it — real full-screen
  // flows (wizard, camera) must copy this shape.
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: barHidden ? { display: 'none' as const } : undefined,
    });
    return () => {
      navigation.setOptions({ tabBarStyle: undefined });
    };
  }, [barHidden, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.body}>Owner ↔ spotter chat lands here.</Text>
        <Button
          label={barHidden ? 'Show tab bar' : 'Hide tab bar'}
          variant="secondary"
          fullWidth={false}
          onPress={() => setBarHidden((hidden) => !hidden)}
        />
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
