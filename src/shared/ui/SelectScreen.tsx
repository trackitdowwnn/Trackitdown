/**
 * WHAT:  SelectScreen — the full-screen searchable option picker that opens
 *        from a SelectField (or standalone): header with close X and title,
 *        a pill search bar with debounced filtering, a sticky-sectioned
 *        option list with icons/subtitles and an ink checkmark on the
 *        selected row (ListRow's), and an EmptyState for no matches. Opt-in extras
 *        (default off, so existing selects are unchanged): `autoFocusSearch`
 *        false for browse-first pickers; `pinnedTitle` to head the pinned
 *        group ("Popular makes"); `manualEntry` for free-text selects (typing a
 *        value with no exact match surfaces a "Use "<query>"" row);
 *        `showIndex` for an A–Z jump-scroll rail; `stagger` for a restrained
 *        first-load row cascade; `anyOption` for a filter's "Any make" first
 *        row; `pinnedLayout="grid"` to draw the pinned group as two-up tiles
 *        above an `allTitle` heading ("All makes"). Rows are divided by a
 *        gutter-inset hairline and carry ListRow's check. Search ignores case, accents, hyphens, dots and spaces ("mx5"
 *        finds MX-5), and matches an option's `keywords` too ("vw" finds
 *        Volkswagen).
 * WHY:   Dropdown menus cramp on mobile; the Airbnb pattern gives every
 *        select in the app (car make, colour, future filters) room to
 *        search and generous touch targets. Presented as a self-contained
 *        RN Modal (slide-up + fade, 200–250ms ease-out, reversed on close,
 *        reduce-motion aware) so any screen can open one without route
 *        wiring. The list is a FlatList (headers as items +
 *        stickyHeaderIndices) — FlashList was assessed but does not support
 *        sticky section headers, a core requirement. The DfT car list
 *        (2026-09-30) made these longer (~90 makes, ~110 rows with their
 *        letter headers; up to ~50 models),
 *        still small enough to render whole, which keeps the rail's jumps
 *        exact. Single-select in v1; see the TODO(multi-select) in
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
import { Check } from 'lucide-react-native';
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
  useWindowDimensions,
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

import { lightHaptic, selectionHaptic } from '../lib/haptics';
import {
  listRowStackFontScale,
  motion,
  indexRailFontScaleCap,
  radii,
  shrinkToFitMinScale,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { EmptyState } from './EmptyState';
import {
  RECENT_SECTION_TITLE,
  buildSelectList,
  compactQuery,
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
/** Lists up to this long render every row on open (see initialNumToRender). */
const MAX_RENDERED_UP_FRONT = 250;
/** Rows that get the first-open stagger: about one screenful. */
const STAGGERED_ROWS = 12;

export interface SelectScreenProps<V extends string | number> {
  visible: boolean;
  /** Close without choosing (X, Android back). Parent flips `visible`. */
  onClose: () => void;
  /**
   * Called once the screen has FINISHED closing — its slide-down done and the
   * modal gone — with whether the close was a pick (a row, a tile, or the
   * "Use …" row) rather than the X or the back gesture. For whatever should
   * follow a pick without playing behind the closing picker (the wizard's
   * auto-advance, 2026-10-08).
   */
  onClosed?: (picked: boolean) => void;
  options: SelectOption<V>[];
  /** Currently selected value — its row shows the checkmark. */
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
  /** An "Any make"-style first row for filters: picking it means no value,
   *  and it shows as selected while `value` is null. */
  anyOption?: { label: string; onSelect: () => void };
  /**
   * How the pinned group shows. `list` (default): rows under `pinnedTitle`.
   * `grid`: two-up tiles above the list, AutoTrader's "browse by brand",
   * and the pinned values aren't repeated as rows (they keep their A–Z place).
   */
  pinnedLayout?: 'list' | 'grid';
  /** With a pinned grid: the heading above the full list ("All makes"). */
  allTitle?: string;
}

