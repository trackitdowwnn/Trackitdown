/**
 * WHAT:  Tests for PostDetailBody — sections appear only when they have data
 *        ("What to look for" with any of its three pieces, theft details,
 *        guided descriptions, owner's note, last-seen map), the sighting-
 *        activity line stays HIDDEN while the aggregate is zero (dormant), the
 *        SafetyNotice is always present, and the report row fires its callback.
 * WHY:   The conditional gating is the section's contract; the sighting gate
 *        is also SAFETY — the aggregate line must not appear (nor could leak)
 *        until the sightings feature lights it up. Old posts missing newer
 *        structured fields must render gracefully, never as empty shells.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

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
  viewerHasSighting: false,
};

const renderBody = (
  post: PostDetail,
  onReport: () => void = () => {},
  onMessageOwner: (() => void) | undefined = () => {},
) =>
  render(
    <PostDetailBody
      post={post}
      onOpenMap={() => {}}
      onReport={onReport}
      onMessageOwner={post.isOwner ? undefined : onMessageOwner}
    />,
  );

describe('PostDetailBody', () => {
  it('omits "What to look for" when there is no body type, features, or spot-it text', async () => {
    const { queryByText, getByText } = await renderBody(base);
    expect(queryByText('What to look for')).toBeNull();
    // The identity line still carries the colour.
    expect(getByText(/Blue/)).toBeTruthy();
  });

  it('shows "What to look for" with body type + distinguishing features', async () => {
    const { getByText } = await renderBody({
      ...base,
      bodyType: 'Saloon',
      distinguishingFeatures: 'Dented door',
    });
    expect(getByText('What to look for')).toBeTruthy();
    expect(getByText('Saloon')).toBeTruthy();
    expect(getByText('Dented door')).toBeTruthy();
  });

  it('shows "What to look for" with structured features alone (old-post grace)', async () => {
    const { getByText } = await renderBody({
      ...base,
      features: [{ key: 'tow_bar', label: 'Tow bar', icon: 'link' }],
    });
    expect(getByText('What to look for')).toBeTruthy();
    expect(getByText('Tow bar')).toBeTruthy();
  });

  it('shows "What to look for" with the spot-it prose alone', async () => {
    const { getByText } = await renderBody({ ...base, descRecognise: 'A dent on the rear door.' });
    expect(getByText('What to look for')).toBeTruthy();
    expect(getByText('A dent on the rear door.')).toBeTruthy();
  });

  it('shows the owner note only when present (and no guided descriptions)', async () => {
    const { queryByText } = await renderBody(base);
    expect(queryByText("Owner's note")).toBeNull();

    const { getByText } = await renderBody({ ...base, ownerNote: 'Please help find it.' });
    expect(getByText("Owner's note")).toBeTruthy();
    expect(getByText('Please help find it.')).toBeTruthy();
  });

  it('keeps the sighting-activity line HIDDEN while the aggregate is zero (dormant)', async () => {
    const { queryByText } = await renderBody(base);
    expect(queryByText(/sightings? reported/)).toBeNull();
    expect(queryByText('Sighting activity')).toBeNull();
  });

  it('shows the aggregate line (count only) once sightings exist', async () => {
    const { getByText, queryByText } = await renderBody({
      ...base,
      sightingCount: 3,
      latestSightingAt: '2026-07-11T09:00:00Z',
    });
    expect(getByText(/3 sightings reported/)).toBeTruthy();
    // SAFETY: the aggregate is ALL a non-owner ever sees — no locations.
    expect(queryByText(/Camden.*sighting/i)).toBeNull();
  });

  it('always renders the SafetyNotice', async () => {
    const { getByText } = await renderBody(base);
    expect(getByText(/Never approach the vehicle/)).toBeTruthy();
  });

  it('shows theft details, "How it drives", and the spot-it prose when present', async () => {
    const { getByText } = await renderBody({
      ...base,
      stolenFrom: 'driveway',
      keysTaken: 'yes',
      descRecognise: 'A dent on the rear door.',
      descDrives: 'Pulls left when braking.',
    });
    expect(getByText('Theft details')).toBeTruthy();
    expect(getByText('Stolen from a driveway')).toBeTruthy();
    expect(getByText('Keys were taken with the car')).toBeTruthy();
    expect(getByText('How it drives')).toBeTruthy();
    expect(getByText('Pulls left when braking.')).toBeTruthy();
    expect(getByText('A dent on the rear door.')).toBeTruthy();
  });

  it('renders the underlined report row and fires onReport', async () => {
    const onReport = jest.fn();
    const { getByText } = await renderBody(base, onReport);
    fireEvent.press(getByText('Report this post'));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  describe('message the owner (sighting-gated)', () => {
    it('spotter WITHOUT a sighting: a quiet report link + honest gate copy (no 2nd button)', async () => {
      const { getByText } = await renderBody(base);
      expect(getByText(/Reporting a sighting opens a private/)).toBeTruthy();
      expect(getByText('Report a sighting')).toBeTruthy();
    });

    it('spotter WITH a sighting: the CTA opens the conversation', async () => {
      const { getByText, queryByText } = await renderBody({ ...base, viewerHasSighting: true });
      expect(getByText('Message the owner')).toBeTruthy();
      expect(getByText(/Chat privately with the owner/)).toBeTruthy();
      expect(queryByText('Report a sighting')).toBeNull();
    });

    it('fires onMessageOwner when tapped', async () => {
      const onMessageOwner = jest.fn();
      const { getByText } = await renderBody(
        { ...base, viewerHasSighting: true },
        () => {},
        onMessageOwner,
      );
      fireEvent.press(getByText('Message the owner'));
      expect(onMessageOwner).toHaveBeenCalledTimes(1);
    });

    it('is HIDDEN for the owner (they reach spotters via their sightings list)', async () => {
      const { queryByText } = await renderBody({ ...base, isOwner: true });
      expect(queryByText('Message the owner')).toBeNull();
      expect(queryByText(/Reporting a sighting opens/)).toBeNull();
    });
  });
});
