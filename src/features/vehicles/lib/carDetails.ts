/**
 * WHAT:  carDetails — builds the flat "Car details" row list from a
 *        PostDetail: the present facts in a fixed order (identity → marks →
 *        theft context), then the muted "Not provided" gap rows (plate, year,
 *        body type, marks) that name what the post lacks.
 * WHY:   The full inventory renders in-page (product call 2026-07-23: no
 *        "Show all" tap — a spotter sees every fact at once). Gaps are
 *        stated, not omitted (the reference's struck-through "Not included"
 *        group): a sparse post reads as honest, not thin, and the constant
 *        list shape tells a spotter what is UNKNOWN about the car — itself
 *        useful when deciding whether a match is plausible. One flat list, no
 *        group headings — the grouped sheet was dropped when the list moved
 *        fully in-page (the CarDetailsScreen it fed is gone).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/features/vehicles/lib/theftContext.ts;
 *        src/features/vehicles/lib/carDetails.test.ts;
 *        docs/design-refs/post-detail/REFERENCE_SPEC.md §6.
 */

import type { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { PostDetail } from '../types';
import { theftContextLines } from './theftContext';

export type FeatherName = ComponentProps<typeof Feather>['name'];

export interface CarDetailRow {
  key: string;
  icon: FeatherName;
  label: string;
  /** True for "Not provided" rows — rendered muted + struck through. */
  missing?: boolean;
}

/** The in-page list: present facts in fixed order, then the named gaps. */
export function buildCarDetailRows(post: PostDetail): CarDetailRow[] {
  // Identity facts.
  const present: CarDetailRow[] = [
    { key: 'colour', icon: 'droplet', label: `Colour: ${post.colour}` },
    ...(post.year ? [{ key: 'year', icon: 'calendar' as const, label: `Year: ${post.year}` }] : []),
    ...(post.plate ? [{ key: 'plate', icon: 'hash' as const, label: `Plate: ${post.plate}` }] : []),
    ...(post.bodyType
      ? [{ key: 'bodyType', icon: 'truck' as const, label: `Body type: ${post.bodyType}` }]
      : []),
  ];

  // Distinguishing marks (taxonomy features + free-text).
  const marks: CarDetailRow[] = [
    ...post.features.map((feature) => ({
      key: `feature-${feature.key}`,
      // The one sanctioned cast: feature icons come from the seeded taxonomy
      // (validated against vehicle_feature); an unknown name renders
      // Feather's fallback glyph, never crashes.
      icon: feature.icon as FeatherName,
      label: feature.label,
    })),
    ...(post.distinguishingFeatures
      ? [{ key: 'distinguishing', icon: 'star' as const, label: post.distinguishingFeatures }]
      : []),
  ];
  present.push(...marks);

  // Theft context — `info`, not an alert glyph: a column of warning icons
  // reads alarmist (DESIGN_SYSTEM tone); these are calm facts.
  present.push(
    ...theftContextLines(post).map((line, index) => ({
      key: `theft-${index}`,
      icon: 'info' as const,
      label: line,
    })),
  );

  // The gaps, named. Only facts the posting flow ASKS for — a gap means the
  // owner skipped it, so it reads as "unknown", never as an accusation.
  const missing: CarDetailRow[] = [
    ...(post.plate ? [] : [{ key: 'no-plate', icon: 'slash' as const, label: 'Plate', missing: true }]),
    ...(post.year ? [] : [{ key: 'no-year', icon: 'slash' as const, label: 'Year', missing: true }]),
    ...(post.bodyType
      ? []
      : [{ key: 'no-body', icon: 'slash' as const, label: 'Body type', missing: true }]),
    ...(marks.length > 0
      ? []
      : [{ key: 'no-marks', icon: 'slash' as const, label: 'Distinguishing marks', missing: true }]),
  ];

  return [...present, ...missing];
}
