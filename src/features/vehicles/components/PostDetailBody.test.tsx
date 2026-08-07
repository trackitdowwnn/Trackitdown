/**
 * WHAT:  Tests for PostDetailBody — "About this car" always renders (honest
 *        placeholder when prose-less, clamp + Show more when not), "Car
 *        details" lists EVERY fact in-page with muted "Not provided" gap rows
 *        at the end (no Show-all tap), the sighting-activity line
 *        stays HIDDEN while the aggregate is zero (dormant), the SafetyNotice
 *        is always present, the report row fires its callback, and
 *        "Distinctive features" renders one card per mark, truncating past
 *        three behind a "Show all N features" toggle.
 * WHY:   The conditional gating is the section's contract; the sighting
 *        section's face split is also SAFETY — the body must hand the
 *        sightings feature the correct isOwner, because that flag decides
 *        which RPC (rich vs restrained) is called (ADR-0008). Old posts
 *        missing newer structured fields must render gracefully, never as
 *        empty shells.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostDetail } from '../types';
import { PostDetailBody } from './PostDetailBody';

// The map SDK can't render under jest — stub the leaf used by LastSeenMap.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

// The rail's bookmark toggle drags in the watchlist store/supabase — stub it.
jest.mock('@/features/watchlist', () => ({ WatchToggle: () => null }));

// The sighting-activity section owns its own data fetching (both faces hit
// supabase) — stub the whole feature barrel; the section has its own tests.
// The spy pins that the body hands it the right face split (id + isOwner).
const mockSightingsSection = jest.fn((_props: unknown) => null);
jest.mock('@/features/sightings', () => ({
  PostSightingsSection: (props: unknown) => mockSightingsSection(props),
}));

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
    onDeactivate?: () => void;
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
      onDeactivate={handlers.onDeactivate}
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

  it('shows the deactivate trigger and REQUESTS (never runs) deactivation', async () => {
    const onDeactivate = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderBody(
      { ...base, isOwner: true, status: 'active' },
      { onDeactivate },
    );
    expect(getByTestId('deactivate-listing')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Deactivate & refund'));
    });
    // The button asks the SCREEN to open its confirm — the destructive dialog
    // is owned there (shared with the "Manage post" sheet), not here.
    expect(onDeactivate).toHaveBeenCalled();
    expect(queryByText('Yes, deactivate')).toBeNull();
  });

  it('hides the deactivate control when onDeactivate is absent (spotter / draft)', async () => {
    const { queryByTestId } = await renderBody({ ...base, status: 'active' });
    expect(queryByTestId('deactivate-listing')).toBeNull();
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

  it('mounts the sightings section with the post id and the viewer face', async () => {
    // The timeline superseded the old aggregate line; the FACE SPLIT (owner
    // vs public depth) is the sightings feature's contract — the body's job
    // is only to pass the split correctly. SAFETY: isOwner here is what
    // decides which RPC the section calls (ADR-0008).
    mockSightingsSection.mockClear();
    await renderBody({ ...base, isOwner: false });
    expect(mockSightingsSection).toHaveBeenCalledWith(
      expect.objectContaining({ postId: 'p1', isOwner: false }),
    );

    mockSightingsSection.mockClear();
    await renderBody({ ...base, isOwner: true });
    expect(mockSightingsSection).toHaveBeenCalledWith(
      expect.objectContaining({ postId: 'p1', isOwner: true }),
    );
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

describe('owner per-section edit pencils', () => {
  it('shows no edit pencils when no edit callbacks are passed (spotter view)', async () => {
    const { queryByTestId } = await renderBody(base);
    expect(queryByTestId('edit-car-details')).toBeNull();
    expect(queryByTestId('edit-bounty')).toBeNull();
    expect(queryByTestId('edit-theft-context')).toBeNull();
    expect(queryByTestId('edit-distinctive-features')).toBeNull();
  });

  it('shows a pencil per passed callback and renders the safe sections even when empty', async () => {
    const { getByTestId } = await render(
      <PostDetailBody
        post={{ ...base, isOwner: true, status: 'draft' }}
        onOpenMap={() => {}}
        onReport={() => {}}
        onShowAbout={() => {}}
        similarPosts={[]}
        similarLoading={false}
        onOpenPost={() => {}}
        onEditCarDetails={() => {}}
        onEditBounty={() => {}}
        onEditTheftContext={() => {}}
        onEditDistinctiveFeatures={() => {}}
      />,
    );
    expect(getByTestId('edit-car-details')).toBeTruthy();
    expect(getByTestId('edit-bounty')).toBeTruthy();
    // Theft + marks sections render for the owner even with no data yet.
    expect(getByTestId('edit-theft-context')).toBeTruthy();
    expect(getByTestId('edit-distinctive-features')).toBeTruthy();
  });
});

describe('distinctive features', () => {
  const mark = (n: number) => ({
    photoUrl: `https://cdn.example/mark-${n}.jpg`,
    description: `Mark ${n}`,
  });

  // Each card is ONE accessible object labelled from its description, so
  // counting the labels counts the rendered cards.
  const CARD_LABEL = /^Distinctive feature: /;

  it('renders one card per feature, each a single labelled object', async () => {
    const { getByText, getAllByLabelText, queryByText } = await renderBody({
      ...base,
      distinctiveFeatures: [mark(1), mark(2)],
    });
    expect(getByText('Distinctive features')).toBeTruthy();
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(2);
    expect(getByText('Mark 1')).toBeTruthy();
    expect(getByText('Mark 2')).toBeTruthy();
    // At or below the preview count the list is never collapsed.
    expect(queryByText(/^Show all/)).toBeNull();
  });

  it('collapses past the third card behind a "Show all N features" button', async () => {
    const { getByText, getAllByLabelText, queryByText } = await renderBody({
      ...base,
      distinctiveFeatures: [mark(1), mark(2), mark(3), mark(4), mark(5)],
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(3);
    expect(getByText('Mark 3')).toBeTruthy();
    expect(queryByText('Mark 4')).toBeNull();
    expect(queryByText('Mark 5')).toBeNull();
    expect(getByText('Show all 5 features')).toBeTruthy();
  });

  it('reveals every card when the show-all button is pressed, then collapses again', async () => {
    const { getByText, getAllByLabelText, queryByText } = await renderBody({
      ...base,
      distinctiveFeatures: [mark(1), mark(2), mark(3), mark(4), mark(5)],
    });

    await act(async () => {
      fireEvent.press(getByText('Show all 5 features'));
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(5);
    expect(getByText('Mark 5')).toBeTruthy();
    expect(getByText('Show fewer features')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Show fewer features'));
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(3);
    expect(queryByText('Mark 4')).toBeNull();
    expect(getByText('Show all 5 features')).toBeTruthy();
  });

  it('shows every card and no button at the preview count', async () => {
    const { getAllByLabelText, queryByText } = await renderBody({
      ...base,
      distinctiveFeatures: [mark(1), mark(2), mark(3)],
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(3);
    expect(queryByText(/^Show all/)).toBeNull();
  });

  // N=4 is the case where the button hides exactly one card — the threshold's
  // least flattering shape, and the one most likely to be regressed away.
  it('still collapses at four features, hiding exactly one', async () => {
    const { getAllByLabelText, getByText } = await renderBody({
      ...base,
      distinctiveFeatures: [mark(1), mark(2), mark(3), mark(4)],
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(3);
    expect(getByText('Show all 4 features')).toBeTruthy();
  });

  // Context-v2 payloads carry a stable row id (the handle a sighting's
  // confirmed_feature_ids references); older cached ones don't. Both key paths
  // must render, and marks sharing a photo must not collide.
  it('renders marks with and without stable ids, including a shared photo', async () => {
    const { getAllByLabelText } = await renderBody({
      ...base,
      distinctiveFeatures: [
        { id: 'f1', photoUrl: 'https://cdn.example/same.jpg', description: 'Mark 1' },
        { id: 'f2', photoUrl: 'https://cdn.example/same.jpg', description: 'Mark 2' },
        mark(3),
      ],
    });
    expect(getAllByLabelText(CARD_LABEL)).toHaveLength(3);
  });
});
