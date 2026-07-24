/**
 * WHAT:  SelectScreen — the full-screen searchable option picker that opens
 *        from a SelectField (or standalone): header with close X and title,
 *        a pill search bar with debounced filtering, a sticky-sectioned
 *        option list with icons/subtitles and a `primary` checkmark on the
 *        selected row (active state), and an EmptyState for no matches. Opt-in extras
 *        (default off, so existing selects are unchanged): `autoFocusSearch`
 *        false for browse-first pickers; `pinnedTitle` to head the pinned
 *        group ("Popular makes"); `manualEntry` for free-text selects (typing a
 *        value with no exact match surfaces a "Use "<query>"" row);
 *        `showIndex` for an A–Z jump-scroll rail; `stagger` for a restrained
 *        first-load row cascade.
 * WHY:   Dropdown menus cramp on mobile; the Airbnb pattern gives every
 *        select in the app (car make, colour, future filters) room to
 *        search and generous touch targets. Presented as a self-contained
 *        RN Modal (slide-up + fade, 200–250ms ease-out, reversed on close,
 *        reduce-motion aware) so any screen can open one without route
 *        wiring. The list is a FlatList (headers as items +
 *        stickyHeaderIndices) — FlashList was assessed but does not support
 *        sticky section headers, a core requirement, and 40–50 rows need no
 *        virtualization. Single-select in v1; see the TODO(multi-select) in
 *        handleSelect for where checkboxes + a Done button plug in.
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
  FadeIn,
  FadeInDown,
  FadeOut,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
  runOnJS,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { lightHaptic } from '../lib/haptics';
import { colors, motion, radii, sizes, spacing, typography } from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { EmptyState } from './EmptyState';
import {
  buildSelectList,
  optionCount,
  sectionAnchors,
  stickyHeaderIndices,
  type SectionAnchor,
  type SelectListItem,
  type SelectOption,
} from './selectOptions';

/** Open/close motion, at the design system's upper bound. */
const MOTION_MS = motion.standard;
const motionEasing = easeOut;
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
  /** Values pinned at the top under `pinnedTitle` while not searching (recent
   *  selections, or a curated "popular" set). */
  recentValues?: V[];
  /** Heading for the pinned group. Defaults to "Recent". */
  pinnedTitle?: string;
  /** Auto-focus the search on open (search-first). Off ⇒ browse-first: the
   *  list leads and the keyboard only rises when the field is tapped. */
  autoFocusSearch?: boolean;
  /** Free-text escape hatch for non-enum selects (car make/model). When set, a
   *  query with no exact match offers a "Use "<query>"" row that submits the
   *  typed text via `onSubmit`. */
  manualEntry?: { onSubmit: (text: string) => void };
  /** Show an A–Z jump-scroll index rail down the right edge (long lists). */
  showIndex?: boolean;
  /** Soft stagger-in of rows on the first open (restrained motion). */
  stagger?: boolean;
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
  pinnedTitle,
  autoFocusSearch = true,
  manualEntry,
  showIndex = false,
  stagger = false,
}: SelectScreenProps<V>) {
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<SelectListItem<V>>>(null);
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
  // Reanimated can deliver a close's exit callback AFTER a fast reopen;
  // letting it knock `mounted` false while `visible` is true would blank the
  // reopened screen for good (the parent has no reason to flip `visible`
  // again). Re-assert during render — React discards this pass and retries —
  // so a stale unmount never commits.
  if (visible && !mounted) {
    setMounted(true);
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
  // reuses the mounted Modal (no onShow), but the content remounted. Skipped
  // for browse-first pickers (autoFocusSearch=false) so the list leads.
  useEffect(() => {
    if (!visible || !autoFocusSearch) {
      return;
    }
    const timer = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [visible, autoFocusSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(
    () => buildSelectList(options, debouncedQuery, recentValues, pinnedTitle),
    [options, debouncedQuery, recentValues, pinnedTitle],
  );

  // An exact (case/space-insensitive) label match means the query is already a
  // listed option — no need to offer "Use "<query>"".
  const hasExactMatch = useMemo(
    () =>
      manualEntry != null &&
      debouncedQuery.trim().length > 0 &&
      options.some((option) => option.label.trim().toLowerCase() === debouncedQuery.trim().toLowerCase()),
    [manualEntry, debouncedQuery, options],
  );
  const showUseQuery = manualEntry != null && debouncedQuery.trim().length > 0 && !hasExactMatch;

  const submitManual = (text: string) => {
    manualEntry?.onSubmit(text.trim());
    onClose();
  };

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
    lightHaptic(); // a light tick confirms the pick
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
      onShow={autoFocusSearch ? () => searchRef.current?.focus() : undefined}
    >
      {/* Static opaque backdrop — covers the screen the WHOLE time the modal is
          mounted (through both the enter and exit animations). The Modal is
          `transparent`, so without this the sheet's slide/fade would reveal the
          screen behind it (e.g. the wizard's Next button bleeding through and
          flickering on Android). The sheet animates over this solid fill. */}
      <View style={styles.backdrop}>
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
                    title={`No matches for “${debouncedQuery}”`}
                    body={
                      manualEntry
                        ? 'Not in the list? Add it as you typed it.'
                        : 'Check the spelling or try a shorter search.'
                    }
                    actionLabel={manualEntry ? `Use “${debouncedQuery.trim()}”` : 'Clear search'}
                    onAction={
                      manualEntry ? () => submitManual(debouncedQuery) : () => setQuery('')
                    }
                  />
                ) : (
                  <EmptyState title="Nothing to choose from yet" />
                )
              ) : (
                <View style={styles.flex}>
                  <FlatList
                    ref={listRef}
                    accessibilityRole="radiogroup"
                    data={items}
                    keyExtractor={(item) => item.key}
                    stickyHeaderIndices={stickyHeaderIndices(items)}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    contentContainerStyle={[
                      styles.listContent,
                      // Clear the index rail so the last rows aren't hidden under it.
                      showIndex && !debouncedQuery ? styles.listContentIndexed : null,
                    ]}
                    // Jump-scroll can target a header far down; approximate then settle.
                    onScrollToIndexFailed={(info) => {
                      listRef.current?.scrollToOffset({
                        offset: info.averageItemLength * info.index,
                        animated: true,
                      });
                    }}
                    ListHeaderComponent={
                      showUseQuery ? (
                        <ManualRow
                          label={`Use “${debouncedQuery.trim()}”`}
                          onPress={() => submitManual(debouncedQuery)}
                        />
                      ) : null
                    }
                    renderItem={({ item, index }) => (
                      <SelectRow
                        item={item}
                        selectedValue={value}
                        onSelect={handleSelect}
                        stagger={stagger && !debouncedQuery ? index : undefined}
                      />
                    )}
                  />
                  {showIndex && !debouncedQuery ? (
                    <IndexRail
                      // Only the A–Z letter sections — a multi-word pinned
                      // header (e.g. "Popular makes") would put a stray letter
                      // on the rail; that group sits at the top anyway.
                      anchors={sectionAnchors(items).filter((anchor) => /^[A-Z]$/.test(anchor.title))}
                      onJump={(index) =>
                        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 })
                      }
                    />
                  ) : null}
                </View>
              )}
            </SafeAreaView>
          </Animated.View>
        </Animated.View>
      ) : null}
      </View>
    </Modal>
  );
}

