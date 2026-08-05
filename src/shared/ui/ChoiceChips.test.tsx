/**
 * WHAT:  Tests for ChoiceChips — selection callback, checked-state
 *        semantics, null-value rendering, and the scrollable variant.
 * WHY:   Chips carry wizard answers and date presets; a chip that reports
 *        the wrong checked state misleads screen-reader users about what
 *        they've picked. The scrollable variant exists because the Inbox
 *        filters overflowed a phone and wrapped an orphan chip onto a second
 *        line, so its no-wrap is pinned rather than assumed.
 * LINKS: src/shared/ui/ChoiceChips.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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
});
