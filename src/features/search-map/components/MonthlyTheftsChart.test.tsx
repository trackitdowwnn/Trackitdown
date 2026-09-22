/**
 * WHAT:  Tests MonthlyTheftsChart — that every bar carries its count (zeros
 *        included), that month names appear only once the row has measured
 *        and only on the labelled columns, that the chart is ONE node to a
 *        screen reader, and that an empty series draws nothing.
 * WHY:   The chart replaced an unlabelled sparkline because it could not be
 *        read; these pin the labels that make it readable.
 * LINKS: ./MonthlyTheftsChart.tsx; ../lib/areaInsightsModel.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { monthlyColumns } from '../lib/areaInsightsModel';
import { MonthlyTheftsChart } from './MonthlyTheftsChart';

const YEAR = monthlyColumns(
  Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    // 0, 1, 2, … 11 — so both the zero and a busiest month exist.
    count: i,
  })),
);

describe('MonthlyTheftsChart', () => {
  it('gives every bar with thefts its count; a zero month shows only its stub', async () => {
    const view = await render(<MonthlyTheftsChart columns={YEAR} summary="s" />);
    expect(view.queryByTestId('chart-count-2026-01')).toBeNull();
    expect(view.getByTestId('chart-count-2026-12')).toHaveTextContent('11');
    expect(view.getAllByTestId(/^chart-count-/)).toHaveLength(11);
  });

  it('tucks the count inside a tall bar and perches it on a short one', async () => {
    const view = await render(<MonthlyTheftsChart columns={YEAR} summary="s" />);
    const colorOf = (key: string) =>
      (StyleSheet.flatten(view.getByTestId(`chart-count-${key}`).props.style) as { color: string })
        .color;
    // The busiest bar is full height and holds its numeral in the fill's
    // ink; the 1-of-11 bar is a nub and wears its numeral on top in page ink.
    expect(colorOf('2026-12')).not.toBe(colorOf('2026-02'));
  });

  it('names every other month once the row has measured, the last always among them', async () => {
    const view = await render(<MonthlyTheftsChart columns={YEAR} summary="s" />);
    // Before layout there is no column width to place a name by.
    expect(view.queryAllByTestId(/^chart-month-/)).toHaveLength(0);
    await act(async () => {
      fireEvent(view.getByTestId('monthly-thefts-bars'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 96 } },
      });
    });
    const names = view.getAllByTestId(/^chart-month-/);
    expect(names).toHaveLength(6);
    expect(view.getByTestId('chart-month-2026-12')).toHaveTextContent('Dec');
    expect(view.getByTestId('chart-month-2026-02')).toHaveTextContent('Feb');
    expect(view.queryByTestId('chart-month-2026-01')).toBeNull();
  });

  it('is one node to a screen reader, speaking the summary', async () => {
    const view = await render(
      <MonthlyTheftsChart columns={YEAR} summary="Cars reported stolen in 11 of the last 12 months." />,
    );
    const chart = view.getByTestId('monthly-thefts-chart');
    expect(chart.props.accessible).toBe(true);
    expect(chart.props.accessibilityLabel).toBe('Cars reported stolen in 11 of the last 12 months.');
  });

  it('draws nothing for an empty series', async () => {
    const view = await render(<MonthlyTheftsChart columns={[]} summary="s" />);
    expect(view.queryByTestId('monthly-thefts-chart')).toBeNull();
  });
});
