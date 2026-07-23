/**
 * WHAT:  Tests for TrustBlock — a visible active post reads "Ownership
 *        verified"; an owner's own pending post reads "Pending verification";
 *        statuses with no honest claim (rejected/cancelled) render NOTHING
 *        (hasTrustRow false — the page skips the section). Posted/active-until
 *        rows were removed (2026-07-23): the listed-on date lives in the
 *        title block now.
 * WHY:   "Ownership verified" is DERIVED from status, not stored — a wrong
 *        derivation would either claim verification a post doesn't have or hide
 *        it on one that does.
 * LINKS: src/features/vehicles/components/TrustBlock.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { TrustBlock, hasTrustRow } from './TrustBlock';

describe('TrustBlock', () => {
  it('active post: ownership verified with the evidence line', async () => {
    const { getByText, queryByText } = await render(<TrustBlock status="active" />);
    expect(getByText('Ownership verified')).toBeTruthy();
    // The evidence line under the fact (redesign B1+F2): procedural, no selling.
    expect(getByText(/V5C logbook was checked/)).toBeTruthy();
    expect(queryByText('Pending verification')).toBeNull();
    expect(queryByText(/Active until/)).toBeNull();
    expect(queryByText(/^Posted /)).toBeNull();
  });

  it("owner's own pending post: pending verification", async () => {
    const { getByText, queryByText } = await render(
      <TrustBlock status="pending_verification" />,
    );
    expect(getByText('Pending verification')).toBeTruthy();
    expect(getByText(/checking the owner’s V5C logbook/)).toBeTruthy();
    expect(queryByText('Ownership verified')).toBeNull();
  });

  it('recovered post: still reads verified', async () => {
    const { getByText } = await render(<TrustBlock status="recovered" />);
    expect(getByText('Ownership verified')).toBeTruthy();
  });

  it("owner's own draft: pending, not verified", async () => {
    const { getByText, queryByText } = await render(<TrustBlock status="draft" />);
    expect(getByText('Pending verification')).toBeTruthy();
    expect(queryByText('Ownership verified')).toBeNull();
  });

  it('rejected/cancelled: renders nothing, and hasTrustRow says so', async () => {
    const rejected = await render(<TrustBlock status="rejected" />);
    expect(rejected.toJSON()).toBeNull();
    const cancelled = await render(<TrustBlock status="cancelled" />);
    expect(cancelled.toJSON()).toBeNull();
    expect(hasTrustRow('rejected')).toBe(false);
    expect(hasTrustRow('cancelled')).toBe(false);
    expect(hasTrustRow('active')).toBe(true);
    expect(hasTrustRow('draft')).toBe(true);
  });
});
