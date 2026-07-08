/**
 * WHAT:  Tests for PlateChip — uppercase rendering and the spelled-out
 *        screen-reader label.
 * WHY:   The plate is the app's core identifier; a chip that renders it
 *        wrong or reads it as a nonsense word fails sighted and screen-
 *        reader users alike.
 * LINKS: src/shared/ui/PlateChip.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { PlateChip, spellPlate } from './PlateChip';

describe('spellPlate', () => {
  it('spells groups character by character, comma between groups', () => {
    expect(spellPlate('AB12 CDE')).toBe('A B 1 2, C D E');
  });

  it('normalises case and stray whitespace', () => {
    expect(spellPlate('  ab12   cde ')).toBe('A B 1 2, C D E');
  });
});

describe('PlateChip', () => {
  it('renders the plate uppercased with the spelled accessibility label', async () => {
    const { getByText, getByLabelText } = await render(<PlateChip plate="ab12 cde" />);

    expect(getByText('AB12 CDE')).toBeTruthy();
    expect(getByLabelText('Plate A B 1 2, C D E')).toBeTruthy();
  });
});
