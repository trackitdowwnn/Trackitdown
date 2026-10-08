/**
 * WHAT:  Tests for loadGarage / awaitGarageAnswer and the garage cache they
 *        fill: one fetch shared by every caller, results keyed by user, never
 *        published for a user who has signed out mid-fetch, never published
 *        (or joined) once a garage write has overtaken it, and a wait that is
 *        always bounded.
 * WHY:   The cache holds number plates and now decides what the report screen
 *        shows on its first frame. A second account seeing the first's cars is
 *        a privacy bug; a wait that never ends would make the + button dead.
 * LINKS: src/features/garage/lib/loadGarage.ts;
 *        src/features/garage/lib/savedCarSignal.ts; docs/TESTING.md.
 */

import type { SavedVehicle } from '../types';
import { awaitGarageAnswer, loadGarage } from './loadGarage';
import {
  garageFor,
  invalidateSavedCarSignal,
  isGarageFresh,
  markVehiclePosted,
  publishGarage,
} from './savedCarSignal';

let mockCurrentUser: string | null = 'u1';
jest.mock('@/features/auth', () => ({
  getCurrentUserId: () => mockCurrentUser,
}));

const mockList = jest.fn();
jest.mock('../api/garageApi', () => ({ listMyVehicles: () => mockList() }));

const car = { id: 'v1', plate: 'AB12 CDE' } as SavedVehicle;

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = 'u1';
  invalidateSavedCarSignal();
  mockList.mockResolvedValue([car]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('loadGarage', () => {
  it('shares one fetch between callers and publishes it for that user', async () => {
    const [a, b] = await Promise.all([loadGarage('u1'), loadGarage('u1')]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(garageFor('u1')?.vehicles).toEqual([car]);
    expect(isGarageFresh('u1', 1000)).toBe(true);
  });

  it('SAFETY: never returns one user’s garage for another', async () => {
    await loadGarage('u1');
    expect(garageFor('u2')).toBeNull();
    expect(garageFor(null)).toBeNull();
  });

  it('SAFETY: does not publish a result that lands after a sign-out', async () => {
    let land: ((v: SavedVehicle[]) => void) | undefined;
    mockList.mockReturnValue(
      new Promise<SavedVehicle[]>((resolve) => {
        land = resolve;
      }),
    );
    const loading = loadGarage('u1');
    mockCurrentUser = null; // signed out mid-fetch
    land?.([car]);

    await expect(loading).resolves.toBe(false);
    expect(garageFor('u1')).toBeNull();
  });

  /** A listMyVehicles call that settles only when the test says so. */
  function deferredList(): (v: SavedVehicle[]) => void {
    let land: ((v: SavedVehicle[]) => void) | undefined;
    mockList.mockReturnValueOnce(
      new Promise<SavedVehicle[]>((resolve) => {
        land = resolve;
      }),
    );
    return (v) => land?.(v);
  }

  // Review of #141: a revalidation in flight when a car was deleted would
  // otherwise publish the old list, deleted car and all, and call it fresh.
  it('a fetch overtaken by a garage write is never published — it asks again', async () => {
    const landStale = deferredList();
    const loading = loadGarage('u1');
    invalidateSavedCarSignal(); // the car was deleted mid-fetch
    mockList.mockResolvedValue([]); // the server's answer now

    landStale([car]);
    await expect(loading).resolves.toBe(true);
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(garageFor('u1')?.vehicles).toEqual([]);
  });

  it('a caller after a garage write never joins the stale fetch', async () => {
    const landStale = deferredList();
    const first = loadGarage('u1');
    invalidateSavedCarSignal();
    mockList.mockResolvedValue([]);
    const second = loadGarage('u1');

    expect(mockList).toHaveBeenCalledTimes(2); // its own fetch, not a join
    await expect(second).resolves.toBe(true);
    landStale([car]);
    await first;
    expect(garageFor('u1')?.vehicles).toEqual([]);
  });

  it('a failed fetch resolves false and caches nothing', async () => {
    mockList.mockRejectedValue(new Error('offline'));
    await expect(loadGarage('u1')).resolves.toBe(false);
    expect(garageFor('u1')).toBeNull();
  });
});

// Review of #141: the server counts a post only once it is paid, so a refetch
// right after creating one would offer the car straight back.
describe('markVehiclePosted', () => {
  it('marks that one car as reported, so the chooser stops offering it', () => {
    const other = { id: 'v2', plate: 'XY34 ZZZ' } as SavedVehicle;
    publishGarage('u1', [car, other]);
    markVehiclePosted('v1');

    const vehicles = garageFor('u1')?.vehicles ?? [];
    expect(vehicles.find((v) => v.id === 'v1')?.isCurrentlyPosted).toBe(true);
    expect(vehicles.find((v) => v.id === 'v2')?.isCurrentlyPosted).toBeFalsy();
  });

  it('lasts until the server answers — and the server has the last word', async () => {
    publishGarage('u1', [car]);
    markVehiclePosted('v1');
    expect(garageFor('u1')?.vehicles[0]?.isCurrentlyPosted).toBe(true);

    mockList.mockResolvedValue([{ ...car, isCurrentlyPosted: true }]); // paid
    await loadGarage('u1');
    expect(garageFor('u1')?.vehicles[0]?.isCurrentlyPosted).toBe(true);

    mockList.mockResolvedValue([car]); // e.g. never paid: offer it again
    await loadGarage('u1');
    expect(garageFor('u1')?.vehicles[0]?.isCurrentlyPosted).toBeFalsy();
  });

  it('does nothing when the car is not cached', () => {
    markVehiclePosted('v1');
    expect(garageFor('u1')).toBeNull();
  });
});

describe('awaitGarageAnswer', () => {
  it('resolves at once when the garage is already known, without fetching', async () => {
    publishGarage('u1', [car]);
    await awaitGarageAnswer('u1', 400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('resolves at once for a guest — there is no garage to know', async () => {
    await awaitGarageAnswer(null, 400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('never waits past its deadline', async () => {
    jest.useFakeTimers();
    mockList.mockReturnValue(new Promise(() => {})); // never settles
    let settled = false;
    void awaitGarageAnswer('u1', 400).then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(399);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
