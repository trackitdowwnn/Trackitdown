/**
 * WHAT:  Tests for CardSelect — renders a card per option (title + subtext),
 *        fires onSelect with the tapped value, and reflects the selected value
 *        via the radio `checked` a11y state.
 * WHY:   It's the shared single-select-card primitive (body type today); the
 *        selection contract + radio semantics are what consumers rely on.
 * LINKS: src/shared/ui/CardSelect.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { Car, Truck } from 'lucide-react-native';

import { CardSelect } from './CardSelect';

const OPTIONS = [
  { value: 'hatch', label: 'Hatchback', description: 'Compact', icon: Car },
  { value: 'suv', label: 'SUV', description: 'Tall', icon: Truck },
];

describe('CardSelect', () => {
  it('renders a card (title + subtext) per option', async () => {
    const { getByText } = await render(
      <CardSelect options={OPTIONS} value={null} onSelect={() => {}} />,
    );
    expect(getByText('Hatchback')).toBeTruthy();
    expect(getByText('Compact')).toBeTruthy();
    expect(getByText('SUV')).toBeTruthy();
  });

  it('fires onSelect with the tapped value', async () => {
    const onSelect = jest.fn();
    const { getByText } = await render(
      <CardSelect options={OPTIONS} value={null} onSelect={onSelect} />,
    );
    fireEvent.press(getByText('SUV'));
    expect(onSelect).toHaveBeenCalledWith('suv');
  });

  it('marks the selected option checked (radio a11y)', async () => {
    const { getByLabelText } = await render(
      <CardSelect options={OPTIONS} value="suv" onSelect={() => {}} />,
    );
    expect(getByLabelText('SUV. Tall').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Hatchback. Compact').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });
});
