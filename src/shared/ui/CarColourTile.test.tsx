/**
 * WHAT:  Tests for CarColourTile — that a report's car colour actually reaches
 *        the tile as a fill, that an unrecognised colour degrades instead of
 *        rendering a transparent hole, and that the glyph ink follows the
 *        swatch's `light` flag.
 * WHY:   ⚠️ THE TILE IS THE ONLY PICTURE `My reports` IS ALLOWED TO HAVE, so
 *        "it renders" is not the contract — WHICH colour it renders is. Nothing
 *        else in the suite would notice if `swatchForName` were passed the make
 *        instead of the colour, or if the fallback branch were dropped: both
 *        produce a plausible-looking square.
 *
 *        The ink assertions exist because the fill is DATA and does not flip
 *        with the theme, so a themed ink would be white-on-white for five of
 *        the fifteen colours.
 * LINKS: ./CarColourTile.tsx; src/shared/lib/carColours.ts.
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { CarColourTile } from './CarColourTile';

// ⚠️ NO MOCK. This suite used to mock `@/features/vehicles` and
// `requireActual` a deep path inside it, because reaching a pure colour lookup
// through a feature barrel dragged in auth and died on AsyncStorage's native
// module. carColours moved to `@/shared/lib` on 2026-08-28 and the tax went
// with it — the component now imports the real thing and so does this file.

const fillOf = (element: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(element.props.style) as { backgroundColor?: string }).backgroundColor;

/**
 * The ink lucide sets on the rendered `Svg` ROOT — exactly one node, or none
 * when no glyph was drawn at all.
 *
 * ⚠️ NOT "every stroke in the tree", which is what this claimed on its first
 * pass. react-native-svg serialises the child paths' stroke as a processed
 * `{type, payload}` object rather than a string, so the `typeof === 'string'`
 * guard matches the root and nothing else. That is enough — lucide derives root
 * and paths from the same `color` prop — but the assertions below use
 * `toEqual([ink])` rather than `toContain`, so the one-node contract is pinned
 * rather than assumed. lucide turns its `testID` into `data-testid`, which RNTL
 * cannot query, which is why the tree is read at all.
 */
const strokes = (tree: unknown): string[] => {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const { props, children } = node as { props?: Record<string, unknown>; children?: unknown };
    if (props && typeof props.stroke === 'string') found.push(props.stroke);
    if (children) walk(children);
  };
  walk(tree);
  return found;
};

describe('CarColourTile', () => {
  it('fills with the car’s real colour', async () => {
    const { getByTestId } = await render(<CarColourTile colour="Blue" testID="tile" />);

    // The DATA hex from carColours, not a theme token — a blue car is blue in
    // dark mode too.
    expect(fillOf(getByTestId('tile'))).toBe('#2B4C7E');
  });

  it('matches the colour whatever case and padding it arrives in', async () => {
    // posts.colour is an enum, but the RPC coalesces and nothing trims on the
    // way out; a lookup miss here would silently blank every tile.
    const { getByTestId } = await render(<CarColourTile colour="  red  " testID="tile" />);

    expect(fillOf(getByTestId('tile'))).toBe('#A81E22');
  });

  it('⚠️ degrades to a neutral tile when the colour is unknown', async () => {
    // Both halves of the car can be '' on a sparse post — the screen's "a car"
    // fallback exists for exactly that row. An unhandled miss would leave the
    // tile transparent: a hole with a car drawn in it.
    const { getByTestId } = await render(<CarColourTile colour="Puce" testID="tile" />);

    const fill = fillOf(getByTestId('tile'));
    expect(fill).toBeTruthy();
    expect(fill).not.toBe('#2B4C7E');
  });

  it('degrades the same way when there is no colour at all', async () => {
    const { getByTestId } = await render(<CarColourTile colour={null} testID="tile" />);

    expect(fillOf(getByTestId('tile'))).toBeTruthy();
  });

  it('draws a light glyph on a dark car', async () => {
    const { toJSON } = await render(<CarColourTile colour="Black" testID="tile" />);

    expect(strokes(toJSON())).toEqual(['#FFFFFF']);
  });

  it('⚠️ draws a dark glyph on a pale car', async () => {
    // White is #F4F5F7. A white glyph on it is 1.04:1 — invisible — and it is
    // the second most common car colour in the UK. That the CHOICE is legible
    // is computed over the whole palette in carColours.test.ts; this pins that
    // the component asks for it.
    const { toJSON } = await render(<CarColourTile colour="White" testID="tile" />);

    expect(strokes(toJSON())).toEqual(['#1A1A1A']);
  });

  it('⚠️ paints a two-tone fill and no glyph at all', async () => {
    // "Multicolour / wrapped" puts #C7CCD1 over the right half of #2B4C7E, and
    // no ink is legible across that seam — white is 1.6:1 on the one side,
    // near-black 2.02:1 on the other. The tile becomes a pure sample of paint.
    //
    // ⚠️ THE TWO FILLS ARE ASSERTED, NOT JUST THE GLYPH'S ABSENCE. The first
    // version of this test checked only that two ink strings were missing, and
    // a code review proved it vacuous by replacing the whole half-tile with
    // `null`: all seven tests still passed, because `not.toContain` is
    // satisfied by an empty array. A blank tile, a half that lost its colour
    // and a half stretched to full width all read as "correct" to that shape.
    const { getByTestId, toJSON } = await render(
      <CarColourTile colour="Multicolour / wrapped" testID="tile" />,
    );

    expect(fillOf(getByTestId('tile'))).toBe('#2B4C7E');
    expect(fillOf(getByTestId('tile-secondary'))).toBe('#C7CCD1');
    expect(strokes(toJSON())).toHaveLength(0);
  });
});
