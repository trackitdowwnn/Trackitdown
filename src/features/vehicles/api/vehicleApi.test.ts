/**
 * WHAT:  Tests for fetchPostDetail — the three RPC variants (not-found /
 *        hidden / visible), the snake→camel mapping, and the SAFETY absence
 *        guarantee: the hidden branch surfaces ONLY a closedReason even if the
 *        payload smuggles post details, and no variant exposes owner_id or
 *        individual sightings.
 * WHY:   The RPC gates visibility, but the client is the last line — a shape
 *        drift or a server leak must fail closed here, not render a car's plate
 *        and location to someone who shouldn't see them.
 * LINKS: src/features/vehicles/api/vehicleApi.ts, docs/SECURITY_AND_TRUST.md §6.
 */

import { fetchPostDetail } from './vehicleApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: {
      from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }) }),
    },
  },
}));

const VISIBLE = {
  found: true,
  visible: true,
  id: '11111111-1111-1111-1111-111111111111',
  is_owner: false,
  plate: 'AB12 CDE',
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  bounty_amount_pence: 50000,
  status: 'active',
  last_seen_at: '2026-07-10T18:00:00Z',
  last_seen_area: 'Camden',
  created_at: '2026-07-08T12:00:00Z',
  expires_at: '2026-10-08T12:00:00Z',
  year: 2019,
  body_type: 'Saloon',
  distinguishing_features: 'Dented rear door',
  owner_note: 'Please help me find it.',
  lat: 51.54,
  lng: -0.14,
  photos: [
    { url: 'https://img/2', position: 1 },
    { url: 'https://img/1', position: 0 },
  ],
  owner: { member_since: '2025-01-01T00:00:00Z', first_name: 'Alex' },
  features: [
    { key: 'tow_bar', label: 'Tow bar', icon: 'link' },
    { key: 'dashcam', label: 'Dashcam', icon: 'video' },
  ],
  stolen_from: 'driveway',
  keys_taken: 'yes',
  desc_recognise: 'A dent on the rear door.',
  desc_drives: 'Slight rattle from the exhaust.',
  sighting_stats: { count: 0, latest_at: null },
};

beforeEach(() => mockRpc.mockReset());

describe('fetchPostDetail', () => {
  it('maps a visible post to camelCase (photos → uri, aggregate → count), no owner_id', async () => {
    mockRpc.mockResolvedValue({ data: VISIBLE, error: null });
    const result = await fetchPostDetail('p1');

    expect(result.kind).toBe('visible');
    if (result.kind !== 'visible') throw new Error('expected visible');
    expect(result.post.isOwner).toBe(false);
    expect(result.post.bountyPence).toBe(50000);
    expect(result.post.year).toBe(2019);
    expect(result.post.photos.map((p) => p.uri)).toEqual(['https://img/2', 'https://img/1']);
    expect(result.post.sightingCount).toBe(0);
    expect(result.post.expiresAt).toBe('2026-10-08T12:00:00Z');
    // Owner block maps to first name + member-since (no avatar/owner_id).
    expect(result.post.owner.firstName).toBe('Alex');
    expect(result.post.owner.memberSince).toBe('2025-01-01T00:00:00Z');
    // Part-2 structured data maps.
    expect(result.post.features.map((f) => f.key)).toEqual(['tow_bar', 'dashcam']);
    expect(result.post.stolenFrom).toBe('driveway');
    expect(result.post.keysTaken).toBe('yes');
    expect(result.post.descRecognise).toBe('A dent on the rear door.');
    // The owner's id is never present on the domain object.
    expect(JSON.stringify(result.post)).not.toContain('owner_id');
  });

  it('maps a plate-less post (plate null) without failing the parse', async () => {
    mockRpc.mockResolvedValue({ data: { ...VISIBLE, plate: null }, error: null });
    const result = await fetchPostDetail('p1');

    expect(result.kind).toBe('visible');
    if (result.kind !== 'visible') throw new Error('expected visible');
    expect(result.post.plate).toBeNull();
    expect(result.post.make).toBe('BMW'); // make/model still identify it
  });

  it('an OLD post (no Part-2 data) maps the nullable fields to undefined / []', async () => {
    mockRpc.mockResolvedValue({
      data: {
        ...VISIBLE,
        features: [],
        stolen_from: null,
        keys_taken: null,
        desc_recognise: null,
        desc_drives: null,
      },
      error: null,
    });
    const result = await fetchPostDetail('old');
    if (result.kind !== 'visible') throw new Error('expected visible');
    expect(result.post.features).toEqual([]);
    expect(result.post.stolenFrom).toBeUndefined();
    expect(result.post.keysTaken).toBeUndefined();
    expect(result.post.descRecognise).toBeUndefined();
    expect(result.post.descDrives).toBeUndefined();
  });

  it('an anonymous viewer gets an owner block with no name (member-since only)', async () => {
    mockRpc.mockResolvedValue({
      data: { ...VISIBLE, owner: { member_since: '2025-01-01T00:00:00Z', first_name: null } },
      error: null,
    });
    const result = await fetchPostDetail('p1');
    if (result.kind !== 'visible') throw new Error('expected visible');
    expect(result.post.owner.firstName).toBeUndefined();
    expect(result.post.owner.memberSince).toBe('2025-01-01T00:00:00Z');
  });

  it('returns not-found', async () => {
    mockRpc.mockResolvedValue({ data: { found: false }, error: null });
    expect((await fetchPostDetail('missing')).kind).toBe('notFound');
  });

  it('SAFETY: the hidden branch exposes ONLY closedReason, even if the payload leaks details', async () => {
    // A (hypothetical) server leak: hidden payload carrying post details.
    mockRpc.mockResolvedValue({
      data: {
        found: true,
        visible: false,
        closedReason: 'unavailable',
        make: 'BMW',
        plate: 'AB12 CDE',
        lat: 51.54,
        owner_id: 'owner-uuid',
      },
      error: null,
    });
    const result = await fetchPostDetail('draft');

    expect(result).toEqual({ kind: 'hidden', closedReason: 'unavailable' });
    // Nothing about the car survives the parse.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('BMW');
    expect(serialized).not.toContain('AB12');
    expect(serialized).not.toContain('owner');
  });

  it('throws on a malformed visible payload rather than rendering a half-post', async () => {
    mockRpc.mockResolvedValue({
      data: { found: true, visible: true, id: 'not-a-guid' },
      error: null,
    });
    await expect(fetchPostDetail('bad')).rejects.toThrow();
  });

  it('throws on an RPC error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    await expect(fetchPostDetail('err')).rejects.toThrow();
  });
});
