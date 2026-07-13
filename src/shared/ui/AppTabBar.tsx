/**
 * WHAT:  AppTabBar — the app's bottom navigation bar: a custom `tabBar` for
 *        Expo Router's Tabs rendering from a config array (icon, label,
 *        route, badge), with per-tab terracotta badges, a gentle press
 *        spring, active-colour crossfade, and an animated hide for
 *        full-screen flows. Plus TabBadgeProvider/useTabBadges, the tiny
 *        context screens use to set badge counts.
 * WHY:   Navigation chrome is furniture, not a show (Airbnb restraint):
 *        surface bar, hairline top border, no shadow, icons over ALWAYS
 *        visible labels — "My Cars" isn't guessable from a pictogram in a
 *        two-sided app. Tabs are data (add one = add config, not surgery).
 *        The bar implements the React Navigation tabBar contract, so
 *        per-screen `tabBarStyle: { display: 'none' }` hides it — animated
 *        (slide, motion.fast) rather than snapping — for the posting wizard
 *        and camera flows. Pressing a tab replicates the standard contract:
 *        emit `tabPress`, then `navigate` unless prevented — so re-tapping
 *        the ACTIVE tab pops its nested stack to root, and screens opt into
 *        scroll-to-top with React Navigation's `useScrollToTop`. No haptics
 *        by design (app-wide decision). Badge meanings: Inbox unread, My
 *        Cars activity; thresholds live in appTabBarModel.ts.
 * LINKS: src/shared/ui/appTabBarModel.ts (badge rules + spoken labels);
 *        src/app/(tabs)/_layout.tsx (consumer); docs/DESIGN_SYSTEM.md.
 *
 * Usage (inside app/(tabs)/_layout.tsx):
 *   const { badges } = useTabBadges();
 *   <Tabs tabBar={(props) => <AppTabBar {...props} tabs={APP_TABS} badges={badges} />}>
 *     <Tabs.Screen name="explore" />
 *   </Tabs>
 */

// Expo Router SDK 57 vendors React Navigation; this public subpath carries
// the custom-tabBar contract types (no direct @react-navigation dependency).
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { LucideIcon } from 'lucide-react-native';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';

import { colors, motion, sizes, spacing, tabLabelFontScaleCap, typography } from '../theme';
import { type BadgeValue, badgeDisplay, tabAccessibilityLabel } from './appTabBarModel';

/** One tab, as data. Adding a tab is adding an entry, not surgery. */
export interface AppTabConfig {
  /** Route name inside the (tabs) group, e.g. 'explore'. */
  route: string;
  label: string;
  icon: LucideIcon;
  /** Key into the badges record; omit for tabs that never badge. */
  badgeKey?: string;
  /** Spoken wording for a numeric badge (default "N new"). */
  badgeLabel?: (count: number) => string;
}

/**
 * The prominent centre action (e.g. "Report a stolen car"). Not a tab — a
 * one-tap ACTION that launches a full-screen flow, so it's a filled circle
 * between the two halves of tabs, announced as a button, not a tab.
 */
export interface TabBarAction {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}

export interface AppTabBarProps extends BottomTabBarProps {
  tabs: AppTabConfig[];
  /** Badge values keyed by AppTabConfig.badgeKey (from useTabBadges). */
  badges?: Record<string, BadgeValue>;
  /** Optional centre action button, rendered between the two tab halves. */
  action?: TabBarAction;
}

/** Icon stroke weights: lucide's outline look, weighted when active. */
const STROKE_INACTIVE = 2;
const STROKE_ACTIVE = 2.5;