export function SelectScreen<V extends string | number>({
  visible,
  onClose,
  onClosed,
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
  anyOption,
  pinnedLayout = 'list',
  allTitle,
}: SelectScreenProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
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
  // Whether the pinned grid has cascaded in on this open.
  const [gridStaggered, setGridStaggered] = useState(false);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setMounted(true);
      setQuery('');
      setDebouncedQuery('');
      setGridStaggered(false);
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

  // A pinned GRID is drawn above the list, so the list itself gets no pinned
  // rows: only its A–Z sections (and so only letter headers stick).
  const pinnedInList = pinnedLayout === 'list' ? recentValues : undefined;
  const items = useMemo(
    () => buildSelectList(options, debouncedQuery, pinnedInList, pinnedTitle),
    [options, debouncedQuery, pinnedInList, pinnedTitle],
  );
  const pinnedTiles = useMemo(
    () =>
      pinnedLayout === 'grid'
        ? // Deduped: a repeated value would be two tiles with one key.
          [...new Set(recentValues ?? [])].flatMap((pinned) =>
            options.filter((option) => option.value === pinned),
          )
        : [],
    [pinnedLayout, recentValues, options],
  );

  // A query that already IS a listed option, by its label or one of its
  // keywords, and ignoring case and accents ("skoda" is Škoda, "vw" is
  // Volkswagen), needs no "Use "<query>"" row: the option's own row is there.
  const hasExactMatch = useMemo(() => {
    const wanted = compactQuery(debouncedQuery);
    return (
      manualEntry != null &&
      wanted.length > 0 &&
      options.some((option) =>
        [option.label, ...(option.keywords ?? [])].some((text) => compactQuery(text) === wanted),
      )
    );
  }, [manualEntry, debouncedQuery, options]);
  const showUseQuery = manualEntry != null && debouncedQuery.trim().length > 0 && !hasExactMatch;
  // Trimmed: a query of only spaces shows the whole list, so it is "not
  // searching" for the Any row and the rail too.
  const searching = debouncedQuery.trim().length > 0;
  const showAnyRow = anyOption != null && !searching;
  // Searching shows result rows only, as the pinned list group always did.
  const showGrid = pinnedTiles.length > 0 && !searching;
  const hasListHeader = showAnyRow || showUseQuery || showGrid;

  // The rail's one retry (see onScrollToIndexFailed), cleared on unmount.
  const retriedIndex = useRef<number | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Whether the close in progress is a pick — reported by onClosed once the
  // modal has gone (see the prop).
  const pickedRef = useRef(false);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });
  // A reopen before the last close finished starts afresh: that close's pick
  // must not be credited to a later X.
  useEffect(() => {
    if (visible) pickedRef.current = false;
  }, [visible]);
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) {
      const picked = pickedRef.current;
      pickedRef.current = false;
      onClosedRef.current?.(picked);
    }
    wasMounted.current = mounted;
  }, [mounted]);

  const submitManual = (text: string) => {
    pickedRef.current = true;
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
    pickedRef.current = true;
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
                  <Feather name="x" size={sizes.icon} color={palette.textPrimary} />
                </Pressable>
                {title ? (
                  <Text
                    accessibilityRole="header"
                    // "Mercedes-Benz model" at large text: shrink first, then
                    // wrap to a second line rather than cut. A screen title is
                    // never capped.
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={shrinkToFitMinScale}
                    style={styles.title}
                  >
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
                    size={sizes.iconSm}
                    color={palette.textSecondary}
                  />
                  <TextInput
                    ref={searchRef}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={searchPlaceholder}
                    placeholderTextColor={palette.textSecondary}
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
                        size={sizes.iconSm}
                        color={palette.textSecondary}
                      />
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {/* An empty list with an Any row still renders the list, so the
                  Any row is there to pick (a filter showing a model with no
                  list behind it). */}
              {items.length === 0 && !showAnyRow ? (
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
                    // Named, so a screen reader doesn't say "radio group" with
                    // nothing to tell it from the tiles' own group inside.
                    accessibilityLabel={title}
                    data={items}
                    keyExtractor={(item) => item.key}
                    // ⚠️ SHIFTED BY ONE when there's a list header: FlatList
                    // counts ListHeaderComponent as cell 0. Unshifted, "Popular
                    // makes" pinned the Any row and no letter header stuck
                    // (2026-09-30 UI review).
                    stickyHeaderIndices={stickyHeaderIndices(items).map(
                      (index) => index + (hasListHeader ? 1 : 0),
                    )}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    contentContainerStyle={[
                      styles.listContent,
                      // Clear the index rail so the last rows aren't hidden under it.
                      showIndex && !searching ? styles.listContentIndexed : null,
                    ]}
                    // Every row renders up front (a make list is ~110 items, a
                    // model list rarely 80), so the rail's scrollToIndex always
                    // has its target measured and lands exactly. Rows grow with
                    // dynamic type, so a fixed getItemLayout would drift.
                    initialNumToRender={Math.min(items.length, MAX_RENDERED_UP_FRONT)}
                    // Past that cap: approximate, then settle on the real row,
                    // once. A second failure stays at the approximation rather
                    // than looping.
                    onScrollToIndexFailed={(info) => {
                      listRef.current?.scrollToOffset({
                        offset: info.averageItemLength * info.index,
                        animated: false,
                      });
                      if (retriedIndex.current === info.index) return;
                      retriedIndex.current = info.index;
                      if (retryTimer.current) clearTimeout(retryTimer.current);
                      retryTimer.current = setTimeout(
                        () => listRef.current?.scrollToIndex({ index: info.index, animated: false }),
                        0,
                      );
                    }}
                    ListHeaderComponent={
                      hasListHeader ? (
                        <>
                          {showAnyRow && anyOption ? (
                            <AnyRow
                              label={anyOption.label}
                              selected={value === null}
                              // Line up with the rows' labels when they carry icons.
                              indented={options.some((option) => option.icon != null)}
                              onPress={() => {
                                lightHaptic();
                                anyOption.onSelect();
                                onClose();
                              }}
                            />
                          ) : null}
                          {showUseQuery ? (
                            <ManualRow
                              label={`Use “${debouncedQuery.trim()}”`}
                              onPress={() => submitManual(debouncedQuery)}
                            />
                          ) : null}
                          {showGrid ? (
                            <PinnedGrid
                              title={pinnedTitle ?? RECENT_SECTION_TITLE}
                              tiles={pinnedTiles}
                              selectedValue={value}
                              onSelect={handleSelect}
                              // Once per open: clearing a search brings the
                              // grid back without replaying the cascade.
                              stagger={stagger && !gridStaggered}
                              // Its first layout, just after the cascade has
                              // started: from then on this open, no replay.
                              onShown={stagger && !gridStaggered ? () => setGridStaggered(true) : undefined}
                            />
                          ) : null}
                          {showGrid && allTitle ? (
                            <View style={styles.groupHeader}>
                              <Text accessibilityRole="header" style={styles.groupTitle}>
                                {allTitle}
                              </Text>
                            </View>
                          ) : null}
                        </>
                      ) : null
                    }
                    renderItem={({ item, index }) => (
                      <SelectRow
                        item={item}
                        selectedValue={value}
                        onSelect={handleSelect}
                        // A hairline between two rows, never beside a header.
                        // …or below the Any / "Use…" row when one sits right
                        // on top of the first row (no grid or heading between).
                        divider={
                          item.kind === 'option' &&
                          (items[index - 1]?.kind === 'option' ||
                            (index === 0 && !showGrid && (showAnyRow || showUseQuery)))
                        }
                        // The first screenful only: with every row rendered up
                        // front, staggering all ~110 would start them together
                        // off-screen, against the Motion rule and heavy on
                        // low-end Android.
                        // With a grid, the tiles ARE the first screenful: the
                        // rows start far below, so they don't animate.
                        stagger={
                          stagger && !searching && !showGrid && index < STAGGERED_ROWS ? index : undefined
                        }
                      />
                    )}
                  />
                  {showIndex && !searching ? (
                    <IndexRail
                      // Only the A–Z letter sections — a multi-word pinned
                      // header (e.g. "Popular makes") would put a stray letter
                      // on the rail; that group sits at the top anyway.
                      // "#" heads the numbered models (208, 3 Series).
                      anchors={sectionAnchors(items).filter((anchor) => /^([A-Z]|#)$/.test(anchor.title))}
                      onJump={(index) => {
                        // A fresh jump gets its own one retry.
                        retriedIndex.current = null;
                        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
                      }}
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
  divider = false,
}: {
  item: SelectListItem<V>;
  selectedValue: V | null;
  onSelect: (value: V) => void;
  /** Row index for the first-load stagger, or undefined to skip. */
  stagger?: number;
  /** A hairline above the row (the row before it is an option too). */
  divider?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  if (item.kind === 'header') {
    return (
      <View style={styles.sectionHeader}>
        <Text
          accessibilityRole="header"
          // "#" reads as "number sign" or "pound", depending on the voice.
          accessibilityLabel={item.title === '#' ? 'Numbers' : undefined}
          style={styles.sectionTitle}
        >
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
          .easing(motionEasing)
          .delay(Math.min(stagger, STAGGER_MAX_STEPS) * STAGGER_STEP_MS)
          .reduceMotion(ReduceMotion.System)
      : undefined;

  return (
    <Animated.View entering={entering}>
      {divider ? <View style={styles.divider} testID="select-row-divider" /> : null}
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={option.subtitle ? `${option.label}, ${option.subtitle}` : option.label}
        accessibilityState={{ checked: selected }}
        onPress={() => onSelect(option.value)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {option.icon ? <View style={styles.rowIcon}>{option.icon}</View> : null}
        <View style={styles.rowText}>
          <Text numberOfLines={2} style={styles.rowLabel}>
            {option.label}
          </Text>
          {option.subtitle ? (
            <Text numberOfLines={1} style={styles.rowSubtitle}>
              {option.subtitle}
            </Text>
          ) : null}
        </View>
        <RowCheck selected={selected} color={palette.textPrimary} />
      </Pressable>
    </Animated.View>
  );
}

/** ListRow's check: 24pt, ink, and an equal spacer when unchecked, so a
 *  label never shifts as the selection moves. */
function RowCheck({ selected, color }: { selected: boolean; color: string }) {
  const styles = useThemedStyles(makeStyles);
  return selected ? <Check size={sizes.icon} color={color} /> : <View style={styles.checkSpacer} />;
}

/**
 * The pinned values as two-up tiles (AutoTrader's "browse by brand"): the
 * title, then radios in the given (rank) order, in their OWN named radio
 * group, so the selected make isn't announced twice in the list's group (it
 * keeps its A–Z row too). Each tile is a quiet bordered box whose border
 * turns `primary`, with a check, when chosen: CardSelect's selection language
 * at a compact tile's `md` radius.
 * ⚠️ PAIRED ROWS, NOT MEASURED WIDTHS. The first version measured the grid
 * and halved it, but onLayout's width includes the grid's own padding, so
 * every tile came out too wide and the grid snapped to one column the moment
 * it measured (2026-10-01 UI review). Each pair is a row of two `flex: 1`
 * cells, an empty one making up an odd count: exact halves, nothing to
 * measure. At large text (past ListRow's stacking threshold) it's one column.
 */
function PinnedGrid<V extends string | number>({
  title,
  tiles,
  selectedValue,
  onSelect,
  stagger,
  onShown,
}: {
  title: string;
  tiles: SelectOption<V>[];
  selectedValue: V | null;
  onSelect: (value: V) => void;
  stagger: boolean;
  /** Called on the grid's first layout. */
  onShown?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const { fontScale } = useWindowDimensions();
  const perRow = (fontScale ?? 1) > listRowStackFontScale ? 1 : 2;
  const rows: SelectOption<V>[][] = [];
  for (let i = 0; i < tiles.length; i += perRow) rows.push(tiles.slice(i, i + perRow));

  return (
    <View>
      <View style={styles.groupHeader}>
        <Text accessibilityRole="header" style={styles.groupTitle}>
          {title}
        </Text>
      </View>
      <View
        style={styles.grid}
        accessibilityRole="radiogroup"
        accessibilityLabel={title}
        onLayout={onShown}
      >
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.gridRow}>
            {row.map((tile, column) => {
              const index = rowIndex * perRow + column;
              const selected = tile.value === selectedValue;
              return (
                <Animated.View
                  key={String(tile.value)}
                  style={styles.gridCell}
                  entering={
                    stagger
                      ? FadeInDown.duration(motion.fast)
                          .easing(motionEasing)
                          // After the sheet's own slide-in, not during it.
                          .delay(MOTION_MS + Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS)
                          .reduceMotion(ReduceMotion.System)
                      : undefined
                  }
                >
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={tile.label}
                    accessibilityState={{ checked: selected }}
                    onPress={() => onSelect(tile.value)}
                    style={({ pressed }) => [
                      styles.tile,
                      selected && styles.tileSelected,
                      pressed && styles.tilePressed,
                    ]}
                  >
                    {/* Shrink first, then wrap: "Range Rover Evoque" in half
                        a phone's width needs both. */}
                    <Text
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={shrinkToFitMinScale}
                      style={styles.tileLabel}
                    >
                      {tile.label}
                    </Text>
                    {/* A spacer when unchecked, as RowCheck: the label keeps
                        its width, so selecting doesn't re-wrap a long name. */}
                    {selected ? (
                      <Check size={sizes.iconSm} color={palette.primary} />
                    ) : (
                      <View style={styles.tileCheckSpacer} />
                    )}
                  </Pressable>
                </Animated.View>
              );
            })}
            {row.length < perRow ? <View style={styles.gridCell} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** The "Any make" row of a filter: a radio like the rest, checked when nothing
 *  is chosen, so "no filter" reads as a choice rather than an absence. */
function AnyRow({
  label,
  selected,
  indented,
  onPress,
}: {
  label: string;
  selected: boolean;
  /** Leave the icon slot empty, so the label lines up with the rows'. */
  indented: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {indented ? <View style={styles.rowIcon} /> : null}
      <View style={styles.rowText}>
        <Text numberOfLines={2} style={styles.rowLabel}>
          {label}
        </Text>
      </View>
      <RowCheck selected={selected} color={palette.textPrimary} />
    </Pressable>
  );
}

/** The type-to-add "Use "<query>"" free-text row (manual-entry escape hatch). */
function ManualRow({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Feather name="plus" size={sizes.iconSm} color={palette.primary} />
      </View>
      <Text numberOfLines={2} style={[styles.rowLabel, styles.manualAction]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The anchors that fit in `room` at `letterHeight` each: all of them when
 * they fit (or before anything is measured), else an evenly spaced subset
 * that always keeps the first and last, so the rail still spans the list.
 */
export function fitAnchors(anchors: SectionAnchor[], room: number, letterHeight: number): SectionAnchor[] {
  if (room <= 0 || letterHeight <= 0) return anchors;
  const max = Math.floor(room / letterHeight);
  if (anchors.length <= max) return anchors;
  if (max < 2) return anchors.slice(0, Math.max(max, 1));
  const step = (anchors.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => anchors[Math.round(i * step)]);
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
  const styles = useThemedStyles(makeStyles);
  // ⚠️ FIT TO THE SPACE, as iOS's index does. 21 make letters at 24pt are
  // ~500pt, more than the list gets on an iPhone SE or a small Android with
  // three-button navigation, where the ends were clipped or drew over the
  // search bar. Measured: the room the rail has, and one letter's height.
  const [room, setRoom] = useState(0);
  const [letterHeight, setLetterHeight] = useState(0);
  const shown = fitAnchors(anchors, room, letterHeight);

  return (
    <View
      style={styles.indexRail}
      pointerEvents="box-none"
      onLayout={(event) => setRoom(event.nativeEvent.layout.height)}
    >
      {shown.map((anchor, position) => (
        <Pressable
          key={anchor.title}
          onLayout={
            position === 0
              ? (event) => setLetterHeight(event.nativeEvent.layout.height)
              : undefined
          }
          accessibilityRole="button"
          accessibilityLabel={anchor.title === '#' ? 'Jump to numbers' : `Jump to ${anchor.title}`}
          onPress={() => {
            selectionHaptic(); // the system index's detent
            onJump(anchor.index);
          }}
          // Sideways only: the letters stack touching, and vertical slop let
          // the next letter take a tap on the low third of this one.
          hitSlop={{ left: spacing.sm, right: spacing.sm }}
          style={styles.indexLetter}
        >
          {/* Capped: 20-odd letters at 200% would run off both ends of the
              screen. The section headers (heading rotor) are the accessible
              route; the rail is a sighted shortcut. */}
          <Text style={styles.indexLetterText} maxFontSizeMultiplier={indexRailFontScaleCap}>
            {anchor.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex: {
      flex: 1,
    },
    // Static opaque fill behind the animating sheet, so the transparent Modal
    // never reveals the screen behind it during the slide/fade (Android bleed-
    // through / footer flicker). Same colour as the sheet so the content appears
    // to rise over one continuous surface.
    backdrop: {
      flex: 1,
      backgroundColor: c.background,
    },
    sheet: {
      flex: 1,
      backgroundColor: c.background,
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
      backgroundColor: c.surfaceSubtle,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
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
      // A true pill, as MapSearchPill: `xl` left the 52pt bar's ends flat.
      borderRadius: radii.full,
      backgroundColor: c.surfaceSubtle,
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
      color: c.textPrimary,
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
      color: c.primary,
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
      color: c.textSecondary,
    },
    sectionHeader: {
      backgroundColor: c.background,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xs,
    },
    sectionTitle: {
      ...typography.label,
      color: c.textSecondary,
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
      backgroundColor: c.surfaceSubtle,
    },
    // Between two rows of a long list: a hairline at the gutter, so 100+ rows
    // read as separate items (the settings-list convention, not a table).
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
      marginHorizontal: spacing.xl,
    },
    // The pinned tiles: two-up at the form gutter.
    // Rows of two equal cells: exact halves, nothing measured.
    grid: {
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingBottom: spacing.sm,
    },
    gridRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    gridCell: {
      flex: 1,
    },
    // A group title ("Popular makes", "All makes") outranks the A–Z letters
    // under it: a heading in ink, where the sticky letters stay small grey
    // labels. Same style for both, so the two groups read as peers.
    groupHeader: {
      backgroundColor: c.background,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.sm,
    },
    groupTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    checkSpacer: {
      width: sizes.icon,
      height: sizes.icon,
    },
    tileCheckSpacer: {
      width: sizes.iconSm,
      height: sizes.iconSm,
    },
    // CardSelect's language: a quiet 2pt border that turns `primary` when
    // chosen. Flat, no shadow: a tile on the page, not floating over it. `md`,
    // not CardSelect's `lg`: a compact tile, not a card. `md`/`sm` padding
    // keeps room for a two-line name at large text.
    tile: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: sizes.control,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.md,
      borderWidth: sizes.selectBorder,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    tileSelected: {
      borderColor: c.primary,
    },
    tilePressed: {
      backgroundColor: c.surfaceSubtle,
    },
    tileLabel: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flex: 1,
    },
    rowIcon: {
      // A leading slot for a small icon (colour dots centre in it).
      width: sizes.circleButtonSm,
      alignItems: 'center',
    },
    rowText: {
      flex: 1,
    },
    rowLabel: {
      ...typography.body,
      color: c.textPrimary,
    },
    rowSubtitle: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
