/**
 * WHAT:  Tests for derivePlaceLabels — one geocode, two grains: the owner's
 *        street-first areaLabel and the PUBLIC locality.
 * WHY:   The locality fallback chain deliberately EXCLUDES the street —
 *        that string can end up on an anonymous public timeline entry
 *        (ADR-0008), so "street never leaks into locality" is a fence worth
 *        pinning, not a formatting preference. Best-effort behaviour (no
 *        fix, no result, geocoder throw → nulls) keeps the report flow
 *        unblockable.
 * LINKS: src/features/sightings/lib/areaLabel.ts;
 *        docs/decisions/ADR-0008-public-sighting-entries.md.
 */

import * as Location from 'expo-location';

import type { EvidencePhoto } from '@/shared/ui';
import { deriveAreaLabel, derivePlaceLabels } from './areaLabel';

jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(),
}));

const mockGeocode = Location.reverseGeocodeAsync as jest.Mock;

const locatedPhoto: EvidencePhoto = {
  uri: 'file://p.jpg',
  lat: 51.55,
  lng: -0.11,
  accuracyM: 8,
  capturedAt: '2026-07-29T10:00:00Z',
};

const place = (fields: Record<string, string | null>) => [
  {
    street: null,
    district: null,
    city: null,
    subregion: null,
    ...fields,
  },
];

beforeEach(() => {
  mockGeocode.mockReset();
});

describe('derivePlaceLabels', () => {
  it('derives both grains from one geocode: street-first label, district-first locality', async () => {
    mockGeocode.mockResolvedValue(
      place({ street: 'Camden High Street', district: 'Camden', city: 'London' }),
    );
    const labels = await derivePlaceLabels([locatedPhoto]);

    expect(labels.areaLabel).toBe('Camden High Street, London');
    expect(labels.locality).toBe('Camden');
    expect(mockGeocode).toHaveBeenCalledTimes(1);
  });

  it('SAFETY: the street NEVER falls through into locality', async () => {
    // A geocode that only resolved a street: the owner label may use it,
    // the public grain must rather be nothing at all.
    mockGeocode.mockResolvedValue(place({ street: 'Frognal Lane' }));
    const labels = await derivePlaceLabels([locatedPhoto]);

    expect(labels.areaLabel).toContain('Frognal Lane');
    expect(labels.locality).toBeNull();
  });

  it('falls back city → subregion for locality and caps its length', async () => {
    mockGeocode.mockResolvedValue(place({ city: 'x'.repeat(120) }));
    const labels = await derivePlaceLabels([locatedPhoto]);
    expect(labels.locality).toHaveLength(80);

    mockGeocode.mockResolvedValue(place({ subregion: 'Greater London' }));
    expect((await derivePlaceLabels([locatedPhoto])).locality).toBe('Greater London');
  });

  it('is best-effort: no located photo, empty result, or a throw → both null', async () => {
    const unlocated: EvidencePhoto = { ...locatedPhoto, lat: undefined, lng: undefined };
    expect(await derivePlaceLabels([unlocated])).toEqual({ areaLabel: null, locality: null });
    expect(mockGeocode).not.toHaveBeenCalled();

    mockGeocode.mockResolvedValue([]);
    expect(await derivePlaceLabels([locatedPhoto])).toEqual({ areaLabel: null, locality: null });

    mockGeocode.mockRejectedValue(new Error('geocoder down'));
    expect(await derivePlaceLabels([locatedPhoto])).toEqual({ areaLabel: null, locality: null });
  });
});

describe('deriveAreaLabel (back-compat wrapper)', () => {
  it('returns the owner-facing label only', async () => {
    mockGeocode.mockResolvedValue(place({ district: 'Camden', city: 'London' }));
    expect(await deriveAreaLabel([locatedPhoto])).toBe('Camden, London');
  });
});
