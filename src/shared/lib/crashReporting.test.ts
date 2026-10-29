/**
 * WHAT:  Tests for ./crashReporting.ts — the `app_crash` event's fields (and
 *        what it never carries), the chained global handler and the grace a
 *        fatal crash gets, and rejection tracking in release builds only.
 * WHY:   A crash handler that breaks RN's own one hides every crash, and one
 *        that sends an error message can send a plate or a name. Neither
 *        would show on a working phone.
 * LINKS: ./crashReporting.ts; ./telemetry.ts; src/app/_layout.tsx.
 */

import { getRecentLogs } from './logger';
import {
  installCrashHandlers,
  otaId,
  reportCrash,
  resetCrashHandlersForTests,
  topFrame,
} from './crashReporting';

const mockFlush = jest.fn(() => Promise.resolve());
jest.mock('./telemetry', () => ({ flush: () => mockFlush() }));

let mockUpdateId: string | null = '01a18453-26fc-7644-9b0f-fc8796c65845';
jest.mock('expo-updates', () => ({
  get updateId() {
    return mockUpdateId;
  },
}));

function fakeErrorUtils() {
  let handler: ((error: unknown, isFatal?: boolean) => void) | undefined;
  const previous = jest.fn();
  return {
    previous,
    utils: {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: typeof handler) => (handler = h),
    },
    fire: (error: unknown, isFatal: boolean) => handler?.(error, isFatal),
  };
}

const lastCrash = () => getRecentLogs().filter((e) => e.message === 'app_crash').at(-1);

beforeEach(() => {
  mockFlush.mockClear();
  resetCrashHandlersForTests();
  mockUpdateId = '01a18453-26fc-7644-9b0f-fc8796c65845';
});

describe('otaId and topFrame', () => {
  it('shortens the running OTA to 8 hex characters, or says embedded', () => {
    expect(otaId()).toBe('01a18453');
    mockUpdateId = null;
    expect(otaId()).toBe('embedded');
  });

  it('keeps the function and position of the top frame, never its path', () => {
    const stack = 'TypeError: x\n    at onPress (address at /data/user/0/app/bundle-1a2b:1:23456)\n    at next';
    expect(topFrame(stack)).toBe('onPress:1:23456');
    expect(topFrame(undefined)).toBeUndefined();
  });
});

describe('reportCrash', () => {
  it('⚠️ logs kind, type, frame and OTA — never the message — and flushes now', async () => {
    const error = new TypeError('Cannot read plate AB12CDE of undefined');
    await reportCrash('render', error);
    const crash = lastCrash();
    expect(crash).toMatchObject({
      level: 'error',
      feature: 'app',
      data: { kind: 'render', type: 'TypeError', ota: '01a18453' },
    });
    expect(JSON.stringify(crash)).not.toContain('AB12CDE');
    expect(mockFlush).toHaveBeenCalled();
  });
});

describe('installCrashHandlers', () => {
  it('reports a non-fatal error and hands it straight to RN', () => {
    const { utils, fire, previous } = fakeErrorUtils();
    installCrashHandlers({ errorUtils: utils, dev: true });
    const error = new Error('x');
    fire(error, false);
    expect(lastCrash()?.data).toMatchObject({ kind: 'error' });
    expect(previous).toHaveBeenCalledWith(error, false);
  });

  it('gives a fatal crash its report before RN takes the app down', async () => {
    const { utils, fire, previous } = fakeErrorUtils();
    let release: () => void = () => {};
    mockFlush.mockReturnValueOnce(new Promise<void>((resolve) => (release = resolve)));
    installCrashHandlers({ errorUtils: utils, dev: true });
    fire(new Error('fatal'), true);
    expect(lastCrash()?.data).toMatchObject({ kind: 'fatal' });
    expect(previous).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(previous).toHaveBeenCalled();
  });

  it('tracks unhandled rejections in a release build only', () => {
    const dev = { enablePromiseRejectionTracker: jest.fn() };
    installCrashHandlers({ hermes: dev, dev: true });
    expect(dev.enablePromiseRejectionTracker).not.toHaveBeenCalled();

    resetCrashHandlersForTests();
    const release = { enablePromiseRejectionTracker: jest.fn() };
    installCrashHandlers({ hermes: release, dev: false });
    const options = release.enablePromiseRejectionTracker.mock.calls[0][0];
    options.onUnhandled(1, new RangeError('r'));
    expect(lastCrash()?.data).toMatchObject({ kind: 'rejection', type: 'RangeError' });
  });

  it('installs once', () => {
    const { utils } = fakeErrorUtils();
    const set = jest.spyOn(utils, 'setGlobalHandler');
    installCrashHandlers({ errorUtils: utils, dev: true });
    installCrashHandlers({ errorUtils: utils, dev: true });
    expect(set).toHaveBeenCalledTimes(1);
  });
});
