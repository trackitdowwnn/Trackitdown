/**
 * WHAT:  Tests for PermissionPrimer — renders title/body, fires the primary
 *        action, and shows the secondary path only when provided.
 * WHY:   The primer is the consent moment before an OS prompt; a dropped
 *        callback would dead-end a permission flow.
 * LINKS: src/shared/ui/PermissionPrimer.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { PermissionPrimer } from './PermissionPrimer';

describe('PermissionPrimer', () => {
  it('renders the copy and fires the primary action', async () => {
    const onPrimary = jest.fn();
    const { getByText } = await render(
      <PermissionPrimer
        title="Add where you are"
        body="Each photo carries where it was taken."
        primaryLabel="Allow location"
        onPrimary={onPrimary}
      />,
    );
    expect(getByText('Each photo carries where it was taken.')).toBeTruthy();
    fireEvent.press(getByText('Allow location'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('offers the secondary path only when provided', async () => {
    const onSecondary = jest.fn();
    const first = await render(
      <PermissionPrimer title="Allow location" body="Why." primaryLabel="Allow" onPrimary={() => {}} />,
    );
    expect(first.queryByText('Continue without location')).toBeNull();

    const second = await render(
      <PermissionPrimer
        title="Allow location"
        body="Why."
        primaryLabel="Allow"
        onPrimary={() => {}}
        secondaryLabel="Continue without location"
        onSecondary={onSecondary}
      />,
    );
    fireEvent.press(second.getByText('Continue without location'));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });
});
