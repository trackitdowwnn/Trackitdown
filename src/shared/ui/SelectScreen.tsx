/**
 * WHAT:  SelectScreen — the full-screen searchable option picker that opens
 *        from a SelectField (or standalone): header with close X and title,
 *        auto-focused pill search bar with debounced filtering, a sticky-
 *        sectioned option list with icons/subtitles and a sage checkmark on
 *        the selected row, and an EmptyState for no matches.
 * WHY:   Dropdown menus cramp on mobile; the Airbnb pattern gives every
 *        select in the app (car make, colour, future filters) room to
 *        search and generous touch targets. Presented as a self-contained
 *        RN Modal (slide-up + fade, 200–250ms ease-out, reversed on close,
 *        reduce-motion aware) so any screen can open one without route
 *        wiring. The list is a FLAT FlatList (headers as items +
 *        stickyHeaderIndices) so swapping to FlashList later is trivial.
 *        Single-select in v1; see the TODO(multi-select) in handleSelect
 *        for where checkboxes + a Done button plug in without breaking the
 *        API.
 * LINKS: src/shared/ui/SelectField.tsx (trigger); src/shared/ui/
 *        selectOptions.ts (filtering/grouping logic); src/shared/ui/
 *        EmptyState.tsx; docs/DESIGN_SYSTEM.md (Motion, Accessibility).
 *
 * Usage:
 *   <SelectScreen
 *     visible={open}
 *     title="Car make"
 *     options={makeOptions}
 *     value={make}
 *     onSelect={setMake}
 *     onClose={() => setOpen(false)}
 *   />
 */

import { Feather } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
  runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, sizes, spacing, typography } from '../theme';
import { EmptyState } from './EmptyState';
import {
  buildSelectList,
  optionCount,
  stickyHeaderIndices,
  type SelectListItem,
  type SelectOption,
} from './selectOptions';

/** Open/close motion, at the design system's upper bound. */
const MOTION_MS = 250;
const motionEasing = Easing.out(Easing.quad);
/** Debounce before a keystroke re-filters the list. */
const FILTER_DEBOUNCE_MS = 150;

export interface SelectScreenProps<V extends string | number> {
  visible: boolean;
  /** Close without choosing (X, Android back). Parent flips `visible`. */
  onClose: () => void;
  options: SelectOption<V>[];
  /** Currently selected value — its row shows the sage checkmark. */
  value: V | null;
  /** Called with the chosen value; the screen then asks to close. */
  onSelect: (value: V) => void;
  /** Centred header title, e.g. "Car make". */
  title?: string;
  searchPlaceholder?: string;
  /** Consumer-fed recent values, shown under "Recent" while not searching. */
  recentValues?: V[];
}

