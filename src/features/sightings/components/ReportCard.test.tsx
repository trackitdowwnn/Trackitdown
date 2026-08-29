/**
 * WHAT:  Tests for ReportCard's two geometry contracts — the large-text stacking
 *        branch and the skeleton tracking it — and for the marker that tells the
 *        four verdicts apart.
 * WHY:   ⚠️ THE STACKING BRANCH IS THE ONE THE FILE SPENDS EIGHT LINES ON AND
 *        HAD NO COVERAGE OF. `flex: 1` is `flexBasis: 0`, which resolves to ZERO
 *        in an auto-height column — AlertCard shipped that bug once already, so
 *        the comment explaining the fix was the only thing holding it in place.
 *
 *        The skeleton is here for the same reason: it used to be a hand-copied
 *        `height: 96` on the screen against a 104pt row, and the version that
 *        replaced it was correct only at font scale 1.0. What has to be true is
 *        that both shapes move TOGETHER, which is a test, not a comment.
 *
 *        ⚠️ EVERY CASE PINS fontScale EXPLICITLY, through `Dimensions.get`,
 *        which is what `useWindowDimensions` reads — jest-expo reports 2 by
 *        default, so an unpinned test silently renders the stacked branch and
 *        the ordinary-size one can never pass at all. OnboardingScreen.test.tsx
 *        records the same trap.
 * LINKS: ./ReportCard.tsx; ./CarColourTile.test.tsx;
 *        ../screens/MySightingsScreen.test.tsx (the copy and the states).
 */

import { render } from '@testing-library/react-native';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';

import { paletteFor } from '@/shared/theme';

import type { MySightingRecordEntry } from '../api/sightingApi';

import { ReportCard, ReportCardSkeleton } from './ReportCard';

/** The tests render under the default (light) scheme. */
const colors = paletteFor('light');

