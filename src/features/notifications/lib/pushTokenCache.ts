/**
 * WHAT:  In-memory record of the push token this session registered, and for
 *        whom.
 * WHY:   Two callers need it and neither should re-mint one. Registration uses
 *        it to skip a redundant RPC; SIGN-OUT uses it to release the device
 *        BEFORE the session drops (the unregister RPC needs auth.uid(), so
 *        after signOut it is too late). Re-minting at sign-out would mean a
 *        network round-trip to Expo on a path the user expects to be instant,
 *        and one that can hang.
 *        Module-level rather than React state: it must survive remounts and be
 *        readable from a plain async function. Same posture as watchedStore /
 *        gateIntent. A cold start resets it, which is exactly what makes
 *        registration a refresh-on-launch.
 *        // SAFETY: a token is a device credential — held only in memory, and
 *        never logged.
 * LINKS: ../hooks/usePushRegistration.ts (writer);
 *        ../api/pushTokenApi.ts (unregisterCurrentPushToken).
 */

let currentToken: string | null = null;
/** `${userId}:${token}` of the last successful register, to skip repeats. */
let registeredKey: string | null = null;

export function rememberPushToken(userId: string, token: string): void {
  currentToken = token;
  registeredKey = `${userId}:${token}`;
}

/** Has this exact user+token pair already been sent this session? */
export function isPushTokenRegistered(userId: string, token: string): boolean {
  return registeredKey === `${userId}:${token}`;
}

/** The token to release on sign-out, or null when we never registered one. */
export function getCurrentPushToken(): string | null {
  return currentToken;
}

export function clearPushTokenCache(): void {
  currentToken = null;
  registeredKey = null;
}
