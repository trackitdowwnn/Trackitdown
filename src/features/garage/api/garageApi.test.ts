/**
 * WHAT:  Tests for the garage API layer — listMyVehicles maps list_my_vehicles
 *        rows to SavedVehicle (snake→camel, ordered children, the posted flags)
 *        and fails loudly on a shape drift; the save path keeps already-uploaded
 *        remote photos and uploads only newly-picked locals; and every garage
 *        raise code becomes plain-English copy rather than leaking the code.
 * WHY:   The mapping is the seam where a server shape drift would otherwise
 *        render garbage. The keep-remote rule is what makes "report this car
 *        stolen" fast — a re-upload of unchanged photos would spend exactly the
 *        seconds this feature exists to save. And the error copy is what an
 *        owner sees when they hit the cap or a duplicate plate.
 * LINKS: src/features/garage/api/garageApi.ts, docs/TESTING.md.
 */

import { addVehicle, deleteVehicle, listMyVehicles } from './garageApi';

const mockRpc = jest.fn();
const mockUpload = jest.fn(async (_userId: string, _photo: unknown, index: number, prefix = '') =>
  `https://x.supabase.co/storage/v1/object/public/post-photos/u1/${prefix}new-${index}.jpg`,
);
jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }) },
  },
  isRemotePhoto: (uri: string) => /^https?:\/\//.test(uri),
  uploadOwnFolderPhoto: (...args: unknown[]) =>
    mockUpload(...(args as [string, unknown, number, string])),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));


const VEHICLE_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const POST_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: VEHICLE_ID,
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colour_note: null,
    year: 2019,
    body_type: 'Saloon',
    nickname: "Mum's Golf",
    verification_state: 'unverified',
    photos: [
      { url: 'https://x.supabase.co/post-photos/u1/0.jpg', position: 0 },
      { url: 'https://x.supabase.co/post-photos/u1/1.jpg', position: 1 },
    ],
    distinctive_features: [
      { photo_url: 'https://x.supabase.co/post-photos/u1/m0.jpg', description: 'Cracked mirror', position: 0 },
    ],
    is_currently_posted: false,
    active_post_id: null,
    created_at: '2026-07-08T12:00:00Z',
    ...overrides,
  };
}

function answers(overrides: Record<string, unknown> = {}) {
  return {
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: '',
    year: 2019,
    bodyType: 'Saloon',
    distinctiveFeatures: [],
    photos: [],
    nickname: '',
    ...overrides,
  } as Parameters<typeof addVehicle>[0];
}

beforeEach(() => jest.clearAllMocks());

describe('listMyVehicles', () => {
  it('maps a row to SavedVehicle, renaming the server shape', async () => {
    mockRpc.mockResolvedValue({ data: [row()], error: null });

    const [vehicle] = await listMyVehicles();

    expect(vehicle.id).toBe(VEHICLE_ID);
    expect(vehicle.bodyType).toBe('Saloon');
    expect(vehicle.verificationState).toBe('unverified');
    expect(vehicle.photos.map((p) => p.url)).toEqual([
      'https://x.supabase.co/post-photos/u1/0.jpg',
      'https://x.supabase.co/post-photos/u1/1.jpg',
    ]);
    expect(vehicle.distinctiveFeatures[0]).toEqual({
      photoUrl: 'https://x.supabase.co/post-photos/u1/m0.jpg',
      description: 'Cracked mirror',
      position: 0,
    });
  });

  it('carries the currently-posted flags that drive the card + block removal', async () => {
    mockRpc.mockResolvedValue({
      data: [row({ is_currently_posted: true, active_post_id: POST_ID })],
      error: null,
    });

    const [vehicle] = await listMyVehicles();

    expect(vehicle.isCurrentlyPosted).toBe(true);
    expect(vehicle.activePostId).toBe(POST_ID);
  });

  it('accepts a bare car — no plate, no photos, no features', async () => {
    mockRpc.mockResolvedValue({
      data: [row({ plate: null, year: null, body_type: null, nickname: null, photos: [], distinctive_features: [] })],
      error: null,
    });

    const [vehicle] = await listMyVehicles();

    expect(vehicle.plate).toBeNull();
    expect(vehicle.photos).toEqual([]);
  });

  it('carries the colour note for a wrapped car', async () => {
    mockRpc.mockResolvedValue({
      data: [row({ colour: 'Multicolour / wrapped', colour_note: 'matte black wrap over silver' })],
      error: null,
    });

    const [vehicle] = await listMyVehicles();

    expect(vehicle.colourNote).toBe('matte black wrap over silver');
  });

  it('fails loudly on a shape drift rather than rendering garbage', async () => {
    mockRpc.mockResolvedValue({ data: [row({ id: 'not-a-uuid' })], error: null });
    await expect(listMyVehicles()).rejects.toThrow();
  });

  it('returns [] when the RPC returns null (guest / empty garage)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(listMyVehicles()).resolves.toEqual([]);
  });
});

