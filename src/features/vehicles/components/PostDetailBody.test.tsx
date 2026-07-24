/**
 * WHAT:  Tests for PostDetailBody — "About this car" always renders (honest
 *        placeholder when prose-less, clamp + Show more when not), "Car
 *        details" lists EVERY fact in-page with muted "Not provided" gap rows
 *        at the end (no Show-all tap), the sighting-activity line
 *        stays HIDDEN while the aggregate is zero (dormant), the SafetyNotice
 *        is always present, and the report row fires its callback.
 * WHY:   The conditional gating is the section's contract; the sighting gate
 *        is also SAFETY — the aggregate line must not appear (nor could leak)
 *        until the sightings feature lights it up. Old posts missing newer
 *        structured fields must render gracefully, never as empty shells.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostDetail } from '../types';
import { PostDetailBody } from './PostDetailBody';

// The map SDK can't render under jest — stub the leaf used by LastSeenMap.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

// The rail's bookmark toggle drags in the watchlist store/supabase — stub it.
jest.mock('@/features/watchlist', () => ({ WatchToggle: () => null }));

// ConfirmDialog (the bounty ⓘ popup) rides the bottom-sheet + safe-area
// stack — same mocks PostDetailScreen.test uses.
jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'));
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

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
  distinctiveFeatures: [],
  sightingCount: 0,
  viewerHasSighting: false,
};

const renderBody = (
  post: PostDetail,
  handlers: {
    onReport?: () => void;
    onMessageOwner?: () => void;
    onShowAbout?: () => void;
    onOpenPost?: (target: unknown) => void;
    similarPosts?: import('@/shared/types').PostSummary[];
    similarLoading?: boolean;
  } = {},
) =>
  render(
    <PostDetailBody
      post={post}
      onOpenMap={() => {}}
      onReport={handlers.onReport ?? (() => {})}
      onMessageOwner={post.isOwner ? undefined : (handlers.onMessageOwner ?? (() => {}))}
      onShowAbout={handlers.onShowAbout ?? (() => {})}
      similarPosts={handlers.similarPosts ?? []}
      similarLoading={handlers.similarLoading ?? false}
      onOpenPost={handlers.onOpenPost ?? (() => {})}
    />,
  );

describe('PostDetailBody', () => {
  it('shows "About this car" with an honest placeholder (no Show more) when prose-less', async () => {
    const { queryByText, getByText } = await renderBody(base);
    expect(getByText('About this car')).toBeTruthy();
    expect(getByText("The owner hasn't added a description yet.")).toBeTruthy();
    expect(queryByText('Show more')).toBeNull();
  });

  it('shows "About this car" with the spot-it prose and fires onShowAbout', async () => {
    const onShowAbout = jest.fn();
    const { getByText } = await renderBody(
      { ...base, descRecognise: 'A dent on the rear door.' },
      { onShowAbout },
    );
    expect(getByText('About this car')).toBeTruthy();
    expect(getByText('A dent on the rear door.')).toBeTruthy();
    fireEvent.press(getByText('Show more'));
    expect(onShowAbout).toHaveBeenCalledTimes(1);
  });

  it('falls back to the legacy owner note as the About preview (old-post grace)', async () => {
    const { getByText } = await renderBody({ ...base, ownerNote: 'Please help find it.' });
    expect(getByText('About this car')).toBeTruthy();
    expect(getByText('Please help find it.')).toBeTruthy();
  });

  it('always shows "Car details" with the identity facts', async () => {
    const { getByText } = await renderBody(base);
    expect(getByText('Car details')).toBeTruthy();
    expect(getByText('Colour: Blue')).toBeTruthy();
    expect(getByText('Plate: AB12 CDE')).toBeTruthy();
  });

  it('lists body type, structured features, and distinguishing marks as detail rows', async () => {
    const { getByText } = await renderBody({
      ...base,
      bodyType: 'Saloon',
      distinguishingFeatures: 'Dented door',
      features: [{ key: 'tow_bar', label: 'Tow bar', icon: 'link' }],
    });
    expect(getByText('Body type: Saloon')).toBeTruthy();
    expect(getByText('Tow bar')).toBeTruthy();
    expect(getByText('Dented door')).toBeTruthy();
  });

  it('shows every fact in-page — theft rows AND muted "Not provided" gaps, no Show-all', async () => {
    const { queryByText, getByText } = await renderBody({
      ...base,
      stolenFrom: 'driveway',
      keysTaken: 'yes',
    });
    expect(getByText('Stolen from a driveway')).toBeTruthy();
    expect(getByText('Keys were taken with the car')).toBeTruthy();
    // The gaps (base has no year/body/marks) are stated as struck rows.
    expect(getByText('Year')).toBeTruthy();
    expect(getByText('Body type')).toBeTruthy();
    expect(getByText('Distinguishing marks')).toBeTruthy();
    expect(queryByText(/Show all/)).toBeNull();
  });

  it('renders the owner card with name and this post’s sighting stat', async () => {
    const { getByText } = await renderBody({ ...base, sightingCount: 2 });
    expect(getByText('Alex')).toBeTruthy();
    expect(getByText('Sightings on this post')).toBeTruthy();
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

  it('bounty ⓘ is pressable and carries the explainer dialog (the promise lives there, not inline)', async () => {
    const { getByLabelText, getByText } = await renderBody(base);
    // The bottom-sheet jest mock mounts dialog content eagerly, so this pins
    // presence + pressability rather than open/closed visibility.
    fireEvent.press(getByLabelText('How the bounty works'));
    expect(getByText(/paid to the spotter whose sighting leads/)).toBeTruthy();
    expect(getByText('How the bounty works')).toBeTruthy();
  });

  it('renders the similar-posts rail with cards, and hides it when empty', async () => {
    const onOpenPost = jest.fn();
    const similar = [
      {
        id: 'p2',
        photos: [],
        make: 'Ford',
        model: 'Focus',
        colour: 'Red',
        plate: null,
        status: 'active' as const,
        lastSeenAt: '2026-07-18T10:00:00Z',
        bountyPence: 30000,
      },
    ];
    // With coords the title reads "nearby"; the coordless variant drops it.
    const { getByText, unmount } = await renderBody(
      { ...base, lat: 51.75, lng: -0.34 },
      { similarPosts: similar, onOpenPost },
    );
    expect(getByText('More cars nearby')).toBeTruthy();
    // VehicleCard mounts core-RN Animated views — presses must run inside
    // act (and the render unmount flushed) or LATER tests in this file
    // silently lose elements (docs/TESTING.md; seen again 2026-07-23).
    await act(async () => {
      fireEvent.press(getByText('Ford Focus'));
    });
    expect(onOpenPost).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }));
    await act(async () => {
      unmount();
    });

    const { queryByText } = await renderBody(base);
    expect(queryByText(/More cars/)).toBeNull();
  });

  it('always renders the SafetyNotice', async () => {
    const { getByText } = await renderBody(base);
    expect(getByText(/Never approach the vehicle/)).toBeTruthy();
  });

  it('renders the underlined report row and fires onReport', async () => {
    const onReport = jest.fn();
    const { getByText } = await renderBody(base, { onReport });
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
        { onMessageOwner },
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
