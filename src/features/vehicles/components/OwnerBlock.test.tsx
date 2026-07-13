/**
 * WHAT:  Tests for OwnerBlock — a signed-in viewer sees "Posted by <first
 *        name>" + member-since; an anonymous viewer (no first name from the
 *        RPC) sees the de-identified "Verified owner". Neither ever shows a
 *        surname.
 * WHY:   The signed-in-only exposure of a theft victim's identity is a SAFETY
 *        boundary (docs/DOMAIN.md "Owner identity on a post"); this pins the
 *        two render modes the RPC's presence/absence of first_name drives.
 * LINKS: src/features/vehicles/components/OwnerBlock.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { OwnerBlock } from './OwnerBlock';

describe('OwnerBlock', () => {
  it('signed-in viewer: shows the first name and member-since', async () => {
    const { getByText } = await render(
      <OwnerBlock owner={{ memberSince: '2025-01-05T00:00:00Z', firstName: 'Alex' }} />,
    );
    expect(getByText('Posted by Alex')).toBeTruthy();
    expect(getByText('Member since January 2025')).toBeTruthy();
  });

  it('anonymous viewer: de-identified "Verified owner", no name', async () => {
    const { getByText, queryByText } = await render(
      <OwnerBlock owner={{ memberSince: '2025-01-05T00:00:00Z' }} />,
    );
    expect(getByText('Verified owner')).toBeTruthy();
    expect(getByText('Member since January 2025')).toBeTruthy();
    expect(queryByText(/Posted by/)).toBeNull();
  });
});
