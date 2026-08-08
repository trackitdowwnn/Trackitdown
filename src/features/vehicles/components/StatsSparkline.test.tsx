/**
 * WHAT:  Tests StatsSparkline — that empty days are DRAWN and visible, that a
 *        day with sightings never rounds away, and that the spoken label
 *        carries the distribution rather than the axis.
 * WHY:   This file exists because it was missing and a review found the bug it
 *        would have caught: empty days were `colors.border` (#DDDDDD) at 1pt,
 *        which is ~1.36:1 on a white card — invisible. The busy days then
 *        floated on white and read as steady activity, the exact misreading
 *        drawing the empty days was meant to prevent. A render assertion on bar
 *        colour is all it took.
 * LINKS: ./StatsSparkline.tsx; ../lib/postStatsModel.ts (toSparkline).
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, sizes } from '@/shared/theme';

import type { SparklineBar } from '../lib/postStatsModel';
import { StatsSparkline } from './StatsSparkline';

const bar = (day: string, count: number, fraction: number): SparklineBar => ({
  day,
  count,
  fraction,
});

/** Every bar View, in order. The row itself is the only labelled node.
 *
 *  Selected by testID, not by its a11y label: the label is copy and has already
 *  changed once (it now varies by branch — the all-zero row reads "No sightings
 *  in the last N days"), and a selector that drifts with copy is how the screen
 *  test's chart assertions silently stopped testing anything. */
const barsOf = (view: ReturnType<typeof render> extends Promise<infer T> ? T : never) =>
  view.getByTestId('stats-sparkline').props.children as { props: { style: unknown } }[];

const flat = (node: { props: { style: unknown } }) =>
  StyleSheet.flatten(node.props.style) as { height: number; backgroundColor: string };

/** WCAG relative luminance for a #rrggbb string. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio. 3:1 is the floor for non-text graphics (1.4.11). */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('StatsSparkline', () => {
  it('renders nothing when there is nothing to draw', async () => {
    const view = await render(<StatsSparkline bars={[]} />);

    expect(view.toJSON()).toBeNull();
  });

  // THE REGRESSION. An empty day must be visible ink, not a hairline nobody
  // can see — without the axis, three marks on the page read as steady activity.
  //
  // Asserted as CONTRAST, not as a token. The first version of this test pinned
  // colors.borderStrong, and when the Airbnb pass removed the cards from under
  // the chart it kept passing: #949494 is 3.03:1 on a white card but 2.83:1 on
  // colors.background, so the value the test approved had quietly stopped
  // clearing the 3:1 graphic minimum. The token was never the requirement.
  it('draws empty days in ink that clears 3:1 on the surface it sits on', async () => {
    const view = await render(
      <StatsSparkline bars={[bar('2026-08-06', 0, 0), bar('2026-08-07', 2, 1)]} />,
    );

    const [empty] = barsOf(view).map(flat);
    expect(contrast(empty.backgroundColor, colors.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(empty.backgroundColor, colors.surface)).toBeGreaterThanOrEqual(3);
    expect(empty.height).toBe(sizes.sparklineEmpty);
  });

  // toSparkline returns [] rather than an all-zero row, so this shape does not
  // arrive today — but the props permit it and the invariant lives in another
  // file. Before the guard, Math.max(...[]) and an undefined `latest` threw
  // while BUILDING the a11y label, which unmounts the screen rather than
  // degrading it.
  it('survives an all-zero row instead of throwing while building its label', async () => {
    const view = await render(
      <StatsSparkline bars={[bar('2026-08-06', 0, 0), bar('2026-08-07', 0, 0)]} />,
    );

    expect(view.getByTestId('stats-sparkline')).toBeTruthy();
    expect(view.getByLabelText('No sightings in the last 2 days.')).toBeTruthy();
  });

  it('draws days WITH sightings in the primary ink', async () => {
    const view = await render(<StatsSparkline bars={[bar('2026-08-07', 2, 1)]} />);

    expect(flat(barsOf(view)[0]).backgroundColor).toBe(colors.primary);
  });

  // A quiet day beside a busy one scales to almost nothing; without the floor
  // it rounds into the empty stub and a real sighting reads as no sighting.
  it('never lets a real sighting round away to the empty stub', async () => {
    const view = await render(
      <StatsSparkline bars={[bar('2026-08-06', 1, 0.01), bar('2026-08-07', 100, 1)]} />,
    );

    const [quiet] = barsOf(view).map(flat);
    expect(quiet.height).toBe(sizes.sparklineMin);
    expect(quiet.height).toBeGreaterThan(sizes.sparklineEmpty);
  });

  it('scales the tallest bar to the full height', async () => {
    const view = await render(<StatsSparkline bars={[bar('2026-08-07', 4, 1)]} height={64} />);

    expect(flat(barsOf(view)[0]).height).toBe(64);
  });

  // The label has to say WHEN reports came — the counts above already carry
  // the totals, so an axis description would tell a screen-reader user nothing
  // the rest of the page hasn't.
  it('speaks the distribution, not just the axis', async () => {
    const view = await render(
      <StatsSparkline
        bars={[bar('2026-08-05', 3, 1), bar('2026-08-06', 0, 0), bar('2026-08-07', 1, 0.33)]}
      />,
    );

    const label = view.getByLabelText(/Sightings on/).props.accessibilityLabel as string;
    expect(label).toMatch(/Sightings on 2 of the last 3 days/);
    expect(label).toMatch(/Busiest day 3/);
    expect(label).toMatch(/Most recent/);
  });

  // 28 focusable stubs would be noise to swipe through.
  it('keeps the individual bars out of the assistive-tech tree', async () => {
    const view = await render(
      <StatsSparkline bars={[bar('2026-08-06', 0, 0), bar('2026-08-07', 2, 1)]} />,
    );

    for (const node of barsOf(view) as unknown as { props: { accessible?: boolean } }[]) {
      expect(node.props.accessible).toBeUndefined();
    }
  });
});
