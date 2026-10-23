/**
 * WHAT:  Tests for signOut's ordering guarantee, and that a deliberate
 *        sign-out or an account deletion deletes the unfinished report draft.
 * WHY:   SAFETY. The push token must be released BEFORE the session drops.
 *        `unregister_push_token` pins its delete to auth.uid(), so once
 *        supabase.auth.signOut() has run there is no way to prove the token
 *        was ours — the row survives and keeps delivering this user's
 *        sightings and messages to whoever signs in on that handset next.
 *        The ordering is one line and reads as incidental, which is exactly
 *        why it needs a test rather than a comment.
 *
 *        The draft holds where the car was last seen (on a driveway theft, a
 *        home); a deliberate sign-out is the hand-over point for a shared or
 *        sold phone (security review of #141).
 * LINKS: ./profileApi.ts; src/features/notifications/api/pushTokenApi.ts;
 *        src/features/vehicles/post/lib/postDraftStorage.ts;
 *        docs/SECURITY_AND_TRUST.md §3 (tokens are device credentials).
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import {
  AccountDeletionError,
  fetchDeletionBlockers,
  fetchIdentityCheck,
  requestAccountDeletion,
  signOut,
} from './profileApi';

const calls: string[] = [];

const mockAuthSignOut = jest.fn(async (_options?: unknown) => {
  calls.push('auth.signOut');
  return { error: null };
});
const mockInvoke = jest.fn(async () => ({ error: null }));
const mockGetUser = jest.fn();
const mockRpc = jest.fn(async (name: string): Promise<{ data: unknown; error: unknown }> => {
  calls.push(`rpc:${name}`);
  return { data: null, error: null };
});
jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      signOut: (options?: unknown) => mockAuthSignOut(options),
      getUser: () => mockGetUser(),
    },
    functions: { invoke: () => mockInvoke() },
    rpc: (name: string) => mockRpc(name),
  },
}));

const mockClearDraft = jest.fn(async () => {
  calls.push('clearPostDraft');
});
jest.mock('@/features/vehicles', () => ({ clearPostDraft: () => mockClearDraft() }));

const mockForgetLocations = jest.fn(() => {
  calls.push('forgetLocationMemory');
});
jest.mock('@/shared/lib/location/locationMemory', () => ({
  forgetLocationMemory: () => mockForgetLocations(),
}));

const mockUnregister = jest.fn(async () => {
  calls.push('unregisterPushToken');
});
const mockForgetAll = jest.fn(async (): Promise<boolean> => {
  calls.push('forgetAllPushTokens');
  return true;
});
jest.mock('@/features/notifications', () => ({
  unregisterCurrentPushToken: () => mockUnregister(),
  forgetAllPushTokens: () => mockForgetAll(),
  // Sign-out zeroes the Inbox badge halves; the real module is pure, the
  // mock just needs the name to exist.
  resetInboxBadge: jest.fn(),
}));

// profileApi imports this for avatar resizing; unused on this path.
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {},
  SaveFormat: {},
}));

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
});

describe('signOut', () => {
  it('releases the push token BEFORE dropping the session', async () => {
    await signOut();
    expect(calls).toEqual([
      'unregisterPushToken',
      'clearPostDraft',
      'forgetLocationMemory',
      'auth.signOut',
    ]);
  });

  it('still signs out when releasing the token fails', async () => {
    // unregisterCurrentPushToken swallows its own errors by contract, but a
    // failed release must never be able to trap someone in a session — so
    // signOut catches too, and this asserts the belt as well as the braces.
    mockUnregister.mockRejectedValueOnce(new Error('offline'));
    await expect(signOut()).resolves.toBeUndefined();
    expect(calls).toContain('auth.signOut');
  });

  it('propagates a real sign-out failure', async () => {
    mockAuthSignOut.mockResolvedValueOnce({ error: { message: 'nope' } as never });
    await expect(signOut()).rejects.toBeTruthy();
  });

  // ⚠️ supabase-js defaults a bare signOut() to 'global' — every Log out was
  // signing out every device. The scope must be explicit.
  it('Log out signs out of THIS session only', async () => {
    await signOut();
    expect(mockAuthSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mockForgetAll).not.toHaveBeenCalled();
  });

  // SAFETY: the lost-phone case. A global sign-out that left the other phones'
  // push tokens alive would keep sending them this person's sightings.
  it('everywhere: forgets EVERY device’s push token first, then revokes all sessions', async () => {
    await signOut({ everywhere: true });
    expect(calls).toEqual([
      'forgetAllPushTokens',
      'clearPostDraft',
      'forgetLocationMemory',
      'auth.signOut',
    ]);
    expect(mockAuthSignOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  // ⚠️ Half-working would be worse than failing: the other phones signed out
  // but still getting this person's pushes, and the screen saying it worked.
  it('everywhere: REFUSES, signed in everywhere still, when the tokens could not be forgotten', async () => {
    mockForgetAll.mockResolvedValueOnce(false);
    await expect(signOut({ everywhere: true })).rejects.toThrow('PUSH_TOKENS_NOT_FORGOTTEN');
    expect(mockAuthSignOut).not.toHaveBeenCalled();
    expect(mockClearDraft).not.toHaveBeenCalled();
  });
});

describe('fetchIdentityCheck', () => {
  const user = (email: string | null, provider: string) => ({
    data: { user: { email, app_metadata: { provider } } },
    error: null,
  });

  it('an email account gets a code to its own address', async () => {
    mockGetUser.mockResolvedValueOnce(user('jane@example.com', 'email'));
    await expect(fetchIdentityCheck()).resolves.toEqual({ kind: 'code', email: 'jane@example.com' });
  });

  it('a Google account gets a code too (a real inbox)', async () => {
    mockGetUser.mockResolvedValueOnce(user('jane@gmail.com', 'google'));
    await expect(fetchIdentityCheck()).resolves.toEqual({ kind: 'code', email: 'jane@gmail.com' });
  });

  // Apple's private relay doesn't forward our codes — they'd never arrive.
  it.each([
    ['an Apple account', user('jane@icloud.com', 'apple')],
    ['an Apple relay address', user('x1y2@privaterelay.appleid.com', 'email')],
    ['no email at all', user(null, 'email')],
  ])('%s confirms with Apple', async (_case, answer) => {
    mockGetUser.mockResolvedValueOnce(answer);
    await expect(fetchIdentityCheck()).resolves.toEqual({ kind: 'apple' });
  });
});

describe('fetchDeletionBlockers', () => {
  it('returns the reasons with something to count', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { code: 'LIVE_LISTING', count: 1 },
        { code: 'MONEY_HELD', count: 0 },
      ],
      error: null,
    });
    await expect(fetchDeletionBlockers()).resolves.toEqual([{ code: 'LIVE_LISTING', count: 1 }]);
  });

  it('throws on a malformed answer rather than reading it as "nothing blocks"', async () => {
    mockRpc.mockResolvedValueOnce({ data: { blockers: 'nope' }, error: null });
    await expect(fetchDeletionBlockers()).rejects.toBeTruthy();
  });
});

describe('requestAccountDeletion', () => {
  it('SAFETY: deletes the unfinished report draft along with the account', async () => {
    await requestAccountDeletion();
    expect(calls).toEqual(['clearPostDraft', 'forgetLocationMemory', 'auth.signOut']);
  });

  it('keeps it when the deletion is refused', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('refused') } as never);
    await expect(requestAccountDeletion()).rejects.toBeTruthy();
    expect(mockClearDraft).not.toHaveBeenCalled();
  });

  // The server's reasons it can't go yet (20261023120000): each one says what
  // to do — "try again" would never come true while the reason stands.
  it.each([
    ['LIVE_LISTING', 'Close it first'],
    ['MONEY_HELD', 'still being returned'],
    ['REWARD_ON_ITS_WAY', 'Set up payouts'],
    ['PAYOUT_ON_ITS_WAY', 'A payout is still on its way'],
    ['DISPUTE_OPEN', 'A dispute is still being decided'],
    ['REVIEW_OPEN', 'still being reviewed'],
  ])('names why it was refused: %s', async (code, words) => {
    const refusal = new FunctionsHttpError({
      json: async () => ({ code, message: 'You can’t delete your account just yet.' }),
    });
    mockInvoke.mockResolvedValueOnce({ error: refusal } as never);
    const error = await requestAccountDeletion().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountDeletionError);
    expect((error as AccountDeletionError).code).toBe(code);
    expect((error as AccountDeletionError).message).toContain(words);
  });
});
