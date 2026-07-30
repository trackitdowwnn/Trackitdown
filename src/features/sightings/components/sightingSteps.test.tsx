/**
 * WHAT:  Tests for the rebuilt PhotosStep (camera-as-the-step) and the
 *        ConfirmStep's provenance badges — the location primer paths
 *        (allow / continue-without / OS-blocked never blocks), the in-step
 *        viewfinder, the ADR-0003 gallery button beside the shutter
 *        (launch options, gallery photos flagged source:'gallery' and NEVER
 *        location-bearing, canceled pick is a no-op, remaining-slot
 *        selectionLimit), the requirement-line copy variants, and the
 *        "Library" badge on the confirm grid. Plus the safety gate's
 *        one-tap 999 path.
 * WHY:   The photo step is where the anti-fraud evidence is born (DOMAIN
 *        sighting rules / ADR-0003) — a wiring slip here either strands a
 *        spotter (camera never mounts after the primer) or corrupts evidence
 *        (a library photo arriving located, or unlabelled as 'gallery',
 *        would masquerade as a live capture). CameraCapture's own capture
 *        contract is pinned in CameraCapture.test.tsx; this file proves the
 *        STEP composes it — primer first, gallery path OUTSIDE the camera,
 *        provenance surfaced honestly at review.
 * LINKS: src/features/sightings/components/sightingSteps.tsx;
 *        src/shared/ui/CameraCapture.tsx (shutterAccessory slot);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Linking } from 'react-native';

import type { EvidencePhoto } from '@/shared/ui';

import type { ReportSightingAnswers } from '../types';
import { ConfirmStep, PhotosStep, SafetyStep, SIGHTING_LOCATION_PRIMER } from './sightingSteps';

const mockTakePicture = jest.fn();
jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    CameraView: forwardRef((_props: object, ref: unknown) => {
      useImperativeHandle(ref as never, () => ({ takePictureAsync: mockTakePicture }));
      return null;
    }),
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
  };
});

const mockGetForegroundPermissions = jest.fn();
const mockRequestForegroundPermissions = jest.fn();
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: (...args: unknown[]) => mockGetForegroundPermissions(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissions(...args),
  getCurrentPositionAsync: jest
    .fn()
    .mockResolvedValue({ coords: { latitude: 53.48, longitude: -2.24, accuracy: 8 } }),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

// Load-boundary mocks: importing sightingSteps pulls the WHOLE @/shared/ui
// barrel in (grid, gestures, manipulator) even though the rebuilt step
// renders none of it. The global reanimated mock (moduleNameMapper) covers
// FadeIn/ReduceMotion — no custom mock here.
jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of [
      'enabled',
      'activateAfterLongPress',
      'onStart',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ]) {
      gesture[method] = () => gesture;
    }
    return gesture;
  };
  return {
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

/** The gallery pipeline — the ONE library path, owned by the step (ADR-0003). */
const mockLaunchLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

/** Requirement-line copy variants — pinned word-for-word (they state the
 *  ADR-0003 rule to the spotter). */
const NEEDS_LIVE_LINE = 'One photo taken here is required — library photos are welcome extras.';
const ROOM_LEFT_LINE = 'Add up to 3 — from the camera or your library.';
const FULL_SET_LINE = 'That’s the full set of 3.';

/** The answers bag after the last user interaction — what the wizard would
 *  submit. Written by the harness's setAnswers wrapper only. */
let latest: Partial<ReportSightingAnswers> = {};

/** Drives PhotosStep the way the wizard does: one controlled answers bag. */
function Harness({ initial }: { initial: Partial<ReportSightingAnswers> }) {
  const [answers, setAnswers] = useState<Partial<ReportSightingAnswers>>(initial);
  const applyPatch = (patch: Partial<ReportSightingAnswers>) => {
    setAnswers((current) => {
      latest = { ...current, ...patch };
      return latest;
    });
  };
  return <PhotosStep answers={answers} setAnswers={applyPatch} />;
}

const liveEvidence = (n: number): EvidencePhoto => ({
  uri: `file:///evidence-${n}.jpg`,
  capturedAt: `2026-07-15T10:0${n}:00Z`,
  lat: 53.48,
  lng: -2.24,
  accuracyM: 10,
  source: 'live',
});

const galleryEvidence = (n: number): EvidencePhoto => ({
  uri: `file:///library-${n}.jpg`,
  capturedAt: `2026-07-15T11:0${n}:00Z`,
  source: 'gallery',
});

async function renderStep(initial: Partial<ReportSightingAnswers>) {
  let view!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    view = await render(<Harness initial={initial} />);
  });
  return view;
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

