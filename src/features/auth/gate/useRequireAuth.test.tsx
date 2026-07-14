/**
 * WHAT:  Tests for the gate mechanism — useRequireAuth + the gateIntent store:
 *        a member's action runs immediately (no sheet); a guest's intent is
 *        stored for the AuthSheet; consuming clears it; clearing (dismissal)
 *        drops it without running.
 * WHY:   This is the engineering heart of deferred auth: run-now vs defer is
 *        the whole contract, and a dropped intent must NEVER run later.
 * LINKS: src/features/auth/gate/{useRequireAuth,gateIntent}.ts, docs/TESTING.md.
 */

import { renderHook } from '@testing-library/react-native';

import {
  clearPendingIntent,
  consumePendingIntent,
  setPendingIntent,
} from './gateIntent';
import { useRequireAuth } from './useRequireAuth';

const mockUseAuthStanding = jest.fn();

jest.mock('../hooks/useAuthStanding', () => ({
  useAuthStanding: () => mockUseAuthStanding(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  clearPendingIntent(); // module-level store — isolate tests from each other
});

describe('useRequireAuth', () => {
  it('runs the action immediately for a member — nothing stored', async () => {
    mockUseAuthStanding.mockReturnValue('member');
    const run = jest.fn();
    const { result } = await renderHook(() => useRequireAuth());

    result.current({ context: 'report_sighting', run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(consumePendingIntent()).toBeNull();
  });

  it('stores the intent (does NOT run) for a guest', async () => {
    mockUseAuthStanding.mockReturnValue('guest');
    const run = jest.fn();
    const { result } = await renderHook(() => useRequireAuth());

    result.current({ context: 'post_car', run });

    expect(run).not.toHaveBeenCalled();
    const stored = consumePendingIntent();
    expect(stored?.context).toBe('post_car');
    expect(stored?.run).toBe(run);
  });

  it('defers for an incomplete profile too (profile row is part of auth)', async () => {
    mockUseAuthStanding.mockReturnValue('incomplete');
    const run = jest.fn();
    const { result } = await renderHook(() => useRequireAuth());

    result.current({ context: 'edit_profile', run });

    expect(run).not.toHaveBeenCalled();
    expect(consumePendingIntent()?.context).toBe('edit_profile');
  });

  it('treats a still-loading standing as deferred (a cold-start tap is never lost)', async () => {
    mockUseAuthStanding.mockReturnValue('loading');
    const run = jest.fn();
    const { result } = await renderHook(() => useRequireAuth());

    result.current({ context: 'report_sighting', run });

    expect(run).not.toHaveBeenCalled();
    expect(consumePendingIntent()?.context).toBe('report_sighting');
  });
});

describe('gateIntent store', () => {
  it('consume clears the store — an intent resolves exactly once', () => {
    setPendingIntent({ context: 'tab_inbox' });
    expect(consumePendingIntent()?.context).toBe('tab_inbox');
    expect(consumePendingIntent()).toBeNull();
  });

  it('clear (dismissal) drops the intent so it can never run later', () => {
    const run = jest.fn();
    setPendingIntent({ context: 'post_car', run });
    clearPendingIntent();
    expect(consumePendingIntent()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('a newer intent replaces an older one (one pending at a time)', () => {
    setPendingIntent({ context: 'tab_my_cars' });
    setPendingIntent({ context: 'report_sighting' });
    expect(consumePendingIntent()?.context).toBe('report_sighting');
    expect(consumePendingIntent()).toBeNull();
  });
});