/** ⚠️ Through `Dimensions.get` — see the file header. */
const atFontScale = (fontScale: number) => {
  jest.spyOn(RN.Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
};

afterEach(() => {
  // RESTORE, not clear: a spy's implementation survives clearAllMocks, so the
  // last font scale set here would leak into every later test in the file.
  jest.restoreAllMocks();
});

const entry = (overrides: Partial<MySightingRecordEntry> = {}): MySightingRecordEntry => ({
  id: 's1',
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  status: 'unverified',
  reviewedAt: null,
  areaLabel: 'Camden',
  car: { make: 'Ford', colour: 'Blue' },
  ...overrides,
});

const flat = (element: { props: { style?: unknown } }) =>
  StyleSheet.flatten(element.props.style) as Record<string, unknown>;

/** The ink lucide sets on a rendered `Svg` root — see CarColourTile.test.tsx,
 *  which documents why the tree is read rather than the element. */
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

describe('at ordinary text sizes', () => {
  it('lays the tile beside the text', async () => {
    atFontScale(1);
    const { getByTestId } = await render(<ReportCard entry={entry()} />);

    expect(flat(getByTestId('my-sighting-s1')).flexDirection).toBe('row');
  });
});

describe('⚠️ past the stacking threshold', () => {
  it('drops the tile onto its own row', async () => {
    atFontScale(1.5);
    const { getByTestId } = await render(<ReportCard entry={entry()} />);

    expect(flat(getByTestId('my-sighting-s1')).flexDirection).toBe('column');
  });

  it('⚠️ neutralises the text column’s flex basis', async () => {
    // The Yoga trap: in a column parent with auto height there is no free space
    // to distribute, so `flex: 1`'s basis-0 resolves to zero and the text
    // vanishes off the card's bottom edge — at exactly the font scale the
    // stacking exists to serve.
    atFontScale(1.5);
    const { getByText } = await render(<ReportCard entry={entry()} />);

    const main = getByText('Blue Ford').parent!;
    expect(flat(main).flexBasis).toBe('auto');
    expect(flat(main).flexGrow).toBe(0);
  });
});

describe('⚠️ the skeleton tracks the card', () => {
  // It cannot be a fixed height: the card's TEXT grows with the OS font setting
  // and a View does not, so a skeleton pinned to 104 stops matching at iOS's
  // second Larger Text step and stacking pulls the two ~160pt apart.
  it.each([
    [1, 'row'],
    [1.5, 'column'],
  ])('lays out the same way as the card at font scale %s', async (scale, direction) => {
    atFontScale(scale);
    const { getByTestId } = await render(<ReportCardSkeleton />);

    expect(flat(getByTestId('report-card-skeleton')).flexDirection).toBe(direction);
  });

  it('grows its lines with the font scale, as the real text does', async () => {
    atFontScale(2);
    const { getByTestId } = await render(<ReportCardSkeleton />);

    // The title placeholder stands in for `cardTitle` (22pt line) — at scale 2
    // the card's own title occupies 44, and a 22pt bar would leave the skeleton
    // short by half a line per row.
    const lines = getByTestId('report-card-skeleton').children[1] as {
      children: { props: { style?: unknown } }[];
    };
    expect(flat(lines.children[0]).height).toBe(44);
  });
});

describe('⚠️ the verdict marker', () => {
  // A marker is never the only signal — the word is always beside it — but the
  // four outcomes must not all look alike, which is the owner's "the status is
  // not clear" complaint. `unverified` (still live) and `not_mine` (answered and
  // closed) are opposite states and used to be identical.
  //
  // ⚠️ THEY DIFFER BY SHAPE, NOT ONLY HUE. Amber #A9762A against borderStrong
  // #8F8F8F is a 1.19:1 luminance ratio — in greyscale or under deuteranopia two
  // FILLED dots are the same mark. So `pending` is a ring and `credited` is a
  // tick, and these assertions are written against the shapes.
  it('draws pending as a hollow amber ring, not a fill', async () => {
    atFontScale(1);
    const { getByTestId } = await render(<ReportCard entry={entry({ status: 'unverified' })} />);

    const dot = flat(getByTestId('my-sighting-dot-s1'));
    expect(dot.borderColor).toBe(colors.warning);
    expect(dot.backgroundColor).toBeUndefined();
  });

  it.each([
    ['helpful' as const, colors.success],
    ['not_mine' as const, colors.borderStrong],
  ])('fills %s with its own colour', async (status, expected) => {
    atFontScale(1);
    const { getByTestId } = await render(<ReportCard entry={entry({ status })} />);

    expect(flat(getByTestId('my-sighting-dot-s1')).backgroundColor).toBe(expected);
  });

  it('⚠️ never marks a verdict in red — none of them is a failure', async () => {
    atFontScale(1);
    const { getByTestId } = await render(<ReportCard entry={entry({ status: 'not_mine' })} />);

    expect(flat(getByTestId('my-sighting-dot-s1')).backgroundColor).not.toBe(colors.danger);
  });

  it('⚠️ gives credited a tick instead of a dot — the one moment this screen has', async () => {
    // ⚠️ THE TICK'S PRESENCE IS ASSERTED, not just the dot's absence. The first
    // version of this test checked only `queryByTestId(dot) === null` plus the
    // label, and a code review proved it vacuous by replacing the whole `<Check>`
    // with `null`: both assertions still held, so a credited row that had lost
    // its one celebratory mark read as correct. lucide turns `testID` into
    // `data-testid`, which RNTL cannot query, so the ink is read off the tree —
    // the same technique CarColourTile.test.tsx uses.
    atFontScale(1);
    const { queryByTestId, getByText, toJSON } = await render(
      <ReportCard entry={entry({ status: 'credited' })} />,
    );

    expect(queryByTestId('my-sighting-dot-s1')).toBeNull();
    expect(strokes(toJSON())).toContain(colors.success);
    expect(getByText('Credited — this one led to the recovery')).toBeTruthy();
  });

  it('⚠️ keeps the marker on the first line as the text grows', async () => {
    // The offset centres the mark against a line box of `lineHeight × fontScale`.
    // Frozen at its unscaled value — which is what a StyleSheet entry would be —
    // the dot rides 9pt above the words it marks at 200%.
    atFontScale(2);
    const { getByTestId } = await render(<ReportCard entry={entry({ status: 'helpful' })} />);

    // label lineHeight 18 × 2 = 36, dot 8 → (36 − 8) / 2.
    expect(flat(getByTestId('my-sighting-dot-s1')).marginTop).toBe(14);
  });
});
