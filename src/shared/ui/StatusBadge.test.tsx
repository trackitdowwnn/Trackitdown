/**
 * WHAT:  Tests for StatusBadge — renders the mapped label for a non-active
 *        status, renders nothing for `active`, and the statusBadgeLabel helper.
 * WHY:   The badge is the one signal that a listing isn't live; a badge
 *        wrongly shown on an active post (or missing on a recovered one) would
 *        misrepresent a car's state.
 * LINKS: src/shared/ui/StatusBadge.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { StatusBadge, statusBadgeLabel } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the mapped label for a non-active status', async () => {
    const { getByText } = await render(<StatusBadge status="recovered" />);
    expect(getByText('Recovered')).toBeTruthy();
  });

  it('renders nothing for an active post', async () => {
    const { toJSON } = await render(<StatusBadge status="active" />);
    expect(toJSON()).toBeNull();
  });

  it('statusBadgeLabel returns the label or null', () => {
    expect(statusBadgeLabel('pending_verification')).toBe('Pending');
    expect(statusBadgeLabel('recovery_claimed')).toBe('Recovery claimed');
    expect(statusBadgeLabel('active')).toBeNull();
  });
});
