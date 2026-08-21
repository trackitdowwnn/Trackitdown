/**
 * WHAT:  BrandMark — the "T" monogram, drawn as vector so it is crisp at any
 *        size and takes its colour from the palette.
 * WHY:   The same mark the launcher icon wears, rendered from the same numbers
 *        (src/shared/brand/markGeometry.ts). Vector rather than a PNG for two
 *        reasons: a raster would need a `tintColor` hack to flip between the
 *        light and dark palettes, and it would go soft at display size on the
 *        splash. react-native-svg is already a dependency, so this costs
 *        nothing.
 * LINKS: src/shared/brand/markGeometry.ts (the geometry);
 *        src/shared/ui/BrandLoader.tsx (the consumer);
 *        assets/brand/trackitdown-icon.svg; docs/DESIGN_SYSTEM.md (Brand mark).
 *
 * Usage:
 *   <BrandMark size={64} />                 // palette.primary, themed
 *   <BrandMark size={64} color={c.textOnPrimary} />
 */

import Svg, { Circle, Rect } from 'react-native-svg';

import { MARK_ASPECT, MARK_BARS, MARK_DOTS } from '../brand/markGeometry';
import { usePalette } from '../theme';

export interface BrandMarkProps {
  /** The mark's WIDTH in points. Height follows from the mark's own aspect. */
  size: number;
  /** Defaults to `palette.primary`, so it inverts with the theme. */
  color?: string;
  /** Screen readers get one label for the whole loading block, so the mark is
   *  decorative by default. Pass a label only if it is used standalone. */
  accessibilityLabel?: string;
}

export function BrandMark({ size, color, accessibilityLabel }: BrandMarkProps) {
  const palette = usePalette();
  const ink = color ?? palette.primary;

  // The geometry is in units of S (half the mark's width) about its own centre,
  // so the viewBox is the box that exactly contains it: 2S wide, 2·aspect·S
  // tall, with the origin in the middle. Working in S directly — rather than
  // scaling to pixels here — keeps this component free of magic numbers and
  // lets SVG do the scaling.
  const S = 1;
  const vbW = 2 * S;
  const vbH = 2 * MARK_ASPECT * S;

  return (
    <Svg
      width={size}
      height={size * MARK_ASPECT}
      viewBox={`${-S} ${-MARK_ASPECT * S} ${vbW} ${vbH}`}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      {MARK_BARS.map((bar, i) => (
        <Rect
          key={`bar-${i}`}
          x={bar.cx - bar.hw}
          y={bar.cy - bar.hh}
          width={bar.hw * 2}
          height={bar.hh * 2}
          rx={bar.r}
          ry={bar.r}
          fill={ink}
        />
      ))}
      {MARK_DOTS.map((dot, i) => (
        <Circle key={`dot-${i}`} cx={dot.cx} cy={dot.cy} r={dot.r} fill={ink} />
      ))}
    </Svg>
  );
}