/** Per-row stagger delay + cap — the sanctioned list cadence: the LAST row
 *  starts within the ≤300ms budget (5×50 = 250ms spread), matching the
 *  motion.listStagger token; docs/DESIGN_SYSTEM.md Motion. */
const STAGGER_STEP_MS = motion.listStagger;
const STAGGER_MAX_STEPS = 5;

function SelectRow<V extends string | number>({
  item,
  selectedValue,
  onSelect,
  stagger,
}: {
  item: SelectListItem<V>;
  selectedValue: V | null;
  onSelect: (value: V) => void;
  /** Row index for the first-load stagger, or undefined to skip. */
  stagger?: number;
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
  const entering =
    stagger !== undefined
      ? FadeInDown.duration(motion.fast)
          .delay(Math.min(stagger, STAGGER_MAX_STEPS) * STAGGER_STEP_MS)
          .reduceMotion(ReduceMotion.System)
      : undefined;

  return (
    <Animated.View entering={entering}>
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
    </Animated.View>
  );
}

/** The type-to-add "Use "<query>"" free-text row (manual-entry escape hatch). */
function ManualRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Feather name="plus" size={typography.body.fontSize} color={colors.primary} />
      </View>
      <Text numberOfLines={1} style={[styles.rowLabel, styles.manualAction]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A–Z jump-scroll rail down the right edge; each letter scrolls to its
 *  section. The list itself remains the accessible primary navigation. */
function IndexRail({
  anchors,
  onJump,
}: {
  anchors: SectionAnchor[];
  onJump: (index: number) => void;
}) {
  return (
    <View style={styles.indexRail} pointerEvents="box-none">
      {anchors.map((anchor) => (
        <Pressable
          key={anchor.title}
          accessibilityRole="button"
          accessibilityLabel={`Jump to ${anchor.title}`}
          onPress={() => onJump(anchor.index)}
          hitSlop={spacing.sm}
          style={styles.indexLetter}
        >
          {/* One-glyph anchors (letters); a longer pinned title collapses to its
              first letter so the rail stays a tidy column. */}
          <Text style={styles.indexLetterText}>{anchor.title.charAt(0)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // Static opaque fill behind the animating sheet, so the transparent Modal
  // never reveals the screen behind it during the slide/fade (Android bleed-
  // through / footer flicker). Same colour as the sheet so the content appears
  // to rise over one continuous surface.
  backdrop: {
    flex: 1,
    backgroundColor: colors.background,
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
  // Extra right padding so rows clear the index rail when it's shown.
  listContentIndexed: {
    paddingRight: spacing.lg,
  },
  // The "Use "<query>"" free-text row reads in the accent ink (an action).
  manualAction: {
    color: colors.primary,
  },
  // The A–Z rail floats over the list's right edge, vertically centred.
  indexRail: {
    position: 'absolute',
    right: spacing.xs,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indexLetter: {
    paddingVertical: sizes.indexRailLetterPad,
    paddingHorizontal: spacing.xs,
  },
  indexLetterText: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textSecondary,
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
    // Fits a small make monogram / logo; smaller glyphs (colour dots) centre.
    width: sizes.circleButtonSm,
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
