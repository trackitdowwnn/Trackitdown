/**
 * WHAT:  Tests for buildCarDetailRows — the fixed order (identity → marks →
 *        theft), and the "Not provided" gap logic that decides what a spotter
 *        learns is UNKNOWN about a car.
 * WHY:   The gap logic is a SAFETY-adjacent trust device: a missing row must
 *        appear for every fact the posting flow asks for but the owner
 *        skipped, and never for a fact that is present — a wrong gap either
 *        hides an omission or accuses the owner of one they didn't make.
 * LINKS: src/features/vehicles/lib/carDetails.ts, docs/TESTING.md.
 */

import type { PostDetail } from '../types';
import { buildCarDetailRows } from './carDetails';

const base: PostDetail = {
  id: 'p1',
  isOwner: false,
  status: 'active',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: null,
  bountyPence: 50000,
  lastSeenAt: '2026-07-10T18:00:00Z',
  createdAt: '2026-07-08T12:00:00Z',
  photos: [],
  owner: { memberSince: '2025-01-05T00:00:00Z' },
  features: [],
  distinctiveFeatures: [],
  sightingCount: 0,
  viewerHasSighting: false,
};

describe('buildCarDetailRows', () => {
  it('always includes colour, and lists present facts before gaps', async () => {
    const rows = buildCarDetailRows(base);
    const labels = rows.map((row) => row.label);
    expect(labels[0]).toBe('Colour: Blue');
    // base has no year/plate/body/marks → four "Not provided" gap rows, all last.
    const firstMissing = rows.findIndex((row) => row.missing);
    const lastPresent = rows.map((row) => Boolean(row.missing)).lastIndexOf(false);
    expect(firstMissing).toBeGreaterThan(lastPresent);
  });

  it('names a gap for every fact the flow asks for but the post lacks', async () => {
    const missing = buildCarDetailRows(base)
      .filter((row) => row.missing)
      .map((row) => row.label);
    expect(missing).toEqual(['Plate', 'Year', 'Body type', 'Distinguishing marks']);
  });

  it('treats a "Not sure" body type as unknown — a gap row, not "Body type: Not sure"', async () => {
    const rows = buildCarDetailRows({ ...base, bodyType: 'Not sure' });
    expect(rows.map((row) => row.label)).not.toContain('Body type: Not sure');
    expect(rows.filter((row) => row.missing).map((row) => row.label)).toContain('Body type');
  });

  it('drops a gap once its fact is present, and never marks a present fact missing', async () => {
    const rows = buildCarDetailRows({
      ...base,
      plate: 'AB12 CDE',
      year: 2018,
      bodyType: 'Saloon',
      distinguishingFeatures: 'Dented rear door',
    });
    const missing = rows.filter((row) => row.missing).map((row) => row.label);
    expect(missing).toEqual([]);
    expect(rows.map((row) => row.label)).toEqual(
      expect.arrayContaining(['Plate: AB12 CDE', 'Year: 2018', 'Body type: Saloon', 'Dented rear door']),
    );
  });

  it('treats structured features as distinguishing marks (no marks gap)', async () => {
    const rows = buildCarDetailRows({
      ...base,
      features: [{ key: 'tow_bar', label: 'Tow bar', icon: 'link' }],
    });
    const labels = rows.map((row) => row.label);
    expect(labels).toContain('Tow bar');
    expect(labels).not.toContain('Distinguishing marks'); // gap dropped
  });

  it('no longer includes theft context (moved to its own "How it was taken" section)', async () => {
    const rows = buildCarDetailRows({ ...base, stolenFrom: 'driveway', keysTaken: 'yes' });
    // Theft lines used the `info` icon; they now render in PostDetailBody's
    // dedicated section, not this fact list.
    expect(rows.filter((row) => row.icon === 'info')).toHaveLength(0);
  });
});
