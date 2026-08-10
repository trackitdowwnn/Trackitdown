/**
 * WHAT:  Tests for PlateChip — uppercase rendering, the spelled-out
 *        screen-reader label, and long-press-to-copy (including the rule that
 *        the chip must still forward an enclosing card's tap).
 * WHY:   The plate is the app's core identifier; a chip that renders it
 *        wrong or reads it as a nonsense word fails sighted and screen-
 *        reader users alike. The forwarded-tap test is the regression guard
 *        that matters: the chip became a Pressable to gain long-press, and a
 *        responder with no onPress silently swallows the card's own tap —
 *        which would stop a strip of every feed card opening its listing.
 * LINKS: src/shared/ui/PlateChip.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { PlateChip, spellPlate } from './PlateChip';

const mockSetString = jest.fn((_value: string) => Promise.resolve(true));
jest.mock('expo-clipboard', () => ({
  setStringAsync: (value: string) => mockSetString(value),
}));

beforeEach(() => {
  mockSetString.mockClear();
});

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
    const { getByText, getByLabelText } = await render(<PlateChip plate="ab12 cde" onPress={null} />);

    expect(getByText('AB12 CDE')).toBeTruthy();
    expect(getByLabelText('Plate A B 1 2, C D E')).toBeTruthy();
  });

  it('copies the plate uppercased on long press', async () => {
    const { getByLabelText } = await render(<PlateChip plate="ab12 cde" onPress={null} />);

    await act(async () => {
      fireEvent(getByLabelText('Plate A B 1 2, C D E'), 'longPress');
    });

    expect(mockSetString).toHaveBeenCalledWith('AB12 CDE');
  });

  it('copies from the screen-reader action as well as the gesture', async () => {
    const { getByLabelText } = await render(<PlateChip plate="ab12 cde" onPress={null} />);

    await act(async () => {
      fireEvent(getByLabelText('Plate A B 1 2, C D E'), 'accessibilityAction', {
        nativeEvent: { actionName: 'copy' },
      });
    });

    expect(mockSetString).toHaveBeenCalledWith('AB12 CDE');
  });

  it('forwards a tap to the enclosing card instead of swallowing it', async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(<PlateChip plate="AB12 CDE" onPress={onPress} />);

    await act(async () => {
      fireEvent.press(getByLabelText('Plate A B 1 2, C D E'));
    });

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockSetString).not.toHaveBeenCalled();
  });

  it('renders without a ToastProvider above it', async () => {
    // Every card test renders bare; the copy must not require the provider.
    const { getByLabelText } = await render(<PlateChip plate="AB12 CDE" onPress={null} />);

    await act(async () => {
      fireEvent(getByLabelText('Plate A B 1 2, C D E'), 'longPress');
    });

    expect(mockSetString).toHaveBeenCalledWith('AB12 CDE');
  });
});