export function AppTabBar({
  state,
  descriptors,
  navigation,
  insets,
  tabs,
  badges,
  action,
}: AppTabBarProps) {
  // React Compiler opt-out: shared values are mutated from press handlers.
  'use no memo';
  const reduceMotion = useReducedMotion();

  // The focused screen controls visibility via the standard mechanism.
  const focusedOptions = descriptors[state.routes[state.index]?.key]?.options;
  const flatTabBarStyle = StyleSheet.flatten(focusedOptions?.tabBarStyle) as
    | ViewStyle
    | undefined;
  const hidden = flatTabBarStyle?.display === 'none';

  const barHeight = sizes.tabBar + insets.bottom;
  const visibility = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    visibility.value = withTiming(hidden ? 0 : 1, { duration: reduceMotion ? 0 : motion.fast });
  }, [hidden, reduceMotion, visibility]);

  const hideStyle = useAnimatedStyle(() => ({
    height: visibility.value * barHeight,
    transform: [{ translateY: (1 - visibility.value) * barHeight }],
  }));

  return (
    <Animated.View
      // pointerEvents lives in style (the prop form is deprecated in RN).
      style={[styles.bar, hideStyle, { pointerEvents: hidden ? 'none' : 'auto' } as ViewStyle]}
      testID="app-tab-bar"
    >
      <View style={[styles.row, { paddingBottom: insets.bottom }]}>
        {/* Filter FIRST so "tab 2 of 4" counts visible tabs, not navigator
            routes — hidden utility screens must not skew spoken positions. */}
        {(() => {
          const visible = state.routes
            .map((route, navIndex) => ({
              route,
              navIndex,
              config: tabs.find((tab) => tab.route === route.name),
            }))
            .filter((item) => item.config !== undefined);

          const renderTab = (
            { route, navIndex, config }: (typeof visible)[number],
            visibleIndex: number,
          ) => {
            const tabConfig = config as AppTabConfig;
            const badge = tabConfig.badgeKey ? badges?.[tabConfig.badgeKey] : undefined;
            return (
              <TabItem
                key={route.key}
                config={tabConfig}
                active={state.index === navIndex}
                badge={badge}
                accessibilityLabel={tabAccessibilityLabel(
                  tabConfig.label,
                  visibleIndex,
                  visible.length,
                  badge,
                  tabConfig.badgeLabel,
                )}
                reduceMotion={reduceMotion}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!event.defaultPrevented) {
                    // On the focused tab this pops its nested stack to root;
                    // screens using useScrollToTop react to the emit above.
                    navigation.navigate(route.name);
                  }
                }}
              />
            );
          };

          if (!action) {
            return visible.map((item, index) => renderTab(item, index));
          }
          // Split the tabs evenly around the centre action button.
          const mid = Math.ceil(visible.length / 2);
          return (
            <>
              {visible.slice(0, mid).map((item, index) => renderTab(item, index))}
              <ActionButton action={action} reduceMotion={reduceMotion} />
              {visible.slice(mid).map((item, index) => renderTab(item, mid + index))}
            </>
          );
        })()}
      </View>
    </Animated.View>
  );
}

function TabItem({
  config,
  active,
  badge,
  accessibilityLabel,
  reduceMotion,
  onPress,
}: {
  config: AppTabConfig;
  active: boolean;
  badge: BadgeValue;
  accessibilityLabel: string;
  reduceMotion: boolean;
  onPress: () => void;
}) {
  'use no memo';
  const Icon = config.icon;
  // 0 → inactive, 1 → active; drives the icon crossfade and label colour.
  const activeSv = useSharedValue(active ? 1 : 0);
  const pressScale = useSharedValue(1);

  useEffect(() => {
    activeSv.value = withTiming(active ? 1 : 0, { duration: reduceMotion ? 0 : motion.fast });
  }, [active, reduceMotion, activeSv]);

  const handlePress = () => {
    if (!reduceMotion) {
      // Gentle 1 → 1.15 → settle inside the 200ms budget; a default spring
      // would oscillate past the design system's motion window.
      pressScale.value = withSequence(
        withTiming(motion.tabPressScale, { duration: motion.fast / 2 }),
        withTiming(1, { duration: motion.fast / 2, easing: Easing.out(Easing.cubic) }),
      );
    }
    onPress();
  };

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: activeSv.value }));
  const inactiveIconStyle = useAnimatedStyle(() => ({ opacity: 1 - activeSv.value }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(activeSv.value, [0, 1], [colors.textSecondary, colors.primary]),
  }));

  const display = badgeDisplay(badge);

  return (
    <Pressable
      style={styles.item}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      testID={`app-tab-${config.route}`}
    >
      <Animated.View style={[styles.iconStack, iconWrapStyle]}>
        {/* SVG colours can't animate directly — two icons crossfade instead. */}
        <Animated.View style={inactiveIconStyle}>
          <Icon size={sizes.icon} color={colors.textSecondary} strokeWidth={STROKE_INACTIVE} />
        </Animated.View>
        <Animated.View style={[styles.iconOverlay, activeIconStyle]}>
          <Icon size={sizes.icon} color={colors.primary} strokeWidth={STROKE_ACTIVE} />
        </Animated.View>

        {display.kind !== 'none' ? (
          <Animated.View
            entering={reduceMotion ? undefined : ZoomIn.duration(motion.fast)}
            style={[styles.badgeAnchor]}
            testID={`app-tab-${config.route}-badge`}
          >
            {display.kind === 'dot' ? (
              <View style={styles.badgeDot} />
            ) : (
              <View style={styles.badgePill}>
                <Text style={styles.badgeText} maxFontSizeMultiplier={1}>
                  {display.text}
                </Text>
              </View>
            )}
          </Animated.View>
        ) : null}
      </Animated.View>

      <Animated.Text
        style={[styles.label, labelStyle]}
        numberOfLines={1}
        maxFontSizeMultiplier={tabLabelFontScaleCap}
      >
        {config.label}
      </Animated.Text>
    </Pressable>
  );
}

