/**
 * WHAT:  Placeholder home screen shown at the app root route.
 * WHY:   Keeps the app runnable after the create-expo-app boilerplate was
 *        removed; replaced once the first real feature screen is built.
 * LINKS: Rendered by src/app/_layout.tsx. See docs/ARCHITECTURE.md for where
 *        real feature screens live (under src/features).
 */

import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trackitdown</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
  },
});
