/**
 * WHAT:  Tests for signOut's ordering guarantee.
 * WHY:   SAFETY. The push token must be released BEFORE the session drops.
 *        `unregister_push_token` pins its delete to auth.uid(), so once
 *        supabase.auth.signOut() has run there is no way to prove the token
 *        was ours — the row survives and keeps delivering this user's
 *        sightings and messages to whoever signs in on that handset next.
 *        The ordering is one line and reads as incidental, which is exactly
 *        why it needs a test rather than a comment.
 * LINKS: ./profileApi.ts; src/features/notifications/api/pushTokenApi.ts;
 *        docs/SECURITY_AND_TRUST.md §3 (tokens are device credentials).
 */

import { signOut } from './profileApi';

const calls: string[] = [];

const mockAuthSignOut = jest.fn(async () => {
  calls.push('auth.signOut');
  return { error: null };
});
jest.mock('@/shared/api', () => ({
  supabase: {
    auth: {
      signOut: () => mockAuthSignOut(),
    },
  },
}));

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
    expect(calls).toEqual(['unregisterPushToken', 'auth.signOut']);
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