export function SelectScreen<V extends string | number>({
  visible,
  onClose,
  options,
  value,
  onSelect,
  title,
  searchPlaceholder = 'Search',
  recentValues,
}: SelectScreenProps<V>) {
  const searchRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // The Modal must outlive `visible` by one animation so the slide-down
  // exit is seen; `mounted` trails `visible` on close. Opening resets state
  // during render (the "adjust state on prop change" pattern — no effect,
  // no stale-query flash on reopen).
  const [mounted, setMounted] = useState(visible);
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMounted(true);
      setQuery('');
      setDebouncedQuery('');
    }
  }
  // Fallback unmount for the close animation; the exit callback below
  // normally lands first (see exiting= on the sheet).
  useEffect(() => {
    if (visible) {
      return;
    }
    const timer = setTimeout(() => setMounted(false), MOTION_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  // Focus can't ride only on Modal onShow: a reopen within the exit window
  // reuses the mounted Modal (no onShow), but the content remounted.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(
    () => buildSelectList(options, debouncedQuery, recentValues),
    [options, debouncedQuery, recentValues],
  );

  // Tell screen-reader users how the result set changed as they type.
  useEffect(() => {
    if (!debouncedQuery) {
      return;
    }
    const count = optionCount(items);
    AccessibilityInfo.announceForAccessibility(
      count === 1 ? '1 result' : `${count} results`,
    );
  }, [debouncedQuery, items]);

  const handleSelect = (selected: V) => {
    // TODO(multi-select): when multi-select lands, toggle the value in a
    // draft set here and move the commit to a footer Done button instead
    // of closing immediately.
    onSelect(selected);
    onClose();
  };

  if (!mounted) {
    return null;
  }

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      onShow={() => searchRef.current?.focus()}
    >
      {visible ? (
        <Animated.View
          style={styles.sheet}
          entering={SlideInDown.duration(MOTION_MS).easing(motionEasing).reduceMotion(
            ReduceMotion.System,
          )}
          // Unmount when the exit actually finishes (reduce-motion makes it
          // instant), not after a fixed delay — the timer above is a fallback
          // so a dropped callback can't leave an invisible Modal eating touches.
          exiting={SlideOutDown.duration(MOTION_MS)
            .easing(motionEasing)
            .reduceMotion(ReduceMotion.System)
            .withCallback((finished) => {
              'worklet';
              if (finished) {
                runOnJS(setMounted)(false);
              }
            })}
        >
          <Animated.View
            style={styles.flex}
            entering={FadeIn.duration(MOTION_MS).easing(motionEasing).reduceMotion(
              ReduceMotion.System,
            )}
            exiting={FadeOut.duration(MOTION_MS).easing(motionEasing).reduceMotion(
              ReduceMotion.System,
            )}
          >
            <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
              <View style={styles.header}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  onPress={onClose}
                  hitSlop={spacing.sm}
                  style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
                >
                  <Feather name="x" size={typography.heading.fontSize} color={colors.textPrimary} />
                </Pressable>
                {title ? (
                  <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
                    {title}
                  </Text>
                ) : null}
                {/* Spacer balancing the X so the title stays centred. */}
                <View style={styles.close} />
              </View>

              <View style={styles.searchWrap}>
                <View style={styles.search}>
                  <Feather
                    name="search"
                    size={typography.body.fontSize}
                    color={colors.textSecondary}
                  />
                  <TextInput
                    ref={searchRef}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={searchPlaceholder}
                    placeholderTextColor={colors.textSecondary}
                    autoCorrect={false}
                    accessibilityLabel={searchPlaceholder}
                    style={styles.searchInput}
                  />
                  {query.length > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear search"
                      onPress={() => setQuery('')}
                      style={styles.clearSearch}
                    >
                      <Feather
                        name="x-circle"
                        size={typography.body.fontSize}
                        color={colors.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {items.length === 0 ? (
                debouncedQuery ? (
                  <EmptyState
                    title={`No matches for '${debouncedQuery}'`}
                    body="Check the spelling or try a shorter search."
                    actionLabel="Clear search"
                    onAction={() => setQuery('')}
                  />
                ) : (
                  <EmptyState title="Nothing to choose from yet" />
                )
              ) : (
                <FlatList
                  accessibilityRole="radiogroup"
                  data={items}
                  keyExtractor={(item) => item.key}
                  stickyHeaderIndices={stickyHeaderIndices(items)}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => (
                    <SelectRow item={item} selectedValue={value} onSelect={handleSelect} />
                  )}
                />
              )}
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

function SelectRow<V extends string | number>({
  item,
  selectedValue,
  onSelect,
}: {
  item: SelectListItem<V>;
  selectedValue: V | null;
  onSelect: (value: V) => void;
}) {
  if (item.kind === 'header') {
    return (
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {item.title}
        </Text>
      </View>
    );
  }

  const { option } = item;
  const selected = option.value === selectedValue;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={option.subtitle ? `${option.label}, ${option.subtitle}` : option.label}
      accessibilityState={{ checked: selected }}
      onPress={() => onSelect(option.value)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {option.icon ? <View style={styles.rowIcon}>{option.icon}</View> : null}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowLabel}>
          {option.label}
        </Text>
        {option.subtitle ? (
          <Text numberOfLines={1} style={styles.rowSubtitle}>
            {option.subtitle}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Feather name="check" size={typography.heading.fontSize} color={colors.primary} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  close: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  searchWrap: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: sizes.control,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceSubtle,
    paddingLeft: spacing.lg,
    // Trailing padding stays small: the 44pt clear button brings its own.
    paddingRight: spacing.xs,
  },
  clearSearch: {
    minWidth: sizes.touchTarget,
    minHeight: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    paddingVertical: 0,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: sizes.control,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  rowIcon: {
    width: spacing.xl,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
