/**
 * WHAT:  Tests for EmptyState — renders title/body, action button fires,
 *        and the action row is omitted when no action is given.
 * WHY:   Every "nothing here" moment in the app rides on this layout; an
 *        empty state that hides its action (or shows a dead one) strands
 *        users exactly when they need a way forward.
 * LINKS: src/shared/ui/EmptyState.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and body', async () => {
    const { getByText } = await render(
      <EmptyState title="No matches" body="Try a shorter search." />,
    );

    expect(getByText('No matches')).toBeTruthy();
    expect(getByText('Try a shorter search.')).toBeTruthy();
  });

  it('fires the action when its button is pressed', async () => {
    const onAction = jest.fn();
    const { getByRole } = await render(
      <EmptyState title="No matches" actionLabel="Clear search" onAction={onAction} />,
    );

    fireEvent.press(getByRole('button', { name: 'Clear search' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders no button when there is no action', async () => {
    const { queryByRole } = await render(<EmptyState title="No matches" />);

    expect(queryByRole('button')).toBeNull();
  });
});
