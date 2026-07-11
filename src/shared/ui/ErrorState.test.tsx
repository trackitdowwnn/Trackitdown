/**
 * WHAT:  Tests for ErrorState — default copy renders, retry fires, and the
 *        button is omitted when no onRetry is given.
 * WHY:   A failed load with a dead or missing retry strands the user at the
 *        exact moment the app already let them down once.
 * LINKS: src/shared/ui/ErrorState.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders default title and retry label with custom body', async () => {
    const { getByText } = await render(
      <ErrorState body="We couldn't load the feed." onRetry={() => {}} />,
    );

    expect(getByText('Something went wrong')).toBeTruthy();
    expect(getByText("We couldn't load the feed.")).toBeTruthy();
    expect(getByText('Try again')).toBeTruthy();
  });

  it('fires onRetry when the retry button is pressed', async () => {
    const onRetry = jest.fn();
    const { getByRole } = await render(
      <ErrorState retryLabel="Reload feed" onRetry={onRetry} />,
    );

    fireEvent.press(getByRole('button', { name: 'Reload feed' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders no button when onRetry is absent', async () => {
    const { queryByRole } = await render(<ErrorState title="Feed unavailable" />);

    expect(queryByRole('button')).toBeNull();
  });
});