beforeEach(() => {
  latest = {};
  jest.clearAllMocks();
  mockTakePicture.mockResolvedValue({ uri: 'file:///shot.jpg', width: 1600, height: 1200 });
  mockGetForegroundPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestForegroundPermissions.mockResolvedValue({ granted: true, canAskAgain: true });
  mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });
});

describe('SafetyStep', () => {
  it('offers the one-tap 999 path (tel:999) alongside the notice', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<SafetyStep answers={{}} setAnswers={() => {}} />);
    });
    await press(view.getByLabelText('Call 999'));
    expect(openURL).toHaveBeenCalledWith('tel:999');
    openURL.mockRestore();
  });
});

describe('PhotosStep — location primer', () => {
  it('primes location BEFORE the camera when it can still ask, with the pinned copy', async () => {
    mockGetForegroundPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    const { getByText, queryByLabelText } = await renderStep({ photos: [] });

    // The primer copy word-for-word — reassurance verified against
    // SECURITY_AND_TRUST ("only at this moment, never in the background").
    expect(getByText(SIGHTING_LOCATION_PRIMER.headline)).toBeTruthy();
    expect(getByText(SIGHTING_LOCATION_PRIMER.body)).toBeTruthy();
    expect(SIGHTING_LOCATION_PRIMER.body).toContain(
      'used only at this moment, never in the background',
    );
    expect(getByText('Allow location')).toBeTruthy();
    expect(getByText('Continue without location')).toBeTruthy();
    // The camera waits behind the primer.
    expect(queryByLabelText('Take photo')).toBeNull();
  });

  it('Allow location fires the OS request and then lands in the viewfinder', async () => {
    mockGetForegroundPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    const { getByText, getByLabelText } = await renderStep({ photos: [] });
    await press(getByText('Allow location'));
    expect(mockRequestForegroundPermissions).toHaveBeenCalled();
    expect(getByLabelText('Take photo')).toBeTruthy();
  });

  it('Continue without location skips the OS prompt — the report is simply un-located', async () => {
    mockGetForegroundPermissions.mockResolvedValue({ granted: false, canAskAgain: true });
    const { getByText, getByLabelText } = await renderStep({ photos: [] });
    await press(getByText('Continue without location'));
    expect(mockRequestForegroundPermissions).not.toHaveBeenCalled();
    expect(getByLabelText('Take photo')).toBeTruthy();
  });

  it('an OS-blocked location (canAskAgain=false) never blocks — straight to the camera', async () => {
    mockGetForegroundPermissions.mockResolvedValue({ granted: false, canAskAgain: false });
    const { getByLabelText, queryByText } = await renderStep({ photos: [] });
    expect(queryByText(SIGHTING_LOCATION_PRIMER.headline)).toBeNull();
    expect(getByLabelText('Take photo')).toBeTruthy();
  });
});

describe('PhotosStep — the camera IS the step', () => {
  it('mounts the viewfinder in-step (no modal hand-off) when location is settled', async () => {
    const { getByLabelText, queryByText } = await renderStep({ photos: [] });
    expect(getByLabelText('Take photo')).toBeTruthy();
    // No primer, no "Done" hand-off — the camera simply lives here.
    expect(queryByText(SIGHTING_LOCATION_PRIMER.headline)).toBeNull();
    expect(queryByText('Done')).toBeNull();
  });

  it('a shutter press lands a LIVE evidence bundle in the answers (photo + fix + moment)', async () => {
    const { getByLabelText } = await renderStep({ photos: [] });
    await press(getByLabelText('Take photo'));

    expect(latest.photos).toHaveLength(1);
    const photo = latest.photos![0];
    expect(photo.uri).toBe('file:///shot.jpg');
    expect(photo.source).toBe('live');
    expect(photo.capturedAt).toEqual(expect.any(String));
    expect(photo.lat).toBe(53.48);
    expect(photo.lng).toBe(-2.24);
  });
});

