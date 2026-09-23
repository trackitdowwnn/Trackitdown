/**
 * WHAT:  Web fallback for AppMap. react-native-maps has no web support, so the
 *        pannable map degrades to a labelled placeholder; LocationPicker's
 *        search box (its accessible path) still sets a location.
 * WHY:   web is a build target and importing react-native-maps on web breaks
 *        the bundle. Metro resolves this `.web` file automatically, keeping the
 *        native map SDK out of the web build.
 * LINKS: src/shared/ui/AppMap.tsx (native), src/shared/ui/LocationPicker.tsx.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '../theme';
import type { MapComponentProps } from './LocationPicker';

export interface AppMapExtraProps {
  children?: ReactNode;
  onPress?: () => void;
  /** Ignored on web (kept for prop parity with the native map). */
  interactive?: boolean;
  /** Ignored on web (kept for prop parity with the native map). */
  showsUserLocation?: boolean;
  /** Ignored on web (kept for prop parity with the native map). */
  liteMode?: boolean;
  /**
   * Ignored on web (kept for prop parity with the native map).
   *
   * ⚠️ NEVER CALLED HERE, and callers must cope. This stub renders a sentence,
   * not a map, so anything waiting on `onReady` to fade a placeholder out would
   * wait for ever — which is the correct outcome, because the placeholder is
   * the only thing worth showing on web.
   */
  onReady?: () => void;
}

/** Web stubs matching the native re-exports — render nothing. */
export function AppMapMarker(_props: Record<string, unknown>) {
  return null;
}

export function AppMapPolyline(_props: Record<string, unknown>) {
  return null;
}

export function AppMapCircle(_props: Record<string, unknown>) {
  return null;
}

export function AppMap(_props: MapComponentProps & AppMapExtraProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.fallback}>
      <Text style={styles.text}>
        The map isn’t available on web — use the search box above to set a location.
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    fallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceSubtle,
      padding: spacing.xl,
    },
    text: {
      ...typography.body,
      color: c.textSecondary,
      textAlign: 'center',
    },
  });
