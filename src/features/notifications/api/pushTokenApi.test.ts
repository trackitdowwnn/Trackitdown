/**
 * WHAT:  Tests for the push-token lifecycle api — registration, and the
 *        sign-out release.
 * WHY:   SAFETY. A push token is a device credential that survives sign-out.
 *        `unregisterCurrentPushToken` MUST run while the session is still
 *        live, because the RPC pins the delete to auth.uid() — after signOut
 *        there is no way to prove the token was ours, and the row would keep
 *        delivering this user's sightings and messages to whoever holds the
 *        handset next. It must also never throw, or a failed release would
 *        block someone from logging out.
 * LINKS: ./pushTokenApi.ts, ../lib/pushTokenCache.ts;
 *        src/features/profile/api/profileApi.ts (signOut calls it FIRST);
 *        supabase/migrations/20260802100000_push_infrastructure.sql.
 */

import { clearPushTokenCache, getCurrentPushToken, rememberPushToken } from '../lib/pushTokenCache';
import { registerPushToken, unregisterCurrentPushToken } from './pushTokenApi';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const TOKEN = 'ExponentPushToken[abc123]';

beforeEach(() => {
  jest.clearAllMocks();
  clearPushTokenCache();
  mockRpc.mockResolvedValue({ error: null });
});

describe('registerPushToken', () => {
  it('sends the token and platform, and never a user id', async () => {
    await registerPushToken(TOKEN, 'android');
    // user_id is pinned to auth.uid() server-side; a client-supplied one would
    // let a caller register a token on someone else's behalf.
    expect(mockRpc).toHaveBeenCalledWith('register_push_token', {
      p_token: TOKEN,
      p_platform: 'android',
    });
  });

  it('throws so the caller can decide — the hook swallows it', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'nope', code: '42501' } });
    await expect(registerPushToken(TOKEN, 'ios')).rejects.toThrow('nope');
  });
});

describe('unregisterCurrentPushToken', () => {
  it('releases the token this session registered', async () => {
    rememberPushToken('user-1', TOKEN);

    await unregisterCurrentPushToken();

    expect(mockRpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    // Cleared, so a second sign-out attempt is a no-op rather than a retry.
    expect(getCurrentPushToken()).toBeNull();
  });

  it('does nothing when no token was registered this session', async () => {
    await unregisterCurrentPushToken();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('never throws, so it cannot block sign-out', async () => {
    rememberPushToken('user-1', TOKEN);
    mockRpc.mockResolvedValue({ error: { message: 'offline', code: 'PGRST' } });

    await expect(unregisterCurrentPushToken()).resolves.toBeUndefined();
    // Still cleared: a token we could not release must not be retried forever,
    // and the next sign-in MOVES it anyway (push_tokens is keyed on the token).
    expect(getCurrentPushToken()).toBeNull();
  });
});
