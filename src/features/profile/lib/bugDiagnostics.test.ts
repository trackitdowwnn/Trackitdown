/**
 * WHAT:  Tests for bugDiagnostics — the four fields a bug report carries, and
 *        the lines the screen shows for them.
 * WHY:   This function is the single source for both what is SENT and what the
 *        user is TOLD is being sent. If those two ever diverge we are
 *        collecting something we said we were not, so the shape is pinned here
 *        rather than left to two call sites to agree on.
 * LINKS: src/features/profile/lib/bugDiagnostics.ts;
 *        src/features/profile/screens/ReportBugScreen.tsx;
 *        src/features/legal/lib/legalContent.ts (declares the same four).
 */

import { describeDiagnostics, readBugDiagnostics, type BugDiagnostics } from './bugDiagnostics';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3' } } }));
jest.mock('expo-device', () => ({ osVersion: '18.2', modelName: 'iPhone 14' }));

const FULL: BugDiagnostics = {
  appVersion: '1.2.3',
  platform: 'ios',
  osVersion: '18.2',
  deviceModel: 'iPhone 14',
};

describe('readBugDiagnostics', () => {
  it('reads exactly the four named fields', () => {
    expect(Object.keys(readBugDiagnostics()).sort()).toEqual([
      'appVersion',
      'deviceModel',
      'osVersion',
      'platform',
    ]);
  });

  it('⚠️ carries nothing that identifies a post, a place or a person', () => {
    // The rule the whole feature rests on. Logs, screenshots and the current
    // route were all rejected for failing exactly this — a postId in a support
    // queue is a durable pointer at a live victim's case.
    //
    // ⚠️ SCANS THE KEY NAMES, SPLIT INTO WORDS. Two wrong versions came first
    // and both are worth naming, because each looks right:
    //   * `JSON.stringify(...)` searched for `'"' + forbidden` anchored every
    //     fragment to the START of a key, so `"postId"`, `"lastRoute"` and
    //     `"userEmail"` — the three exact leaks the comment above names — all
    //     sailed through. It could only ever pass.
    //   * Plain `includes` on the whole key goes the other way: 'platform'
    //     contains "lat", so it fails on a field that is meant to be here. A
    //     value scan is out for the same reason — 'android' contains "id".
    // Split on camel humps AND on _ / - / space, then prefix-match each word:
    // 'postId' and 'post_id' → ['post','id'], 'latitude' → ['latitude'] which
    // starts with "lat", 'platform' → itself, which does not. The separators
    // matter: a hump-only split let 'post_id' and 'user_email' straight past.
    //
    // This scans TOP-LEVEL KEY NAMES only. A nested `context: { postId }`
    // would read as the single word 'context' and slip by — the guard against
    // that is the sibling test above, which pins the key set to exactly four
    // and fails on any addition, nested or not. The two are meant to be read
    // together.
    const words = Object.keys(readBugDiagnostics()).flatMap((key) =>
      key
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[s_-]+/),
    );

    for (const forbidden of ['id', 'lat', 'lng', 'coord', 'plate', 'email', 'token', 'route']) {
      expect(words.filter((word) => word.startsWith(forbidden))).toEqual([]);
    }
  });
});

describe('describeDiagnostics', () => {
  it('reads as one fact about the handset', () => {
    expect(describeDiagnostics(FULL)).toEqual([
      { label: 'App version', value: '1.2.3' },
      { label: 'Device', value: 'iPhone 14 · iOS 18.2' },
    ]);
  });

  it('says Android when it is Android', () => {
    const lines = describeDiagnostics({
      ...FULL,
      platform: 'android',
      osVersion: '15',
      deviceModel: 'Pixel 7',
    });

    expect(lines).toContainEqual({ label: 'Device', value: 'Pixel 7 · Android 15' });
  });

  it('⚠️ omits a field it could not read rather than showing "Unknown"', () => {
    // The list is a promise about what is being sent. Listing a field we do not
    // have would make it a promise we are not keeping.
    const lines = describeDiagnostics({
      appVersion: null,
      platform: null,
      osVersion: null,
      deviceModel: null,
    });

    expect(lines).toEqual([]);
  });

  it('⚠️ still names the platform when the OS version will not read', () => {
    // The platform is sent UNCONDITIONALLY. Folding it into the OS string meant
    // that on a handset with no readable osVersion the screen said "iPhone 14"
    // while `p_platform: 'ios'` went to the server — the list claiming less
    // than the payload, which is the one failure this feature cannot have.
    expect(describeDiagnostics({ ...FULL, osVersion: null })).toContainEqual({
      label: 'Device',
      value: 'iPhone 14 · iOS',
    });
  });

  it('names the platform even with no model and no OS version', () => {
    expect(describeDiagnostics({ ...FULL, osVersion: null, deviceModel: null })).toContainEqual({
      label: 'Device',
      value: 'iOS',
    });
  });

  it('⚠️ shows the OS version even when the platform will not read', () => {
    // The mirror of the case above, and the one the first fix reintroduced.
    // Reachable on web: Platform.OS is neither ios nor android, so platform is
    // null, but expo-device still reads a version off the user agent — and
    // p_os_version is sent regardless. Neither half may hide the other.
    expect(describeDiagnostics({ ...FULL, platform: null })).toContainEqual({
      label: 'Device',
      value: 'iPhone 14 · 18.2',
    });
  });
});
