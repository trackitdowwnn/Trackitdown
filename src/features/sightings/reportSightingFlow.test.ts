/**
 * WHAT:  Smoke tests for the report-sighting flow config — the speed shape
 *        (no intro screens, four steps, confirm carries "Send report"), the
 *        photo gating (1–3 evidence photos), the always-passable safety gate,
 *        and the never-blocking context step.
 * WHY:   The wizard framework warns that a typo'd schema key compiles but can
 *        never validate — each flow needs this smoke coverage. The gating IS
 *        product behaviour: a spotter must not advance past photos with zero
 *        shots, and must never be trapped by the optional step.
 * LINKS: src/features/sightings/reportSightingFlow.tsx, docs/TESTING.md.
 */

import { flattenFlow } from '@/shared/wizard';

import {
  REPORT_SIGHTING_INITIAL_ANSWERS,
  reportSightingFlow,
} from './reportSightingFlow';

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

describe('reportSightingFlow shape', () => {
  it('is one intro-less phase of four steps ending in Send report', () => {
    const screens = flattenFlow(reportSightingFlow);
    expect(screens.map((screen) => screen.kind)).toEqual(['step', 'step', 'step', 'step']);
    expect(steps.map((step) => step.id)).toEqual(['safety', 'photos', 'context', 'confirm']);
    expect(reportSightingFlow.finalCtaLabel).toBe('Send report');
  });

  it('safety gate passes immediately (read, not input)', () => {
    expect(schemaFor('safety').safeParse(REPORT_SIGHTING_INITIAL_ANSWERS).success).toBe(true);
  });

  it('photos step blocks at zero and above three, passes 1–3', () => {
    const schema = schemaFor('photos');
    expect(schema.safeParse({ photos: [] }).success).toBe(false);
    expect(schema.safeParse({ photos: [photo] }).success).toBe(true);
    expect(schema.safeParse({ photos: [photo, photo, photo] }).success).toBe(true);
    expect(schema.safeParse({ photos: [photo, photo, photo, photo] }).success).toBe(false);
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

  it('confirm re-asserts the photo rule so an invalidated edit cannot send', () => {
    expect(schemaFor('confirm').safeParse({ photos: [] }).success).toBe(false);
    expect(schemaFor('confirm').safeParse({ photos: [photo] }).success).toBe(true);
  });
});