/** The prominent centre action — a filled primary circle with the same gentle
 *  press spring as a tab, but announced as a button (an action, not a tab). */
function ActionButton({ action, reduceMotion }: { action: TabBarAction; reduceMotion: boolean }) {
  'use no memo';
  const Icon = action.icon;
  const pressScale = useSharedValue(1);

  const handlePress = () => {
    if (!reduceMotion) {
      pressScale.value = withSequence(
        withTiming(motion.tabPressScale, { duration: motion.fast / 2 }),
        withTiming(1, { duration: motion.fast / 2, easing: Easing.out(Easing.cubic) }),
      );
    }
    action.onPress();
  };

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));

  return (
    <Pressable
      style={styles.action}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel}
      testID={action.testID ?? 'app-tab-action'}
    >
      <Animated.View style={[styles.actionCircle, circleStyle]}>
        <Icon size={sizes.icon} color={colors.textOnPrimary} strokeWidth={STROKE_ACTIVE} />
      </Animated.View>
    </Pressable>
  );
}

// ---- Badge context ---------------------------------------------------------

interface TabBadgesValue {
  badges: Record<string, BadgeValue>;
  /** Set a tab's badge: a count, true for a dot, or 0/false/undefined to clear. */
  setBadge: (key: string, value: BadgeValue) => void;
}

const TabBadgesContext = createContext<TabBadgesValue | null>(null);

/** Hosts badge state above the Tabs so any screen can set counts. */
export function TabBadgeProvider({ children }: { children: ReactNode }) {
  const [badges, setBadges] = useState<Record<string, BadgeValue>>({});
  const setBadge = useCallback((key: string, value: BadgeValue) => {
    setBadges((previous) => ({ ...previous, [key]: value }));
  }, []);
  const value = useMemo(() => ({ badges, setBadge }), [badges, setBadge]);
  return <TabBadgesContext.Provider value={value}>{children}</TabBadgesContext.Provider>;
}

export function useTabBadges(): TabBadgesValue {
  const context = useContext(TabBadgesContext);
  if (!context) {
    throw new Error('useTabBadges must be used inside a TabBadgeProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    overflow: 'hidden', // clips the row while the bar slides away
  },
  row: {
    flexDirection: 'row',
    height: '100%',
  },
  item: {
    flex: 1, // full-width share: the touch target is the whole column (56pt)
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  // Same column share as a tab so the row stays balanced; the circle is the
  // visible affordance, the whole column is the touch target.
  action: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircle: {
    width: sizes.control,
    height: sizes.control,
    borderRadius: sizes.control / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconStack: {
    width: sizes.icon,
    height: sizes.icon,
  },
  iconOverlay: {
    position: 'absolute',
  },
  badgeAnchor: {
    position: 'absolute',
    top: -spacing.xs,
    right: -spacing.sm,
  },
  // accentText, not accent: white 11pt text on plain terracotta is ~3.2:1
  // (below AA); on the darker text-grade terracotta it passes. The dot
  // matches so both badge forms read as one colour.
  badgeDot: {
    width: sizes.badgeDot,
    height: sizes.badgeDot,
    borderRadius: sizes.badgeDot / 2,
    backgroundColor: colors.accentText,
  },
  badgePill: {
    minWidth: sizes.badgePill,
    height: sizes.badgePill,
    borderRadius: sizes.badgePill / 2,
    backgroundColor: colors.accentText,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  badgeText: {
    ...typography.tabLabel,
    color: colors.textOnPrimary,
  },
  label: {
    ...typography.tabLabel,
  },
});
