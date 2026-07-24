/**
 * WHAT:  Pure data logic for the select components — option types, query
 *        normalisation, label filtering, and flattening options (+ optional
 *        consumer-fed "Recent" values) into the flat header/option item list
 *        the SelectScreen list renders.
 * WHY:   Kept free of React so filtering and grouping — the behaviour that
 *        decides what a user can pick — is tested as plain functions
 *        (docs/TESTING.md), mirroring the wizard's navigation.ts pattern.
 *        A FLAT list (headers as items + stickyHeaderIndices) rather than
 *        SectionList keeps the door open to swapping FlatList for FlashList
 *        without restructuring data.
 * LINKS: src/shared/ui/SelectScreen.tsx (renderer);
 *        src/shared/ui/SelectField.tsx; src/shared/ui/selectOptions.test.ts.
 */

import type { ReactNode } from 'react';

/** One pickable option. `V` is the flow's value type (string | number). */
export interface SelectOption<V extends string | number = string> {
  value: V;
  label: string;
  /** Secondary line under the label. */
  subtitle?: string;
  /** Leading slot — emoji, icon, colour dot. */
  icon?: ReactNode;
  /** Group title; options sharing a section render under one header. */
  section?: string;
}

/** The flat list the screen renders: section headers interleaved with rows. */
export type SelectListItem<V extends string | number> =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'option'; key: string; option: SelectOption<V> };

/** Section title used for consumer-fed recent selections. */
export const RECENT_SECTION_TITLE = 'Recent';

/** Key-namespace delimiter — NUL cannot appear in real labels/values. */
const KEY_DELIMITER = '\u0000';

/** Lowercase, trim, and collapse internal whitespace for matching. */
export function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Case- and whitespace-insensitive label match. */
export function matchesQuery(label: string, normalizedQuery: string): boolean {
  return normalizeQuery(label).includes(normalizedQuery);
}

/**
 * Build the flat list for the screen:
 * - a non-empty query filters options by label and hides the pinned group
 *   (searching supersedes it);
 * - with no query, consumer-fed `pinnedValues` render first under
 *   `pinnedTitle` (default "Recent"; e.g. "Popular makes") in the given order
 *   (values without a matching option are ignored) and also remain in their
 *   home section, matching the familiar recent/popular pattern;
 * - sections appear in first-appearance order; options without a section
 *   render last, without a header.
 */
export function buildSelectList<V extends string | number>(
  options: SelectOption<V>[],
  query: string,
  pinnedValues: V[] = [],
  pinnedTitle: string = RECENT_SECTION_TITLE,
): SelectListItem<V>[] {
  const normalizedQuery = normalizeQuery(query);
  const visible = normalizedQuery
    ? options.filter((option) => matchesQuery(option.label, normalizedQuery))
    : options;

  const items: SelectListItem<V>[] = [];

  // Keys are namespaced and joined with KEY_DELIMITER (NUL — cannot appear
  // in real labels/values) so consumer data can never collide with the
  // pinned group or across section/value boundaries.
  if (!normalizedQuery && pinnedValues.length > 0) {
    const pinnedOptions = pinnedValues
      .map((value) => options.find((option) => option.value === value))
      .filter((option): option is SelectOption<V> => option !== undefined);
    if (pinnedOptions.length > 0) {
      items.push({ kind: 'header', key: `h:${KEY_DELIMITER}pinned`, title: pinnedTitle });
      for (const option of pinnedOptions) {
        items.push({ kind: 'option', key: `p:${option.value}`, option });
      }
    }
  }

  const sectionTitles = [
    ...new Set(visible.map((option) => option.section)),
  ].filter((section): section is string => section !== undefined);

  for (const title of sectionTitles) {
    items.push({ kind: 'header', key: `h:${title}`, title });
    for (const option of visible.filter((candidate) => candidate.section === title)) {
      items.push({ kind: 'option', key: `o:${title}${KEY_DELIMITER}${option.value}`, option });
    }
  }

  for (const option of visible.filter((candidate) => !candidate.section)) {
    items.push({ kind: 'option', key: `o:${KEY_DELIMITER}${option.value}`, option });
  }

  return items;
}

/** Indices of header items, for FlatList's stickyHeaderIndices. */
export function stickyHeaderIndices<V extends string | number>(
  items: SelectListItem<V>[],
): number[] {
  return items.flatMap((item, index) => (item.kind === 'header' ? [index] : []));
}

/** One entry per section header — its title and its index in the flat list —
 *  so an A–Z index rail can jump-scroll to a section. */
export interface SectionAnchor {
  title: string;
  index: number;
}

/** Section anchors (title + list index) for a jump-scroll index rail. */
export function sectionAnchors<V extends string | number>(
  items: SelectListItem<V>[],
): SectionAnchor[] {
  return items.flatMap((item, index) =>
    item.kind === 'header' ? [{ title: item.title, index }] : [],
  );
}

/** Count of pickable options in a built list (for screen-reader announcements). */
export function optionCount<V extends string | number>(items: SelectListItem<V>[]): number {
  return items.filter((item) => item.kind === 'option').length;
}
