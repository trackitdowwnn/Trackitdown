/**
 * WHAT:  Smoke tests for the report-sighting flow config — the speed shape
 *        (no intro screens, three steps with the camera first, confirm carries
 *        "Send report"), the photo gating (1–3 evidence photos), the
 *        never-blocking context step, and the confirm step's privacy line
 *        (footerNote, pinned word for word). The safety gate is no longer a step
 *        (ReportSafetySheet.test.tsx).
 * WHY:   The wizard framework warns that a typo'd schema key compiles but can
 *        never validate — each flow needs this smoke coverage. The gating IS
 *        product behaviour: a spotter must not advance past photos with zero
 *        shots, and must never be trapped by the optional step.
 * LINKS: src/features/sightings/reportSightingFlow.tsx, docs/TESTING.md.
 */

import { flattenFlow } from '@/shared/wizard';

import { reportSightingFlow } from './reportSightingFlow';

// The flow config imports its step components, which pull native leaves the
// jest environment can't register — stub them (the steps render elsewhere).
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const steps = reportSightingFlow.phases[0].steps;
const schemaFor = (id: string) => {
  const step = steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`missing step ${id}`);
  return step.schema;
};

const photo = { uri: 'file:///a.jpg', capturedAt: '2026-07-14T12:00:00Z' };
const livePhoto = { ...photo, source: 'live' as const };
const galleryPhoto = {
  uri: 'file:///lib.jpg',
  capturedAt: '2026-07-14T12:01:00Z',
  source: 'gallery' as const,
};

describe('reportSightingFlow shape', () => {
  it('is one intro-less phase of three steps, camera first, ending in Send report', () => {
    // The safety gate is ReportSafetySheet, BEFORE the flow, not a step in it.
    const screens = flattenFlow(reportSightingFlow);
    expect(screens.map((screen) => screen.kind)).toEqual(['step', 'step', 'step']);
    expect(steps.map((step) => step.id)).toEqual(['photos', 'context', 'confirm']);
    expect(reportSightingFlow.finalCtaLabel).toBe('Send report');
  });

  it('photos step blocks at zero and above three, passes 1–3', () => {
    const schema = schemaFor('photos');
    expect(schema.safeParse({ photos: [] }).success).toBe(false);
    expect(schema.safeParse({ photos: [photo] }).success).toBe(true);
    expect(schema.safeParse({ photos: [photo, photo, photo] }).success).toBe(true);
    expect(schema.safeParse({ photos: [photo, photo, photo, photo] }).success).toBe(false);
  });

  it('requires at least one LIVE capture — gallery photos alone cannot pass (ADR-0003)', () => {
    const schema = schemaFor('photos');
    expect(schema.safeParse({ photos: [galleryPhoto] }).success).toBe(false);
    expect(schema.safeParse({ photos: [galleryPhoto, galleryPhoto] }).success).toBe(false);
    // One live capture unlocks the step; gallery extras ride along.
    expect(schema.safeParse({ photos: [livePhoto, galleryPhoto] }).success).toBe(true);
    // An absent source means a live in-app capture (CameraCapture's default).
    expect(schema.safeParse({ photos: [photo, galleryPhoto] }).success).toBe(true);
    // The confirm gate re-asserts the same rule — an edit cannot send gallery-only.
    expect(schemaFor('confirm').safeParse({ photos: [galleryPhoto] }).success).toBe(false);
  });

  it('rejects a located gallery photo — a library photo carries no location, ever', () => {
    const schema = schemaFor('photos');
    const locatedGallery = { ...galleryPhoto, lat: 51.5, lng: -0.12 };
    expect(schema.safeParse({ photos: [livePhoto, locatedGallery] }).success).toBe(false);
  });

  it('rejects a half-located photo (lat/lng both-or-neither, like the DB CHECK)', () => {
    const schema = schemaFor('photos');
    expect(schema.safeParse({ photos: [{ ...photo, lat: 51.5 }] }).success).toBe(false);
    expect(schema.safeParse({ photos: [{ ...photo, lng: -0.12 }] }).success).toBe(false);
    expect(schema.safeParse({ photos: [{ ...photo, lat: 51.5, lng: -0.12 }] }).success).toBe(true);
  });

  it('context step passes completely empty (skipping must cost nothing)', () => {
    const schema = schemaFor('context');
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ contextFlags: ['parked'], note: 'heading north' }).success).toBe(true);
  });

  it('context step is one way on: "Skip" while empty, "Continue" once a detail is added', () => {
    const label = steps.find((step) => step.id === 'context')?.ctaLabel;
    if (typeof label !== 'function') throw new Error('context ctaLabel should be a function');
    expect(label({})).toBe('Skip');
    // "Not sure" is not a detail: still a skip.
    expect(label({ contextFlags: [], contextUnsure: ['state'] })).toBe('Skip');
    expect(label({ contextFlags: ['parked'] })).toBe('Continue');
    expect(label({ note: 'By the bins' })).toBe('Continue');
  });

  it('says who sees what above "Send report", word for word', () => {
    // Strictly true (SECURITY_AND_TRUST §1): the public sees that a sighting
    // happened, never the photos, the exact spot or who sent it.
    expect(steps.find((step) => step.id === 'confirm')?.footerNote).toBe(
      'Only the owner sees your photos and the exact spot. They’ll see your first name, not your contact details.',
    );
  });

  it('confirm re-asserts the photo rule so an invalidated edit cannot send', () => {
    expect(schemaFor('confirm').safeParse({ photos: [] }).success).toBe(false);
    expect(schemaFor('confirm').safeParse({ photos: [photo] }).success).toBe(true);
  });
});
