/**
 * WHAT:  Tests for OptionCard — the option card drawn read-only: title and
 *        line, one screen-reader statement, no radio/checkbox role, and the
 *        chosen card's primary border (the same as CardSelect's).
 * WHY:   It shows an answer BACK (check-and-send). A role would make a screen
 *        reader offer a toggle that does nothing; a different border would
 *        make the answer look like a card they didn't tap.
 * LINKS: src/shared/ui/OptionCard.tsx, ./optionCardStyles.ts, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';
import { SquareParking } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { paletteFor } from '../theme';
import { CardSelect } from './CardSelect';
import { OptionCard } from './OptionCard';

describe('OptionCard', () => {
  it('shows the title and its line, read as one statement', async () => {
    const { getByText, getByTestId } = await render(
      <OptionCard
        icon={SquareParking}
        label="Parked"
        description="Looks parked up"
        testID="card"
      />,
    );
    expect(getByText('Parked')).toBeTruthy();
    expect(getByText('Looks parked up')).toBeTruthy();
    const card = getByTestId('card');
    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityLabel).toBe('Parked, Looks parked up');
  });

  it('⚠️ has no radio or checkbox role — nothing to toggle here', async () => {
    const { queryAllByRole, getByTestId } = await render(
      <OptionCard label="Damage visible" testID="card" />,
    );
    expect(queryAllByRole('radio')).toHaveLength(0);
    expect(queryAllByRole('checkbox')).toHaveLength(0);
    expect(getByTestId('card').props.accessibilityRole).toBeUndefined();
  });

  it('wears the chosen border by default — exactly CardSelect’s chosen card', async () => {
    const shown = await render(<OptionCard label="Parked" testID="card" />);
    const shownStyle = StyleSheet.flatten(shown.getByTestId('card').props.style);
    const picked = await render(
      <CardSelect
        options={[{ value: 'parked', label: 'Parked' }]}
        value="parked"
        onSelect={() => {}}
      />,
    );
    const pickedStyle = StyleSheet.flatten(picked.getByRole('radio').props.style);
    expect(shownStyle.borderColor).toBe(paletteFor('light').primary);
    for (const key of [
      'borderColor',
      'borderWidth',
      'borderRadius',
      'paddingVertical',
      'minHeight',
    ] as const) {
      expect(shownStyle[key]).toBe(pickedStyle[key]);
    }
  });
});
