/**
 * WHAT:  Tests for ReadMore — the "Show more" toggle appears only when the
 *        text overflows the clamp (measured via onTextLayout), and toggles
 *        between expanded and collapsed.
 * WHY:   A dangling "Show more" on text that already fits, or a missing toggle
 *        on text that's truncated, both mislead; the overflow gate is the
 *        component's whole point.
 * LINKS: src/shared/ui/ReadMore.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { ReadMore } from './ReadMore';

const NOTE = 'A long owner note describing the car and where it was last seen.';

/** Fire the Text's onTextLayout with `count` reported lines. Wrapped in an
 *  awaited act — bare/sync acts corrupt the renderer for later tests. */
const layoutLines = (getByTestId: (id: string) => unknown, count: number) =>
  act(async () => {
    fireEvent(getByTestId('readmore-body') as never, 'textLayout', {
      nativeEvent: { lines: new Array(count).fill({ text: 'x' }) },
    });
  });

describe('ReadMore', () => {
  it('shows the toggle only once the text overflows the clamp', async () => {
    const { getByTestId, getByText, queryByText } = await render(
      <ReadMore numberOfLines={4}>{NOTE}</ReadMore>,
    );
    expect(queryByText('Show more')).toBeNull(); // not measured yet
    await layoutLines(getByTestId, 6);
    expect(getByText('Show more')).toBeTruthy();
  });

  it('shows no toggle for text that fits', async () => {
    const { getByTestId, queryByText } = await render(<ReadMore numberOfLines={4}>{NOTE}</ReadMore>);
    await layoutLines(getByTestId, 2);
    expect(queryByText('Show more')).toBeNull();
  });

  it('toggles between show more and show less', async () => {
    const { getByTestId, getByLabelText } = await render(
      <ReadMore numberOfLines={4}>{NOTE}</ReadMore>,
    );
    await layoutLines(getByTestId, 6);
    // Press the Pressable (by label), not the inner Text. Awaited act keeps
    // the renderer consistent after the async layout act above.
    await act(async () => fireEvent.press(getByLabelText('Show more')));
    expect(getByLabelText('Show less')).toBeTruthy();
    await act(async () => fireEvent.press(getByLabelText('Show less')));
    expect(getByLabelText('Show more')).toBeTruthy();
  });
});
