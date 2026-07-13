/**
 * WHAT:  Tests for PostDetailBody — sections appear only when they have data
 *        (Details grid, features grid, theft details, guided descriptions,
 *        owner's note, last-seen map), the sighting-activity line stays HIDDEN
 *        while the aggregate is zero (dormant), and the SafetyNotice is always
 *        present.
 * WHY:   The conditional gating is the section's contract; the sighting gate
 *        is also SAFETY — the aggregate line must not appear (nor could leak)
 *        until the sightings feature lights it up.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import type { PostDetail } from '../types';
import { PostDetailBody } from './PostDetailBody';

// The map SDK can't render under jest — stub the leaf used by LastSeenMap.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

const base: PostDetail = {
  id: 'p1',
  isOwner: false,
  status: 'active',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  bountyPence: 50000,
  lastSeenAt: '2026-07-10T18:00:00Z',
  lastSeenArea: 'Camden',
  createdAt: '2026-07-08T12:00:00Z',
  photos: [],
  owner: { memberSince: '2025-01-05T00:00:00Z', firstName: 'Alex' },
  features: [],
  sightingCount: 0,
};

describe('PostDetailBody', () => {
  it('omits the Details section when there is no body type or features', async () => {
    const { queryByText, getByText } = await render(
      <PostDetailBody post={base} onOpenMap={() => {}} />,
    );
    expect(queryByText('Details')).toBeNull();
    // The identity line still carries the colour.
    expect(getByText(/Blue/)).toBeTruthy();
  });

  it('shows the Details section when body type / features are present', async () => {
    const { getByText } = await render(
      <PostDetailBody
        post={{ ...base, bodyType: 'Saloon', distinguishingFeatures: 'Dented door' }}
        onOpenMap={() => {}}
      />,
    );
    expect(getByText('Details')).toBeTruthy();
    expect(getByText('Saloon')).toBeTruthy();
    expect(getByText('Dented door')).toBeTruthy();
  });

  it('shows the owner note only when present', async () => {
    const { queryByText } = await render(<PostDetailBody post={base} onOpenMap={() => {}} />);
    expect(queryByText("Owner's note")).toBeNull();

    const { getByText } = await render(
      <PostDetailBody post={{ ...base, ownerNote: 'Please help find it.' }} onOpenMap={() => {}} />,
    );
    expect(getByText("Owner's note")).toBeTruthy();
    expect(getByText('Please help find it.')).toBeTruthy();
  });

  it('keeps the sighting-activity line HIDDEN while the aggregate is zero (dormant)', async () => {
    const { queryByText } = await render(<PostDetailBody post={base} onOpenMap={() => {}} />);
    expect(queryByText(/sightings? reported/)).toBeNull();
    expect(queryByText('Sighting activity')).toBeNull();
  });

  it('shows the aggregate line (count only) once sightings exist', async () => {
    const { getByText } = await render(
      <PostDetailBody
        post={{ ...base, sightingCount: 3, latestSightingAt: '2026-07-11T09:00:00Z' }}
        onOpenMap={() => {}}
      />,
    );
    expect(getByText(/3 sightings reported/)).toBeTruthy();
  });

  it('always renders the SafetyNotice', async () => {
    const { getByText } = await render(<PostDetailBody post={base} onOpenMap={() => {}} />);
    expect(getByText(/Never approach the vehicle/)).toBeTruthy();
  });

  it('omits the Features grid when the post has none', async () => {
    const { queryByText } = await render(<PostDetailBody post={base} onOpenMap={() => {}} />);
    expect(queryByText('Features')).toBeNull();
  });

  it('shows the Features grid when the post has features', async () => {
    const { getByText } = await render(
      <PostDetailBody
        post={{ ...base, features: [{ key: 'tow_bar', label: 'Tow bar', icon: 'link' }] }}
        onOpenMap={() => {}}
      />,
    );
    expect(getByText('Features')).toBeTruthy();
    expect(getByText('Tow bar')).toBeTruthy();
  });

  it('shows Theft details and guided descriptions when present', async () => {
    const { getByText } = await render(
      <PostDetailBody
        post={{
          ...base,
          stolenFrom: 'driveway',
          keysTaken: 'yes',
          descRecognise: 'A dent on the rear door.',
        }}
        onOpenMap={() => {}}
      />,
    );
    expect(getByText('Theft details')).toBeTruthy();
    expect(getByText('Stolen from a driveway')).toBeTruthy();
    expect(getByText('Keys were taken with the car')).toBeTruthy();
    expect(getByText('How to spot it')).toBeTruthy();
    expect(getByText('A dent on the rear door.')).toBeTruthy();
  });
});
