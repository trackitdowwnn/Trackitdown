/**
 * WHAT:  Tests applyUpdateOnLaunch — that it reloads into a fresh update
 *        only inside the launch window, never asks in dev or with updates
 *        off, and turns every failure into a result rather than a throw.
 * WHY:   A reload is the most disruptive thing the app can do to itself. The
 *        one failure that matters is a reload under someone mid-task, so
 *        the window boundary is pinned on both sides.
 * LINKS: ./otaUpdate.ts.
 */

import { applyUpdateOnLaunch, LAUNCH_APPLY_WINDOW_MS, type UpdatesLike } from './otaUpdate';

function fake(overrides: Partial<UpdatesLike> = {}) {
  const updates: UpdatesLike = {
    isEnabled: true,
    checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: true }),
    fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: true }),
    reloadAsync: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return updates;
}

const LAUNCH = 1_000_000;

describe('applyUpdateOnLaunch', () => {
  it('reloads into a freshly downloaded update inside the launch window', async () => {
    const updates = fake();
    const result = await applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH + 2_000, false);
    expect(result).toBe('reloaded');
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('⚠️ defers past the window — the update still downloaded, but no reload under someone', async () => {
    const updates = fake();
    const result = await applyUpdateOnLaunch(
      updates,
      LAUNCH,
      () => LAUNCH + LAUNCH_APPLY_WINDOW_MS + 1,
      false,
    );
    expect(result).toBe('deferred');
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('reloads exactly at the window edge (inclusive)', async () => {
    const updates = fake();
    const result = await applyUpdateOnLaunch(
      updates,
      LAUNCH,
      () => LAUNCH + LAUNCH_APPLY_WINDOW_MS,
      false,
    );
    expect(result).toBe('reloaded');
  });

  it('is current when nothing is available, and asks for nothing more', async () => {
    const updates = fake({
      checkForUpdateAsync: jest.fn().mockResolvedValue({ isAvailable: false }),
    });
    expect(await applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, false)).toBe('current');
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('is current when the fetch says the download was not new', async () => {
    const updates = fake({ fetchUpdateAsync: jest.fn().mockResolvedValue({ isNew: false }) });
    expect(await applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, false)).toBe('current');
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('never asks in dev', async () => {
    const updates = fake();
    expect(await applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, true)).toBe('disabled');
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('never asks when updates are off (Expo Go, a dev client, a build with no URL)', async () => {
    const updates = fake({ isEnabled: false });
    expect(await applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, false)).toBe('disabled');
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('turns a rejected check into a result, not a throw', async () => {
    const updates = fake({ checkForUpdateAsync: jest.fn().mockRejectedValue(new Error('offline')) });
    await expect(applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, false)).resolves.toBe('failed');
  });

  it('turns a rejected download into a result, not a throw', async () => {
    const updates = fake({ fetchUpdateAsync: jest.fn().mockRejectedValue(new Error('dropped')) });
    await expect(applyUpdateOnLaunch(updates, LAUNCH, () => LAUNCH, false)).resolves.toBe('failed');
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });
});