describe('PhotosStep — the gallery button (ADR-0003 supplementary photos)', () => {
  it('sits beside the shutter and launches the library scoped to images and the remaining slots', async () => {
    const { getByLabelText } = await renderStep({ photos: [] });
    await press(getByLabelText('Add from photo library'));

    expect(mockLaunchLibrary).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 3,
      exif: false,
    });
  });

  it('picked assets land as source:gallery photos with NO coordinates, added at this moment', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///lib-1.jpg', width: 1200, height: 900 }],
    });
    const { getByLabelText } = await renderStep({ photos: [] });
    await press(getByLabelText('Add from photo library'));

    expect(latest.photos).toHaveLength(1);
    const photo = latest.photos![0];
    expect(photo.source).toBe('gallery');
    expect(photo.uri).toBe('file:///lib-1.jpg');
    expect(photo.capturedAt).toEqual(expect.any(String));
    // NEVER location-bearing — a library photo's EXIF is not evidence.
    expect(photo.lat).toBeUndefined();
    expect(photo.lng).toBeUndefined();
    expect(photo.accuracyM).toBeUndefined();
    // The camera's thumbnail rail labels its provenance immediately.
    expect(getByLabelText('Remove photo 1 (from photo library)')).toBeTruthy();
  });

  it('a canceled pick changes nothing', async () => {
    mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: [] });
    const { getByLabelText, getByText } = await renderStep({ photos: [] });
    await press(getByLabelText('Add from photo library'));

    expect(latest.photos).toBeUndefined(); // setAnswers never ran
    expect(getByText(NEEDS_LIVE_LINE)).toBeTruthy(); // step simply stays put
  });

  it('scopes selectionLimit to the remaining slots and drops any excess assets', async () => {
    // Two of three slots taken → the picker is asked for at most ONE…
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///lib-1.jpg', width: 100, height: 100 },
        { uri: 'file:///lib-2.jpg', width: 100, height: 100 },
      ],
    });
    const { getByLabelText } = await renderStep({ photos: [liveEvidence(0), liveEvidence(1)] });
    await press(getByLabelText('Add from photo library'));

    expect(mockLaunchLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ selectionLimit: 1 }),
    );
    // …and even an over-delivering picker cannot push past the max of 3.
    expect(latest.photos).toHaveLength(3);
    expect(latest.photos![2].uri).toBe('file:///lib-1.jpg');
  });

  it('reads "Photo limit reached" and stays inert at the full set of 3', async () => {
    const { getAllByLabelText, queryByLabelText } = await renderStep({
      photos: [liveEvidence(0), liveEvidence(1), liveEvidence(2)],
    });
    expect(queryByLabelText('Add from photo library')).toBeNull();
    // Both the gallery button AND the shutter wear the limit label; neither acts.
    const limited = getAllByLabelText('Photo limit reached');
    expect(limited).toHaveLength(2);
    for (const control of limited) {
      await press(control);
    }
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
    expect(mockTakePicture).not.toHaveBeenCalled();
  });
});

describe('PhotosStep — the requirement line', () => {
  it('states the one rule while no LIVE photo exists — even when gallery photos do', async () => {
    const empty = await renderStep({ photos: [] });
    expect(empty.getByText(NEEDS_LIVE_LINE)).toBeTruthy();
    await empty.unmount(); // async in this RNTL — un-awaited it poisons later renders

    // A gallery photo alone does NOT satisfy the rule — the line stays.
    const galleryOnly = await renderStep({ photos: [galleryEvidence(0)] });
    expect(galleryOnly.getByText(NEEDS_LIVE_LINE)).toBeTruthy();
  });

  it('invites more photos once a live capture exists, and closes out at the full set', async () => {
    const roomLeft = await renderStep({ photos: [liveEvidence(0)] });
    expect(roomLeft.getByText(ROOM_LEFT_LINE)).toBeTruthy();
    expect(roomLeft.queryByText(NEEDS_LIVE_LINE)).toBeNull();
    await roomLeft.unmount();

    const full = await renderStep({
      photos: [liveEvidence(0), liveEvidence(1), galleryEvidence(2)],
    });
    expect(full.getByText(FULL_SET_LINE)).toBeTruthy();
  });
});

describe('ConfirmStep — provenance badges', () => {
  async function renderConfirm(answers: Partial<ReportSightingAnswers>) {
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<ConfirmStep answers={answers} setAnswers={() => {}} />);
    });
    return view;
  }

  it('badges a gallery photo "Library" — never presented as a live capture', async () => {
    const unlocatedLive: EvidencePhoto = {
      uri: 'file:///live.jpg',
      capturedAt: '2026-07-15T10:00:00Z',
      source: 'live',
    };
    const { getAllByText } = await renderConfirm({
      photos: [unlocatedLive, galleryEvidence(1)],
    });
    // Exactly ONE badge — the live photo carries none.
    expect(getAllByText('Library')).toHaveLength(1);
  });

  it('shows no badge when every photo is a live capture', async () => {
    const { queryByText } = await renderConfirm({ photos: [liveEvidence(0), liveEvidence(1)] });
    expect(queryByText('Library')).toBeNull();
  });
});
