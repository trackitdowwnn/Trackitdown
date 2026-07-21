/**
 * WHAT:  Tests for PermissionPrimer — ask variant renders the content and
 *        fires the primary action, the ghost opt-out appears only when
 *        wired, the denied variant swaps to acknowledging copy with "Open
 *        settings", and the illustration stays hidden from screen readers.
 * WHY:   The primer is the consent moment before an OS prompt; a dropped
 *        callback dead-ends a permission flow, and a denied state that
 *        keeps the ask copy re-prompts into a wall.
 * LINKS: src/shared/ui/PermissionPrimer.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { PermissionPrimer, type PermissionPrimerContent } from './PermissionPrimer';

const content: PermissionPrimerContent = {
  emoji: '📍',
  headline: 'Pin it to the exact spot',
  body: 'Your report carries the spot where you’re standing.',
  allowLabel: 'Allow location',
  secondaryLabel: 'Continue without location',
  denied: {
    headline: 'Location is off',
    body: 'No problem — you can turn it on any time.',
    secondaryLabel: 'Not now',
  },
};

describe('PermissionPrimer', () => {
  it('renders the ask content and fires the primary action', async () => {
    const onPrimary = jest.fn();
    const { getByText } = await render(
      <PermissionPrimer content={content} onPrimary={onPrimary} />,
    );
    expect(getByText('Pin it to the exact spot')).toBeTruthy();
    expect(getByText('Your report carries the spot where you’re standing.')).toBeTruthy();
    fireEvent.press(getByText('Allow location'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('offers the opt-out only when the consumer wires it', async () => {
    const onSecondary = jest.fn();
    const without = await render(<PermissionPrimer content={content} onPrimary={() => {}} />);
    expect(without.queryByText('Continue without location')).toBeNull();

    const withSecondary = await render(
      <PermissionPrimer content={content} onPrimary={() => {}} onSecondary={onSecondary} />,
    );
    fireEvent.press(withSecondary.getByText('Continue without location'));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('denied variant shows acknowledging copy with Open settings as primary', async () => {
    const onPrimary = jest.fn();
    const { getByText, queryByText } = await render(
      <PermissionPrimer
        content={content}
        variant="denied"
        onPrimary={onPrimary}
        onSecondary={() => {}}
      />,
    );
    expect(getByText('Location is off')).toBeTruthy();
    expect(getByText('No problem — you can turn it on any time.')).toBeTruthy();
    // The ask copy and label are gone — no dead re-prompt.
    expect(queryByText('Pin it to the exact spot')).toBeNull();
    expect(queryByText('Allow location')).toBeNull();
    fireEvent.press(getByText('Open settings'));
    expect(onPrimary).toHaveBeenCalledTimes(1);
    expect(getByText('Not now')).toBeTruthy();
  });

  it('headline is a header and the illustration is decorative', async () => {
    const { getByRole, getByText, queryByText } = await render(
      <PermissionPrimer content={content} onPrimary={() => {}} />,
    );
    expect(getByRole('header').props.children).toBe('Pin it to the exact spot');
    // The emoji is rendered but invisible to assistive tech: absent from the
    // accessibility tree, present when hidden elements are included.
    expect(queryByText('📍')).toBeNull();
    expect(getByText('📍', { includeHiddenElements: true })).toBeTruthy();
  });

  it('drops the header role when the host screen owns the header', async () => {
    const { queryByRole, getByText } = await render(
      <PermissionPrimer content={content} onPrimary={() => {}} announceAsHeader={false} />,
    );
    expect(queryByRole('header')).toBeNull();
    expect(getByText('Pin it to the exact spot')).toBeTruthy();
  });
});
