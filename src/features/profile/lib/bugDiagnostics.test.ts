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
    const serialised = JSON.stringify(readBugDiagnostics()).toLowerCase();

    for (const forbidden of ['id', 'lat', 'lng', 'coord', 'plate', 'email', 'token', 'route']) {
      expect(serialised).not.toContain(`"${forbidden}`);
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
    const lines = describeDiagnostics({ ...FULL, platform: 'android', deviceModel: 'Pixel 7' });

    expect(lines).toContainEqual({ label: 'Device', value: 'Pixel 7 · Android 18.2' });
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

  it('shows half a device fact when only half is readable', () => {
    expect(describeDiagnostics({ ...FULL, osVersion: null })).toContainEqual({
      label: 'Device',
      value: 'iPhone 14',
    });
  });
});
