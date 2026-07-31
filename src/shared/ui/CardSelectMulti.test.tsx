/**
 * WHAT:  Tests for CardSelectMulti — add/remove toggling returns the full next
 *        selection, checked-state semantics per card, and the `locked` option
 *        reading as permanently checked, disabled, and unpressable.
 * WHY:   The locked behaviour is the reason this exists rather than a plain
 *        multi-select: the alert wizard shows "An area" as a required card so
 *        the list reads as the complete set. If a locked card could be toggled
 *        off — or merely REPORTED itself as unchecked — the user would believe
 *        they had turned off a constraint that is still enforced server-side.
 * LINKS: src/shared/ui/CardSelectMulti.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { CardSelectMulti } from './CardSelectMulti';

const OPTIONS = [
  { value: 'area', label: 'An area', description: 'Always on', locked: true },
  { value: 'car', label: 'A specific car', description: 'Make, model, colour' },
  { value: 'bounty', label: 'A minimum bounty', description: 'Higher-value reports' },
];

describe('CardSelectMulti', () => {
  it('adds a value when an unselected card is tapped', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CardSelectMulti options={OPTIONS} value={['car']} onChange={onChange} />,
    );

    fireEvent.press(getByLabelText('A minimum bounty. Higher-value reports'));

    expect(onChange).toHaveBeenCalledWith(['car', 'bounty']);
  });

  it('removes a value when a selected card is tapped', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CardSelectMulti options={OPTIONS} value={['car', 'bounty']} onChange={onChange} />,
    );

    fireEvent.press(getByLabelText('A specific car. Make, model, colour'));

    expect(onChange).toHaveBeenCalledWith(['bounty']);
  });

  it('reports each card’s checked state to assistive tech', async () => {
    const { getByLabelText } = await render(
      <CardSelectMulti options={OPTIONS} value={['bounty']} onChange={() => {}} />,
    );

    expect(
      getByLabelText('A minimum bounty. Higher-value reports').props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(
      getByLabelText('A specific car. Make, model, colour').props.accessibilityState,
    ).toMatchObject({ checked: false });
  });

  it('shows a locked option as checked and disabled even when absent from value', async () => {
    // `value` deliberately omits 'area' — a locked card must still read as on,
    // because the constraint it represents is enforced regardless.
    const { getByLabelText } = await render(
      <CardSelectMulti options={OPTIONS} value={[]} onChange={() => {}} />,
    );

    expect(getByLabelText('An area. Always on').props.accessibilityState).toMatchObject({
      checked: true,
      disabled: true,
    });
  });

  it('ignores taps on a locked option', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <CardSelectMulti options={OPTIONS} value={['area']} onChange={onChange} />,
    );

    fireEvent.press(getByLabelText('An area. Always on'));

    expect(onChange).not.toHaveBeenCalled();
  });
});
