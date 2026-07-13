/**
 * WHAT:  Tests for buildSharePayload — the share text carries colour, make,
 *        model, plate, and area + a URL ending in the post id; the area clause
 *        is dropped when there's no area.
 * WHY:   Shares must identify the CAR (plate + area) and never a spotter; a
 *        test pins the payload so a refactor can't drop the plate or leak a
 *        different field.
 * LINKS: src/features/vehicles/lib/postShare.ts.
 */

import type { PostDetail } from '../types';
import { buildSharePayload } from './postShare';

const base: PostDetail = {
  id: 'abc-123',
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

describe('buildSharePayload', () => {
  it('includes the car identity, plate, area, and a URL ending in the id', () => {
    const { message, url } = buildSharePayload(base);
    expect(message).toContain('Blue BMW 3 Series');
    expect(message).toContain('AB12 CDE');
    expect(message).toContain('near Camden');
    expect(url.endsWith('abc-123')).toBe(true);
    expect(message).toContain(url);
  });

  it('omits the area clause when there is no area', () => {
    const { message } = buildSharePayload({ ...base, lastSeenArea: undefined });
    expect(message).not.toContain('Last seen near');
  });

  it('omits the plate parens for a plate-less car (never shares "(null)")', () => {
    const { message } = buildSharePayload({ ...base, plate: null });
    expect(message).not.toContain('null');
    expect(message).not.toContain('()');
    expect(message).toContain('Blue BMW 3 Series.');
  });
});
