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

import { requestAccountDeletion, signOut } from './profileApi';

const calls: string[] = [];

const mockAuthSignOut = jest.fn(async () => {
  calls.push('auth.signOut');
  return { error: null };
});
const mockInvoke = jest.fn(async () => ({ error: null }));
jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      signOut: () => mockAuthSignOut(),
    },
    functions: { invoke: () => mockInvoke() },
  },
}));

const mockClearDraft = jest.fn(async () => {
  calls.push('clearPostDraft');
});
jest.mock('@/features/vehicles', () => ({ clearPostDraft: () => mockClearDraft() }));

const mockUnregister = jest.fn(async () => {
  calls.push('unregisterPushToken');
});
jest.mock('@/features/notifications', () => ({
  unregisterCurrentPushToken: () => mockUnregister(),
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
    expect(calls).toEqual(['unregisterPushToken', 'clearPostDraft', 'auth.signOut']);
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
});

describe('requestAccountDeletion', () => {
  it('SAFETY: deletes the unfinished report draft along with the account', async () => {
    await requestAccountDeletion();
    expect(calls).toEqual(['clearPostDraft', 'auth.signOut']);
  });

  it('keeps it when the deletion is refused', async () => {
    mockInvoke.mockResolvedValueOnce({ error: new Error('refused') } as never);
    await expect(requestAccountDeletion()).rejects.toBeTruthy();
    expect(mockClearDraft).not.toHaveBeenCalled();
  });
});
