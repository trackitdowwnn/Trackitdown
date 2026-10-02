/**
 * WHAT:  Tests for ChoiceChips — selection callback, checked-state
 *        semantics, null-value rendering, the scrollable variant, the
 *        per-chip accessibilityLabel, and scrollToSelected (including
 *        reduced motion).
 * WHY:   Chips carry wizard answers and date presets; a chip that reports
 *        the wrong checked state misleads screen-reader users about what
 *        they've picked. The scrollable variant exists because the Inbox
 *        filters overflowed a phone and wrapped an orphan chip onto a second
 *        line, so its no-wrap is pinned rather than assumed.
 * LINKS: src/shared/ui/ChoiceChips.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';

import { ChoiceChips } from './ChoiceChips';

const OPTIONS = [
  { value: 'sage', label: 'Sage' },
  { value: 'sky', label: 'Sky' },
];

describe('ChoiceChips', () => {
  it('fires onSelect with the tapped value', async () => {
    const onSelect = jest.fn();
    const { getByLabelText } = await render(
      <ChoiceChips options={OPTIONS} value={null} onSelect={onSelect} />,
    );

    fireEvent.press(getByLabelText('Sky'));

    expect(onSelect).toHaveBeenCalledWith('sky');
  });

  it('marks only the selected chip as checked', async () => {
    const { getByLabelText } = await render(
      <ChoiceChips options={OPTIONS} value="sage" onSelect={() => {}} />,
    );

    expect(getByLabelText('Sage').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Sky').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('renders with no selection when value is null', async () => {
    const { getByLabelText } = await render(
      <ChoiceChips options={OPTIONS} value={null} onSelect={() => {}} />,
    );

    expect(getByLabelText('Sage').props.accessibilityState).toMatchObject({ checked: false });
  });

  describe('scrollable', () => {
    // The Inbox filters overflow a phone, and wrapping dropped the last chip
    // onto a ragged second line. Scrolling is the fix, so the row must stop
    // wrapping — asserting `nowrap` is asserting the actual bug is gone.
    it('stops the row wrapping so a long set scrolls instead', async () => {
      const { getByTestId } = await render(
        <ChoiceChips options={OPTIONS} value="sage" onSelect={() => {}} scrollable testID="chips" />,
      );

      expect(getByTestId('chips-scroller').props.horizontal).toBe(true);
      expect(StyleSheet.flatten(getByTestId('chips').props.style)).toMatchObject({
        flexWrap: 'nowrap',
      });
    });

    it('still selects normally when scrollable', async () => {
      const onSelect = jest.fn();
      const { getByLabelText } = await render(
        <ChoiceChips options={OPTIONS} value="sage" onSelect={onSelect} scrollable />,
      );

      fireEvent.press(getByLabelText('Sky'));

      expect(onSelect).toHaveBeenCalledWith('sky');
    });

    it('wraps by default — a form chip group has free vertical space', async () => {
      const { getByTestId, queryByTestId } = await render(
        <ChoiceChips options={OPTIONS} value="sage" onSelect={() => {}} testID="chips" />,
      );

      expect(queryByTestId('chips-scroller')).toBeNull();
      expect(StyleSheet.flatten(getByTestId('chips').props.style)).toMatchObject({
        flexWrap: 'wrap',
      });
    });
  });

  it('names the group, and says a chosen chip clears when clearable', async () => {
    const { getByLabelText } = await render(
      <ChoiceChips
        options={[
          { value: 'a', label: 'Parked' },
          { value: 'b', label: 'Moving' },
        ]}
        value="a"
        onSelect={() => {}}
        accessibilityLabel="What was it doing?"
        clearable
      />,
    );
    expect(getByLabelText('What was it doing?').props.accessibilityRole).toBe('radiogroup');
    expect(getByLabelText('Parked').props.accessibilityHint).toBe('Double tap to clear');
    expect(getByLabelText('Moving').props.accessibilityHint).toBeUndefined();
  });

  it('never promises "clear" on action chips, or when not clearable', async () => {
    const { getByLabelText, rerender } = await render(
      <ChoiceChips options={[{ value: 'a', label: 'Today' }]} value="a" onSelect={() => {}} role="button" clearable />,
    );
    expect(getByLabelText('Today').props.accessibilityHint).toBeUndefined();
    await rerender(<ChoiceChips options={[{ value: 'a', label: 'Today' }]} value="a" onSelect={() => {}} />);
    expect(getByLabelText('Today').props.accessibilityHint).toBeUndefined();
  });

  it('reads a terse label out in full when given an accessibilityLabel', async () => {
    const { getByLabelText, getByText, queryByLabelText } = await render(
      <ChoiceChips
        options={[
          { value: '0', label: ':00', accessibilityLabel: 'On the hour' },
          { value: '15', label: ':15' },
        ]}
        value="0"
        onSelect={() => {}}
      />,
    );

    // The screen shows ":00", a screen reader says "On the hour"...
    expect(getByText(':00')).toBeTruthy();
    expect(getByLabelText('On the hour').props.accessibilityState).toMatchObject({ checked: true });
    expect(queryByLabelText(':00')).toBeNull();
    // ...and without an override the visible label is the spoken one.
    expect(getByLabelText(':15')).toBeTruthy();
  });

  describe('scrollToSelected', () => {
    // An hour strip opening on 22:00 would otherwise show 00:00–04:00, with the
    // answer off-screen to the right.
    const HOURS = ['20', '21', '22'].map((hour) => ({ value: hour, label: `${hour}:00` }));
    const layout = (x: number) => ({ nativeEvent: { layout: { x, y: 0, width: 72, height: 44 } } });
    const scrollTo = ScrollView.prototype.scrollTo as jest.Mock;

    beforeEach(() => scrollTo.mockClear());

    it('brings the selected chip into view, instantly on first layout', async () => {
      const { getByLabelText } = await render(
        <ChoiceChips options={HOURS} value="22" onSelect={() => {}} scrollable scrollToSelected />,
      );

      await fireEvent(getByLabelText('20:00'), 'layout', layout(0));
      expect(scrollTo).not.toHaveBeenCalled(); // not the selected chip

      await fireEvent(getByLabelText('22:00'), 'layout', layout(160));
      expect(scrollTo).toHaveBeenCalledWith({ x: 160, animated: false });
    });

    it('animates to a newly selected chip', async () => {
      const view = await render(
        <ChoiceChips options={HOURS} value="22" onSelect={() => {}} scrollable scrollToSelected />,
      );
      await fireEvent(view.getByLabelText('21:00'), 'layout', layout(80));
      await fireEvent(view.getByLabelText('22:00'), 'layout', layout(160));

      await view.rerender(
        <ChoiceChips options={HOURS} value="21" onSelect={() => {}} scrollable scrollToSelected />,
      );

      expect(scrollTo).toHaveBeenLastCalledWith({ x: 80, animated: true });
    });

    it('never animates under reduced motion', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- spying on the mocked module, per jest/reanimatedMock.js
      const reanimated = require('react-native-reanimated');
      const reduced = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
      const view = await render(
        <ChoiceChips options={HOURS} value="22" onSelect={() => {}} scrollable scrollToSelected />,
      );
      await fireEvent(view.getByLabelText('21:00'), 'layout', layout(80));
      await fireEvent(view.getByLabelText('22:00'), 'layout', layout(160));

      await view.rerender(
        <ChoiceChips options={HOURS} value="21" onSelect={() => {}} scrollable scrollToSelected />,
      );

      expect(scrollTo).toHaveBeenLastCalledWith({ x: 80, animated: false });
      reduced.mockRestore();
    });

    it('leaves the scroller alone without the prop', async () => {
      const { getByLabelText } = await render(
        <ChoiceChips options={HOURS} value="22" onSelect={() => {}} scrollable />,
      );

      expect(getByLabelText('22:00').props.onLayout).toBeUndefined();
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});
