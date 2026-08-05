/**
 * WHAT:  SurfaceTabs — the in-screen "which face am I on" switch: left-aligned
 *        text tabs with an ink underline on the active one, sitting on a
 *        full-bleed hairline that closes the screen's chrome off from its
 *        content. First consumer: the Inbox tab (Messages | Notifications).
 * WHY:   Its predecessor was a segmented pill track, and that was the problem:
 *        the Inbox stacks a surface switch ON a filter-chip row, and two pill
 *        rows with different jobs read as one confusing band no matter how the
 *        fills differ. Underline tabs are a DIFFERENT GRAMMAR — the shape says
 *        navigation, the way pills say filter — so the two rows stop competing.
 *        The hairline runs full width while the tabs sit in the screen gutter,
 *        which is what makes the rule read as a boundary rather than a
 *        decoration.
 *
 *        Active state is colour + weight + underline, never size: label and
 *        line height are pinned identical across states, because a family swap
 *        that changes line height nudges the row 2px on every tap — small
 *        enough to look like a rendering fault rather than a transition. No
 *        animation on the underline by design (motion here is restraint, and a
 *        sliding indicator would be the loudest thing on a list screen).
 * LINKS: docs/DESIGN_SYSTEM.md (Typography — weight is a family; Colour);
 *        src/shared/ui/ChoiceChips.tsx (the sibling this must NOT resemble —
 *        chips filter a list, tabs choose a surface);
 *        src/app/(tabs)/inbox.tsx (first consumer).
 *
 * Usage — place it EDGE TO EDGE, with no horizontal padding of its own; the
 * component owns the gutter so its hairline can reach both screen edges:
 *   <SurfaceTabs
 *     options={[{ value: 'messages', label: 'Messages' }, { value: 'notifications', label: 'Notifications' }]}
 *     value={segment}
 *     onSelect={setSegment}
 *   />
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, sizes, spacing, typography } from '../theme';

export interface SurfaceTabOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SurfaceTabsProps<V extends string = string> {
  options: SurfaceTabOption<V>[];
  value: V;
  onSelect: (value: V) => void;
}

export function SurfaceTabs<V extends string = string>({
  options,
  value,
  onSelect,
}: SurfaceTabsProps<V>) {
  return (
    <View style={styles.rule}>
      <View style={styles.row} accessibilityRole="tablist">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => [styles.tab, pressed && !selected && styles.tabPressed]}
              testID={`surface-tab-${option.value}`}
            >
              <Text
                style={[styles.label, selected && styles.labelSelected]}
                numberOfLines={1}
                // The tabs are the widest fixed row on the screen; past this
                // the two labels collide rather than wrap (numberOfLines={1}).
                maxFontSizeMultiplier={1.4}
              >
                {option.label}
              </Text>
              {selected ? (
                <View
                  style={styles.underline}
                  testID={`surface-tab-${option.value}-underline`}
                />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-bleed: the rule reaches both screen edges, the tabs do not.
  rule: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  tab: {
    // Content-width, so the underline is the label's width — an equal-width
    // split would rebuild the segmented track this replaced.
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  tabPressed: {
    opacity: 0.6,
  },
  // Size and line height are pinned across states; only family and colour
  // move (see header).
  label: {
    ...typography.body,
    lineHeight: 24,
    color: colors.textSecondary,
  },
  labelSelected: {
    ...typography.cardTitle,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  // Sits ON the row's hairline rather than above it, so the active tab reads
  // as cutting through the rule.
  underline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: sizes.surfaceTabUnderline,
    backgroundColor: colors.primary,
  },
});
