/**
 * WHAT:  Tests RadiusSlider's UNSET readout — the "Any" state the search sheet
 *        uses while no radius is applied, and the rule that the first touch
 *        commits a value rather than quietly clearing the label.
 * WHY:   The slider shipped with no tests at all, and the first thing the
 *        `unsetLabel` prop did was reintroduce the lie it was written to
 *        remove: `lastSnapped` starts at the RESTING value, so a touch that
 *        did not cross a snap boundary cleared "Any" and emitted nothing —
 *        readout saying "10 miles" over a search filtering by no distance.
 *        Above 5 miles the snap step is 5, so the dead band around a resting
 *        10 is 7.5–12.5: most of the thumb. Caught in review, not by a test.
 * LINKS: ./RadiusSlider.tsx; ./radiusSliderMath.ts (the snap grid);
 *        src/features/search-map/components/SearchSheet.tsx (the consumer
 *          that passes unsetLabel).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { RadiusSlider } from './RadiusSlider';

const action = (name: string) => ({ nativeEvent: { actionName: name } });

const renderSlider = async (props: Partial<React.ComponentProps<typeof RadiusSlider>> = {}) => {
  const onChangeMiles = jest.fn();
  const view = await act(async () =>
    render(
      <RadiusSlider
        label="Distance"
        valueMiles={10}
        onChangeMiles={onChangeMiles}
        testID="radius"
        {...props}
      />,
    ),
  );
  return { view, onChangeMiles };
};

describe('the unset readout', () => {
  it('speaks the label instead of the miles while nothing is applied', async () => {
    const { view } = await renderSlider({ unsetLabel: 'Any' });

    const track = view.getByTestId('radius-track');
    expect(track.props.accessibilityValue).toEqual({ text: 'Any' });
  });

  it('⚠️ publishes NO numeric position while unset', async () => {
    // `now: 10` beside `text: "Any"` lets TalkBack build a RangeInfo and
    // announce a position — asserting a filter that is switched off, which is
    // the same untruth in the accessibility tree that the readout stopped
    // telling on screen.
    const { view } = await renderSlider({ unsetLabel: 'Any' });

    expect(view.getByTestId('radius-track').props.accessibilityValue).not.toHaveProperty('now');
  });

  it('reports the value normally once a radius is applied', async () => {
    const { view } = await renderSlider({ valueMiles: 25 });

    expect(view.getByTestId('radius-track').props.accessibilityValue).toMatchObject({
      now: 25,
      text: '25 miles',
    });
  });

  it('⚠️ the first accessibility press APPLIES the resting value, it does not step off it', async () => {
    // stepAtMiles(10) is 5, so stepping would make the first increment commit
    // 15 and the first decrement 5 — leaving the resting 10 unreachable in one
    // press, and skipping the state a touch would have applied.
    const { view, onChangeMiles } = await renderSlider({ unsetLabel: 'Any' });

    await act(async () => {
      fireEvent(view.getByTestId('radius-track'), 'accessibilityAction', action('increment'));
    });
    expect(onChangeMiles).toHaveBeenCalledWith(10);

    await act(async () => {
      fireEvent(view.getByTestId('radius-track'), 'accessibilityAction', action('decrement'));
    });
    expect(onChangeMiles).toHaveBeenNthCalledWith(2, 10);
  });

  it('steps normally once a value is applied', async () => {
    const { view, onChangeMiles } = await renderSlider({ valueMiles: 10 });

    await act(async () => {
      fireEvent(view.getByTestId('radius-track'), 'accessibilityAction', action('increment'));
    });
    expect(onChangeMiles).toHaveBeenCalledWith(15);
  });
});
