/**
 * WHAT:  Tests for OwnerCard — the identity gate, the one-line facts, the zero
 *        and new-member states, and that nothing claims verification.
 * WHY:   The identity rules are SAFETY (DOMAIN.md "Owner identity on a post"):
 *        a logged-out viewer must never see a first name. Ownership is NOT
 *        verified (ADR-0007), so the card must never say it is. And the facts
 *        line is date maths on the server's exact shape — the member-since
 *        month as midnight UTC on the 1st — which went a month wrong west of
 *        UTC until it was read in UTC.
 * LINKS: src/features/vehicles/components/OwnerCard.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import type { OwnerSummary } from '../types';
import { OwnerCard } from './OwnerCard';

/** "Now" for every test: mid-September 2026, in UTC. */
const NOW = new Date('2026-09-15T12:00:00Z');

/** The server's shape: date_trunc('month', …) — midnight UTC on the 1st. */
const owner = (firstName: string | null, memberSince: string): OwnerSummary =>
  ({ firstName, memberSince }) as OwnerSummary;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('OwnerCard', () => {
  it('shows a signed-in viewer the first name and one line of facts', async () => {
    const { getByText } = await render(
      <OwnerCard owner={owner('Sarah', '2024-03-01T00:00:00Z')} sightingCount={3} />,
    );

    expect(getByText('Sarah')).toBeTruthy();
    expect(getByText('2 years on Trackitdown · 3 sightings')).toBeTruthy();
  });

  // SAFETY: no name for a logged-out viewer — the server sends none, and the
  // card must say "Car owner" rather than render an empty name.
  it('de-identifies to "Car owner" when there is no first name', async () => {
    const { getByText } = await render(
      <OwnerCard owner={owner(null, '2026-04-01T00:00:00Z')} sightingCount={1} />,
    );

    expect(getByText('Car owner')).toBeTruthy();
    expect(getByText('5 months on Trackitdown · 1 sighting')).toBeTruthy();
  });

  it('treats a whitespace-only first name as no name — never a blank heading', async () => {
    const { getByText } = await render(
      <OwnerCard owner={owner('   ', '2026-04-01T00:00:00Z')} sightingCount={1} />,
    );

    expect(getByText('Car owner')).toBeTruthy();
  });

  // ⚠️ Ownership is not verified (ADR-0007). Every owner was once labelled
  // "Verified owner" — a claim no check backs, on the surface a fake poster
  // would use to look legitimate.
  it.each([['signed in', 'Sarah'], ['logged out', null]])(
    'never claims verification, in print or in speech (%s)',
    async (_face, firstName) => {
      const { queryByText, queryByLabelText } = await render(
        <OwnerCard owner={owner(firstName, '2024-03-01T00:00:00Z')} sightingCount={3} />,
      );
      expect(queryByText(/verified/i)).toBeNull();
      expect(queryByLabelText(/verified/i)).toBeNull();
    },
  );

  it('never prints a bare 0 — a listing nobody has sighted says so', async () => {
    const { getByText, queryByText } = await render(
      <OwnerCard owner={owner('Sarah', '2026-08-01T00:00:00Z')} sightingCount={0} />,
    );

    expect(getByText('1 month on Trackitdown · No sightings yet')).toBeTruthy();
    expect(queryByText(/\b0\b/)).toBeNull();
  });

  // ⚠️ THE TIMEZONE BUG. 2026-09-01T00:00Z is 31 August anywhere west of UTC;
  // read in local time, this member was "1 month" old on the day they joined.
  it('says "New to Trackitdown" in the joining month, whatever the device timezone', async () => {
    const { getByText } = await render(
      <OwnerCard owner={owner('Sarah', '2026-09-01T00:00:00Z')} sightingCount={2} />,
    );

    expect(getByText('New to Trackitdown · 2 sightings')).toBeTruthy();
  });

  it.each([
    ['2024-10-01T00:00:00Z', /^23 months on Trackitdown/],
    ['2024-09-01T00:00:00Z', /^2 years on Trackitdown/],
  ])('counts calendar months until two years, then whole years (%s)', async (since, expected) => {
    const { getByText } = await render(<OwnerCard owner={owner('Sarah', since)} sightingCount={2} />);

    expect(getByText(expected)).toBeTruthy();
  });

  it('reads a future member-since as new, not negative', async () => {
    const { getByText } = await render(
      <OwnerCard owner={owner('Sarah', '2027-01-01T00:00:00Z')} sightingCount={2} />,
    );

    expect(getByText('New to Trackitdown · 2 sightings')).toBeTruthy();
  });

  it('drops the tenure rather than print "NaN months" for an unusable date', async () => {
    const { getByText, queryByText } = await render(
      <OwnerCard owner={owner('Sarah', 'garbage')} sightingCount={2} />,
    );

    expect(getByText('2 sightings')).toBeTruthy();
    expect(queryByText(/NaN/)).toBeNull();
  });

  // Spoken, the count names the car: beside a person, "3 sightings" alone
  // could be heard as the owner's own total.
  it('reads as one stop, and the spoken count is this car\'s', async () => {
    const { getByLabelText } = await render(
      <OwnerCard owner={owner('Sarah', '2024-03-01T00:00:00Z')} sightingCount={3} />,
    );

    expect(getByLabelText('Sarah, 2 years on Trackitdown, 3 sightings of this car')).toBeTruthy();
  });

  it('speaks the zero state for a logged-out viewer too', async () => {
    const { getByLabelText } = await render(
      <OwnerCard owner={owner(null, '2026-09-01T00:00:00Z')} sightingCount={0} />,
    );

    expect(getByLabelText('Car owner, New to Trackitdown, no sightings of this car yet')).toBeTruthy();
  });
});
