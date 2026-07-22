/**
 * WHAT:  Screen — the standard page wrapper: warm app background, safe-area
 *        padding, and (optionally) a scroll container with the app's themed
 *        pull-to-refresh. Also exports ThemedRefreshControl for screens whose
 *        scroll container is a list (FlatList/FlashList) rather than Screen's
 *        own ScrollView.
 * WHY:   Every screen was hand-rolling SafeAreaView + background; pull-to-
 *        refresh needs one themed implementation so the spinner is always
 *        on-brand (primary orange on paper, never the platform default blue).
 *        List screens can't nest inside a ScrollView, so the refresh control
 *        is exported separately instead of forcing a scroll wrapper.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour palette);
 *        src/features/search-map (first consumer, feed pull-to-refresh).
 *
 * Usage:
 *   <Screen>                                   // plain container
 *   <Screen scroll onRefresh={reload} refreshing={isRefreshing}>
 *   <FlashList refreshControl={<ThemedRefreshControl refreshing={r} onRefresh={f} />} />
 */

import type { ReactNode } from 'react';
import type { RefreshControlProps, StyleProp, ViewStyle } from 'react-native';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';

/** RefreshControl in app colours — primary spinner on a paper card (Android). */
export function ThemedRefreshControl(
  props: Pick<RefreshControlProps, 'refreshing' | 'onRefresh' | 'testID'>,
) {
  return (
    <RefreshControl
      tintColor={colors.primary}
      colors={[colors.primary]}
      progressBackgroundColor={colors.surface}
      {...props}
    />
  );
}

export interface ScreenProps {
  children: ReactNode;
  /**
   * Safe-area edges to pad. Defaults to top only — tab screens let content
   * run under the tab bar area, and modals handle their own bottom inset.
   */
  edges?: readonly Edge[];
  /** Wrap children in a ScrollView (required for onRefresh to apply here). */
  scroll?: boolean;
  /** Pull-to-refresh (scroll mode only). Controlled via `refreshing`. */
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Content styling for scroll mode (padding, gap, …). */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  edges = ['top'],
  scroll = false,
  onRefresh,
  refreshing = false,
  style,
  contentContainerStyle,
}: ScreenProps) {
  return (
    <SafeAreaView style={[styles.container, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          testID="screen-scroll"
          style={styles.fill}
          contentContainerStyle={contentContainerStyle}
          refreshControl={
            onRefresh ? (
              <ThemedRefreshControl
                testID="screen-refresh"
                refreshing={refreshing}
                onRefresh={onRefresh}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, contentContainerStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
});
