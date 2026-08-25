/**
 * WHAT:  Screen — the standard page wrapper: warm app background, safe-area
 *        padding, and (optionally) a scroll container with the app's themed
 *        pull-to-refresh. Also exports ThemedRefreshControl for screens whose
 *        scroll container is a list (FlatList/FlashList) rather than Screen's
 *        own ScrollView.
 * WHY:   Every screen was hand-rolling SafeAreaView + background; pull-to-
 *        refresh needs one themed implementation so the spinner is always
 *        on-brand (primary near-black on paper, never the platform default blue).
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
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePalette, useThemedStyles, type Palette } from '../theme';

/**
 * The refresh spinner's colour props for a palette.
 *
 * A separate pure function rather than inline in the component below because
 * it is the only part worth asserting on, and Screen.test.tsx calls
 * ThemedRefreshControl as a PLAIN FUNCTION — a hook inside it would throw
 * "Invalid hook call". This keeps the colours testable without a renderer.
 */
export const refreshControlColors = (c: Palette) => ({
  tintColor: c.primary,
  colors: [c.primary],
  progressBackgroundColor: c.surface,
});

/**
 * RefreshControl in app colours — primary spinner on a paper card (Android).
 *
 * `progressViewOffset` is exposed because a scroll container that starts at
 * y=0 UNDER a floating header (PostDetailScreen) otherwise draws the spinner
 * out of the status bar and through the header’s own buttons. Screens whose
 * content begins below the safe area do not need it.
 */
export function ThemedRefreshControl(
  props: Pick<
    RefreshControlProps,
    'refreshing' | 'onRefresh' | 'testID' | 'progressViewOffset'
  >,
) {
  const palette = usePalette();
  return <RefreshControl {...refreshControlColors(palette)} {...props} />;
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
  /**
   * Set for a scroll screen that contains INPUTS.
   *
   * Without it the first tap on a button while a field is focused is spent
   * dismissing the keyboard, which reads as a button that did nothing — and on
   * a long form the last fields sit underneath the keyboard with no way to
   * reach them. Off by default because it costs a layout wrapper, and most
   * screens here are read-only.
   */
  keyboardAware?: boolean;
  /**
   * Pinned below the scroll — a StickyActionBar, usually holding the primary
   * action so it never scrolls away.
   *
   * ⚠️ A FLEX SIBLING, NOT AN OVERLAY, and that is the whole reason it lives
   * here rather than being dropped on top of a Screen by the caller. An
   * absolutely-positioned bar sits OUTSIDE the KeyboardAvoidingView, so on iOS
   * the keyboard rises straight over the top of it and the primary action of a
   * form is hidden exactly while the form is being filled in. Rendered here it
   * is inside the lift, which is the same shape WizardScreen's footer uses.
   */
  footer?: ReactNode;
}

export function Screen({
  children,
  edges = ['top'],
  scroll = false,
  onRefresh,
  refreshing = false,
  style,
  contentContainerStyle,
  keyboardAware = false,
  footer,
}: ScreenProps) {
  const styles = useThemedStyles(makeStyles);

  const body = (
    <>
      {scroll ? (
        <ScrollView
          testID="screen-scroll"
          style={styles.fill}
          contentContainerStyle={contentContainerStyle}
          // 'handled', not 'always': a tap on a Button still fires while the
          // keyboard is up, but a tap on empty space still dismisses it.
          keyboardShouldPersistTaps={keyboardAware ? 'handled' : undefined}
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
      {footer}
    </>
  );

  return (
    <SafeAreaView style={[styles.container, style]} edges={edges}>
      {keyboardAware ? (
        // iOS needs the view lifted, so KeyboardAvoidingView does it here.
        //
        // ⚠️ ANDROID IS NOT HANDLED HERE, and the comment that used to sit on
        // this line said adjustResize took care of it — which stopped being
        // true at Expo SDK 57, where edge-to-edge means the window no longer
        // resizes for the keyboard. Anything PINNED on Android must lift itself
        // by the measured height (see useAndroidKeyboardHeight, which
        // StickyActionBar uses and which returns 0 on iOS precisely because
        // this wrapper has already done the work there). Do not "simplify" that
        // away on the strength of the old comment.
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    fill: {
      flex: 1,
    },
  });
