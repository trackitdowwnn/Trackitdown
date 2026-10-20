/**
 * WHAT:  Tests for setAppNightMode — the bridge to Android's per-app night
 *        mode, which the launch splash follows.
 * WHY:   The same JS ships by OTA to APKs built before the native module
 *        existed. There it must do nothing at all, and nowhere may it throw:
 *        it runs inside every theme change and on every launch.
 * LINKS: ./appNightMode.ts; modules/app-night-mode.
 */

type Native = { setApplicationNightMode: jest.Mock } | null;

/** Load a fresh copy with `native` as what the build provides. */
function load(native: Native) {
  let api: typeof import('./appNightMode') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: (name: string) => (name === 'AppNightMode' ? native : null),
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh load per case
    api = require('./appNightMode');
  });
  return api!;
}

afterEach(() => {
  jest.dontMock('expo');
});

it('does nothing on a build without the native module (older APKs on this update)', () => {
  expect(load(null).setAppNightMode('light')).toBe(false);
});

it('hands the choice to Android as given', () => {
  const native = { setApplicationNightMode: jest.fn(() => true) };
  const { setAppNightMode } = load(native);

  expect(setAppNightMode('dark')).toBe(true);
  expect(setAppNightMode('system')).toBe(true);
  expect(native.setApplicationNightMode.mock.calls).toEqual([['dark'], ['system']]);
});

it('reports Android declining it (below Android 12)', () => {
  const { setAppNightMode } = load({ setApplicationNightMode: jest.fn(() => false) });
  expect(setAppNightMode('light')).toBe(false);
});

it('⚠️ never throws — a theme switch must not fail over a splash colour', () => {
  const { setAppNightMode } = load({
    setApplicationNightMode: jest.fn(() => {
      throw new Error('native failure');
    }),
  });
  expect(() => setAppNightMode('light')).not.toThrow();
  expect(setAppNightMode('light')).toBe(false);
});
