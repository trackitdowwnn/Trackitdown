/**
 * WHAT:  Tests for launchScheme — the phone's scheme, as it was at launch.
 * WHY:   The point of the module is WHEN it reads: once, at load, so a saved
 *        in-app preference pushed into Appearance afterwards cannot change it.
 *        That is only provable by loading it fresh, hence isolateModules.
 * LINKS: ./launchScheme.ts; src/features/auth/components/BrandSplash.tsx.
 */

type Scheme = 'light' | 'dark' | 'unspecified' | null;

/** Load a fresh copy of the module with the phone in `atLaunch`, then flip the
 *  phone (or the in-app override) to `later` and read it again. */
function launchedIn(atLaunch: Scheme, later: Scheme = atLaunch): string {
  let read = '';
  jest.isolateModules(() => {
    // Required, not imported: each load must come from this fresh registry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Appearance } = require('react-native');
    const spy = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(atLaunch);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { launchScheme } = require('./launchScheme');
    spy.mockReturnValue(later);
    read = launchScheme();
  });
  return read;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('launchScheme', () => {
  it('is the phone’s scheme when the app launched', () => {
    expect(launchedIn('dark')).toBe('dark');
    expect(launchedIn('light')).toBe('light');
  });

  it('⚠️ ignores what Appearance says later — a saved preference cannot repaint it', () => {
    expect(launchedIn('dark', 'light')).toBe('dark');
    expect(launchedIn('light', 'dark')).toBe('light');
  });

  it('reads an unknown scheme as light, as the theme does', () => {
    expect(launchedIn(null)).toBe('light');
    expect(launchedIn('unspecified')).toBe('light');
  });
});
