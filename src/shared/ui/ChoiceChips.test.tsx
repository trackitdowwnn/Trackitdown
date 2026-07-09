/**
 * WHAT:  Tests for ChoiceChips — selection callback, checked-state
 *        semantics, and null-value rendering.
 * WHY:   Chips carry wizard answers and date presets; a chip that reports
 *        the wrong checked state misleads screen-reader users about what
 *        they've picked.
 * LINKS: src/shared/ui/ChoiceChips.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

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
});
