/**
 * WHAT:  Web fallback for AppMap. react-native-maps has no web support, so the
 *        pannable map degrades to a labelled placeholder; LocationPicker's
 *        search box (its accessible path) still sets a location.
 * WHY:   web is a build target and importing react-native-maps on web breaks
 *        the bundle. Metro resolves this `.web` file automatically, keeping the
 *        native map SDK out of the web build.
 * LINKS: src/shared/ui/AppMap.tsx (native), src/shared/ui/LocationPicker.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import type { MapComponentProps } from './LocationPicker';

export function AppMap(_props: MapComponentProps) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.text}>
        The map isn’t available on web — use the search box above to set a location.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.xl,
  },
  text: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
