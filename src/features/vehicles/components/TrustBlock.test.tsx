/**
 * WHAT:  Tests for TrustBlock — a visible active post reads "Ownership
 *        verified" + posted + active-until; an owner's own pending post reads
 *        "Pending verification"; "Active until" only shows while live.
 * WHY:   "Ownership verified" is DERIVED from status, not stored — a wrong
 *        derivation would either claim verification a post doesn't have or hide
 *        it on one that does.
 * LINKS: src/features/vehicles/components/TrustBlock.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { TrustBlock } from './TrustBlock';

describe('TrustBlock', () => {
  it('active post: verified, posted, and active-until', async () => {
    const { getByText, queryByText } = await render(
      <TrustBlock
        status="active"
        createdAt="2026-07-08T12:00:00Z"
        expiresAt="2026-10-08T12:00:00Z"
      />,
    );
    expect(getByText('Ownership verified')).toBeTruthy();
    expect(getByText(/^Posted /)).toBeTruthy();
    expect(getByText(/^Active until /)).toBeTruthy();
    expect(queryByText('Pending verification')).toBeNull();
  });

  it("owner's own pending post: pending verification, no active-until", async () => {
    const { getByText, queryByText } = await render(
      <TrustBlock status="pending_verification" createdAt="2026-07-08T12:00:00Z" />,
    );
    expect(getByText('Pending verification')).toBeTruthy();
    expect(queryByText('Ownership verified')).toBeNull();
    expect(queryByText(/Active until/)).toBeNull();
  });

  it('recovered post: verified, but no active-until (not live)', async () => {
    const { getByText, queryByText } = await render(
      <TrustBlock
        status="recovered"
        createdAt="2026-07-08T12:00:00Z"
        expiresAt="2026-10-08T12:00:00Z"
      />,
    );
    expect(getByText('Ownership verified')).toBeTruthy();
    expect(queryByText(/Active until/)).toBeNull();
  });

  it("owner's own draft: pending, not verified", async () => {
    const { getByText, queryByText } = await render(
      <TrustBlock status="draft" createdAt="2026-07-08T12:00:00Z" />,
    );
    expect(getByText('Pending verification')).toBeTruthy();
    expect(queryByText('Ownership verified')).toBeNull();
  });

  it('rejected post: neither verified nor pending (never passed)', async () => {
    const { queryByText, getByText } = await render(
      <TrustBlock status="rejected" createdAt="2026-07-08T12:00:00Z" />,
    );
    expect(queryByText('Ownership verified')).toBeNull();
    expect(queryByText('Pending verification')).toBeNull();
    expect(getByText(/^Posted /)).toBeTruthy();
  });

  it('cancelled post: no verification claim (may have been cancelled while pending)', async () => {
    const { queryByText } = await render(
      <TrustBlock status="cancelled" createdAt="2026-07-08T12:00:00Z" />,
    );
    expect(queryByText('Ownership verified')).toBeNull();
    expect(queryByText('Pending verification')).toBeNull();
  });
});
