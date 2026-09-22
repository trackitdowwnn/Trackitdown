/**
 * WHAT:  Tests RankedBars — that each row is one spoken node with its name
 *        and count, that the bar is scaled to the top row, and that an empty
 *        list draws nothing.
 * LINKS: ./RankedBars.tsx; ../lib/areaInsightsModel.ts (rankedMakes).
 */

import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { rankedMakes } from '../lib/areaInsightsModel';
import { RankedBars } from './RankedBars';

const ROWS = rankedMakes([
  { make: 'ford', count: 6 },
  { make: 'bmw', count: 3 },
]);

describe('RankedBars', () => {
  it('speaks each row as one node, name then count', async () => {
    const view = await render(<RankedBars rows={ROWS} testID="makes" />);
    expect(view.getByTestId('makes-Ford').props.accessibilityLabel).toBe('Ford: 6');
    expect(view.getByTestId('makes-BMW').props.accessibilityLabel).toBe('BMW: 3');
    expect(view.getByText('Ford')).toBeTruthy();
    expect(view.getByText('6')).toBeTruthy();
  });

  it('scales every bar to the top row', async () => {
    const view = await render(<RankedBars rows={ROWS} testID="makes" />);
    const widthOf = (key: string) => {
      const row = view.getByTestId(`makes-${key}`);
      // row → [line, track → [fill]] (ReportCard.test walks children the same way)
      const track = row.children[1] as { children: { props: { style?: unknown } }[] };
      return (StyleSheet.flatten(track.children[0].props.style) as { width: string }).width;
    };
    expect(widthOf('Ford')).toBe('100%');
    expect(widthOf('BMW')).toBe('50%');
  });

  it('draws nothing for an empty list', async () => {
    const view = await render(<RankedBars rows={[]} testID="makes" />);
    expect(view.queryByTestId('makes')).toBeNull();
  });
});