describe('addVehicle', () => {
  it('keeps already-uploaded remote photos and uploads only new local ones', async () => {
    mockRpc.mockResolvedValue({ data: { vehicle_id: VEHICLE_ID }, error: null });

    await addVehicle(
      answers({
        photos: [
          { uri: 'https://x.supabase.co/post-photos/u1/kept.jpg', width: 1, height: 1 },
          { uri: 'file:///local/new.jpg', width: 1, height: 1 },
        ],
      }),
    );

    // Only the local file is uploaded — re-uploading the unchanged one would
    // spend the seconds this feature exists to save.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const params = mockRpc.mock.calls[0][1];
    expect(params.p_photo_urls).toEqual([
      'https://x.supabase.co/post-photos/u1/kept.jpg',
      'https://x.supabase.co/storage/v1/object/public/post-photos/u1/new-1.jpg',
    ]);
  });

  // REGRESSION (2026-07-27): four of the add-a-car steps are OPTIONAL, so the
  // wizard hands over answers where plate / photos / distinctiveFeatures /
  // nickname are entirely absent — not empty, absent. The screen used to cast
  // that to the complete type, and the save died on `photos.entries()` with
  // "Cannot read property 'entries' of undefined". Saving a bare car is the
  // fastest happy path, so this is the case that has to work.
  it('saves a car with EVERY optional step skipped (undefined, not empty)', async () => {
    mockRpc.mockResolvedValue({ data: { vehicle_id: VEHICLE_ID }, error: null });

    await expect(
      addVehicle({ make: 'BMW', model: '320d', colour: 'Blue' }),
    ).resolves.toBe(VEHICLE_ID);

    const params = mockRpc.mock.calls[0][1];
    expect(params.p_photo_urls).toEqual([]);
    expect(params.p_distinctive_features).toEqual([]);
    expect(params.p_plate).toBeNull();
    expect(params.p_nickname).toBeNull();
    expect(params.p_colour_note).toBeNull();
    expect(params.p_year).toBeNull();
    expect(params.p_body_type).toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('trims an empty plate and nickname to SQL NULL', async () => {
    mockRpc.mockResolvedValue({ data: { vehicle_id: VEHICLE_ID }, error: null });

    await addVehicle(answers({ plate: '   ', nickname: '' }));

    const params = mockRpc.mock.calls[0][1];
    expect(params.p_plate).toBeNull();
    expect(params.p_nickname).toBeNull();
  });

  it('turns VEHICLE_LIMIT_REACHED into copy that says what to do', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'VEHICLE_LIMIT_REACHED', code: 'P0001' } });

    await expect(addVehicle(answers())).rejects.toThrow(
      'You can save up to 5 cars. Remove one to add another.',
    );
  });

  it('turns PLATE_ALREADY_SAVED into copy, never the raw code', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'PLATE_ALREADY_SAVED', code: 'P0001' } });

    await expect(addVehicle(answers())).rejects.toThrow('That car is already in your garage.');
  });

  it('falls back to safe copy for an unmapped failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'some_pg_noise', code: '500' } });

    await expect(addVehicle(answers())).rejects.toThrow(
      'We couldn’t save your car. Please try again.',
    );
  });
});

describe('deleteVehicle', () => {
  it('explains the block when the car is currently reported stolen', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'VEHICLE_HAS_ACTIVE_POST', code: 'P0001' },
    });

    await expect(deleteVehicle(VEHICLE_ID)).rejects.toThrow(
      'This car is currently reported stolen. You can remove it once that listing is closed.',
    );
  });
});
