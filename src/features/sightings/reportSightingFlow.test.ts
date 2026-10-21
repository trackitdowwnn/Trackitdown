/**
 * WHAT:  Smoke tests for the report-sighting flow config — the speed shape
 *        (no intro screens, the camera first, one context question per step,
 *        confirm carries "Send report"), the photo gating (1–3 evidence
 *        photos), the never-blocking context steps (when each shows, Skip /
 *        Continue, the edit's follow-up), and the confirm step's privacy line
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
import { MAX_NOTE_LENGTH } from './types';

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
  it('is one intro-less phase: camera first, one context question per step, ending in Send report', () => {
    // The safety gate is ReportSafetySheet, BEFORE the flow, not a step in it.
    // The context is one question per step since 2026-10-20 (owner).
    const screens = flattenFlow(reportSightingFlow);
    expect(screens.every((screen) => screen.kind === 'step')).toBe(true);
    expect(steps.map((step) => step.id)).toEqual([
      'photos',
      'state',
      'staying',
      'direction',
      'people',
      'condition',
      'marks',
      'note',
      'confirm',
    ]);
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

  const CONTEXT_STEPS = ['state', 'staying', 'direction', 'people', 'condition', 'marks', 'note'];
  const step = (id: string) => {
    const found = steps.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`missing step ${id}`);
    return found;
  };

  it('every context step is optional and passes completely empty (skipping costs nothing)', () => {
    for (const id of CONTEXT_STEPS) {
      expect(step(id).optional).toBe(true);
      expect(schemaFor(id).safeParse({}).success).toBe(true);
    }
    expect(schemaFor('state').safeParse({ contextFlags: ['parked'] }).success).toBe(true);
    expect(schemaFor('direction').safeParse({ direction: 'NE' }).success).toBe(true);
    expect(
      schemaFor('note').safeParse({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it('the follow-ups and the marks show only when they apply', () => {
    const shown = (id: string, answers: object) => step(id).when?.(answers) ?? true;
    expect(shown('staying', { contextFlags: ['parked'] })).toBe(true);
    expect(shown('staying', { contextFlags: ['driving'] })).toBe(false);
    expect(shown('direction', { contextFlags: ['driving'] })).toBe(true);
    expect(shown('direction', {})).toBe(false);
    expect(shown('marks', { confirmableFeatures: [{ id: 'm1', description: 'Dent' }] })).toBe(true);
    expect(shown('marks', { confirmableFeatures: [] })).toBe(false);
    expect(shown('people', {})).toBe(true);
  });

  it('each step is one way on: "Skip" until answered, then "Continue" — "Not sure" is an answer', () => {
    const label = (id: string, answers: object) => {
      const cta = step(id).ctaLabel;
      if (typeof cta !== 'function') throw new Error(`${id} ctaLabel should be a function`);
      return cta(answers);
    };
    expect(label('state', {})).toBe('Skip');
    expect(label('state', { contextFlags: ['parked'] })).toBe('Continue');
    expect(label('state', { contextUnsure: ['state'] })).toBe('Continue');
    expect(label('people', { peoplePresence: 'nobody' })).toBe('Continue');
    expect(label('condition', { contextFlags: ['parked'] })).toBe('Skip'); // a state isn't a condition
    expect(label('note', { note: '  ' })).toBe('Skip');
    expect(label('note', { note: 'By the bins' })).toBe('Continue');
  });

  it('⚠️ SAFETY: no context step hint asks the spotter to follow, watch or go closer', () => {
    for (const id of CONTEXT_STEPS) {
      expect(step(id).helper ?? '').not.toMatch(
        /follow|watch|track|approach|closer|nearer|check|inspect|wait|meet|get close|go to/i,
      );
    }
  });

  it('an edit of what it was doing continues to its follow-up', () => {
    const onward = step('state').editContinuesTo;
    expect(onward?.({ contextFlags: ['parked'] })).toBe('staying');
    expect(onward?.({ contextFlags: ['driving'] })).toBe('direction');
    expect(onward?.({ contextFlags: ['being_loaded'] })).toBeUndefined();
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
