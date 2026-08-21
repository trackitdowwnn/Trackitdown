/**
 * WHAT:  Tests for BrandMark — the "T" monogram rendered as vector in-app.
 * WHY:   The mark's GEOMETRY is guarded by the build-side suite
 *        (`npm run test:assets`, including a drift check against
 *        src/shared/brand/markGeometry.ts). What that cannot see is how this
 *        component USES it: that it reserves the right height for a mark which
 *        is wider than tall, that its ink comes from the palette rather than a
 *        baked hex, and that it stays out of the screen-reader tree when
 *        decorative.
 * LINKS: ./BrandMark.tsx; src/shared/brand/markGeometry.ts;
 *        scripts/brand/markGeometry.drift.test.mjs.
 */

import { render } from '@testing-library/react-native';

import { MARK_ASPECT, MARK_BARS, MARK_DOTS } from '../brand/markGeometry';
// NOT from the theme barrel: it deliberately withholds `colors` so components
// cannot bypass the active palette. A test may read it directly.
import { colors } from '../theme/colors';
import { BrandMark } from './BrandMark';

/** Every node of a given type in the rendered tree. */
function nodesOfType(node: unknown, type: string, found: Record<string, unknown>[] = []) {
  if (!node || typeof node !== 'object') return found;
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
  if (n.type === type && n.props) found.push(n.props);
  for (const child of n.children ?? []) nodesOfType(child, type, found);
  return found;
}

/** react-native-svg packs colours into an ARGB int. #1A1A1A -> 0xFF1A1A1A. */
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;

describe('BrandMark', () => {
  it('draws every part of the mark', async () => {
    const { toJSON } = await render(<BrandMark size={64} />);
    const tree = toJSON();
    // Two pill bars + one dot. A missing part still renders "a logo" — just
    // the wrong one — and nothing else here would catch it.
    expect(nodesOfType(tree, 'RNSVGRect')).toHaveLength(MARK_BARS.length);
    expect(nodesOfType(tree, 'RNSVGCircle')).toHaveLength(MARK_DOTS.length);
  });

  it('reserves the mark’s own aspect, not a square', async () => {
    // The mark is wider than it is tall. Sizing it square would squash it, or
    // leave a gap under it in the loader lockup.
    const { toJSON } = await render(<BrandMark size={100} />);
    const [svg] = nodesOfType(toJSON(), 'RNSVGSvgView');
    expect(svg.bbWidth).toBe(100);
    expect(svg.bbHeight).toBeCloseTo(100 * MARK_ASPECT, 4);
    expect(MARK_ASPECT).toBeLessThan(1);
  });

  it('centres the viewBox on the mark’s own ink', async () => {
    // The supplied icon pack had its ink off-centre; the geometry is expressed
    // about the ink's own bounding box so the viewBox is symmetric about zero.
    const { toJSON } = await render(<BrandMark size={64} />);
    const [svg] = nodesOfType(toJSON(), 'RNSVGSvgView');
    expect(svg.minX).toBeCloseTo(-1, 6);
    expect(svg.minY).toBeCloseTo(-MARK_ASPECT, 6);
    expect(svg.vbWidth).toBeCloseTo(2, 6);
  });

  it('takes its ink from the palette so it inverts with the theme', async () => {
    // A baked hex would look right in light mode and vanish in dark.
    const { toJSON } = await render(<BrandMark size={64} />);
    const rects = nodesOfType(toJSON(), 'RNSVGRect');
    expect((rects[0].fill as { payload: number }).payload).toBe(argb(colors.primary));
  });

  it('honours an explicit colour', async () => {
    const { toJSON } = await render(<BrandMark size={64} color="#FFFFFF" />);
    const rects = nodesOfType(toJSON(), 'RNSVGRect');
    expect((rects[0].fill as { payload: number }).payload).toBe(argb('#FFFFFF'));
  });

  it('is hidden from screen readers unless given a label', async () => {
    // The loader speaks for the whole block with one progressbar label; a
    // second announcement for the logo would be noise.
    const plain = await render(<BrandMark size={64} />);
    const [svgPlain] = nodesOfType(plain.toJSON(), 'RNSVGSvgView');
    expect(svgPlain.importantForAccessibility).toBe('no-hide-descendants');
    expect(svgPlain.accessibilityLabel).toBeUndefined();

    const labelled = await render(<BrandMark size={64} accessibilityLabel="Trackitdown" />);
    const [svgLabelled] = nodesOfType(labelled.toJSON(), 'RNSVGSvgView');
    expect(svgLabelled.accessibilityLabel).toBe('Trackitdown');
  });
});
