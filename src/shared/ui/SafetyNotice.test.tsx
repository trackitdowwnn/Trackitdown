/**
 * WHAT:  Tests for SafetyNotice — carries the non-negotiable "report, don't
 *        approach" copy and the 999 line, as an accessibility alert.
 * WHY:   SECURITY_AND_TRUST §1 makes this exact wording a product requirement;
 *        a test locks it so a well-meaning copy edit can't soften it.
 * LINKS: src/shared/ui/SafetyNotice.tsx, docs/SECURITY_AND_TRUST.md §1.
 */

import { render } from '@testing-library/react-native';

import { SafetyNotice } from './SafetyNotice';

describe('SafetyNotice', () => {
  it('states never-approach and call 999, as an alert', async () => {
    const { getByText, getByRole } = await render(<SafetyNotice />);
    expect(getByText(/Never approach the vehicle/i)).toBeTruthy();
    expect(getByText(/call 999/i)).toBeTruthy();
    expect(getByRole('alert')).toBeTruthy();
  });
});
