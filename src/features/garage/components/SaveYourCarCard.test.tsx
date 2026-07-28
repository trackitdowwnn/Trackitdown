/**
 * WHAT:  Tests for the Explore feed's save-your-car card — both actions fire,
 *        and the dismiss control is reachable.
 * WHY:   This is the app's one reaching surface for the garage, and it is also
 *        the only nudge a user can actively refuse. If dismiss doesn't work it
 *        becomes unignorable clutter on the hottest screen, which is exactly the
 *        failure that makes people distrust a product's prompts.
 * LINKS: src/features/garage/components/SaveYourCarCard.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SaveYourCarCard } from './SaveYourCarCard';

describe('SaveYourCarCard', () => {
  it('leads with the value, not an instruction', async () => {
    const { getByText } = await act(async () =>
      render(<SaveYourCarCard onAdd={jest.fn()} onDismiss={jest.fn()} />),
    );

    expect(getByText('Is your car in here?')).toBeTruthy();
    expect(getByText('Add your car')).toBeTruthy();
  });

  it('fires onAdd', async () => {
    const onAdd = jest.fn();
    const { getByText } = await act(async () =>
      render(<SaveYourCarCard onAdd={onAdd} onDismiss={jest.fn()} />),
    );

    await act(async () => {
      fireEvent.press(getByText('Add your car'));
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed, and the control is labelled for screen readers', async () => {
    const onDismiss = jest.fn();
    const { getByTestId, getByLabelText } = await act(async () =>
      render(<SaveYourCarCard onAdd={jest.fn()} onDismiss={onDismiss} />),
    );

    expect(getByLabelText('Dismiss')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId('garage-nudge-dismiss'));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
