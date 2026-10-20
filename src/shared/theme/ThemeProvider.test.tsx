/**
 * WHAT:  Tests for ThemeProvider's READY signal — when the saved Light/Dark
 *        choice is actually in effect, which the root layout waits for before
 *        handing over from the native splash.
 * WHY:   Two ways to get it wrong, both visible on every launch: ready too
 *        early and the opening screen paints in the phone's theme, then flips
 *        (the owner's 2026-10-20 report); ready never and the app sits on the
 *        native splash. Both directions are pinned, plus the latch — a ready
 *        that went false again would unmount the whole app.
 * LINKS: src/shared/theme/ThemeProvider.tsx; src/app/_layout.tsx (the wait).
 */

import { act, render } from '@testing-library/react-native';
import { Appearance, Text } from 'react-native';

import type { ThemePreference } from './themePreferenceTypes';
import { useThemeControls, useThemeReady } from './paletteContext';
import { THEME_READY_MAX_MS, ThemeProvider } from './ThemeProvider';

// The stored preference, answered when a test says so.
let mockAnswerStorage: (stored: ThemePreference) => void = () => {};
jest.mock('./themePreferenceStorage', () => ({
  loadThemePreference: () =>
    new Promise<ThemePreference>((resolve) => {
      mockAnswerStorage = resolve;
    }),
  saveThemePreference: () => Promise.resolve(),
}));

/** What the OS reports (the phone's scheme, or an override once applied), and
 *  whether it reports an override back at all. useColorScheme reads RN's
 *  internal Appearance binding, which a spy cannot reach — so the hook itself
 *  is the seam. */
let mockReported: 'light' | 'dark' = 'dark';
let osReportsOverrides = true;
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockReported,
}));

// The per-app night mode handed to Android for the next launch's splash.
const mockSetAppNightMode = jest.fn();
jest.mock('./appNightMode', () => ({
  setAppNightMode: (mode: string) => mockSetAppNightMode(mode),
}));

function Probe() {
  const ready = useThemeReady();
  const { scheme, setPreference } = useThemeControls();
  return (
    <Text testID="probe" onPress={() => setPreference('dark')}>
      {`${ready ? 'ready' : 'waiting'} ${scheme}`}
    </Text>
  );
}

const probe = (view: Awaited<ReturnType<typeof render>>) =>
  view.getByTestId('probe').props.children as string;

beforeEach(() => {
  jest.useFakeTimers();
  mockSetAppNightMode.mockClear();
  mockReported = 'dark';
  osReportsOverrides = true;
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation((scheme) => {
    if (osReportsOverrides && (scheme === 'light' || scheme === 'dark')) mockReported = scheme;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits until the saved choice is read', async () => {
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  expect(probe(view)).toBe('waiting dark');

  await act(async () => {
    mockAnswerStorage('system');
  });
  expect(probe(view)).toBe('ready dark');
});

it('⚠️ is ready IN the saved choice — a light app on a dark phone is light from its first frame', async () => {
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => {
    mockAnswerStorage('light');
  });
  expect(probe(view)).toBe('ready light');
});

it('does not call it ready while the OS still reports the phone’s scheme', async () => {
  osReportsOverrides = false;
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => {
    mockAnswerStorage('light');
  });
  expect(probe(view)).toBe('waiting dark');

  // …but never waits forever: past the backstop the app shows regardless.
  await act(async () => {
    jest.advanceTimersByTime(THEME_READY_MAX_MS);
  });
  expect(probe(view)).toBe('ready dark');
});

it('is ready at the backstop even if storage never answers', async () => {
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => {
    jest.advanceTimersByTime(THEME_READY_MAX_MS - 1);
  });
  expect(probe(view)).toMatch(/^waiting/);

  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  expect(probe(view)).toMatch(/^ready/);
});

it('⚠️ stays ready while a later change is still landing', async () => {
  // A ready that dropped back would make the root layout unmount the app.
  mockReported = 'light';
  const view = await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await act(async () => {
    mockAnswerStorage('system');
  });
  expect(probe(view)).toBe('ready light');

  osReportsOverrides = false; // the switch to Dark has not been reported yet
  await act(async () => {
    view.getByTestId('probe').props.onPress();
  });
  expect(probe(view)).toMatch(/^ready/);
});

describe('the next launch’s splash', () => {
  // Android draws the launch splash before any JS runs; the per-app night
  // mode is the only thing it can see. Owner, 2026-10-20: a dark phone with
  // the app on Light opened black, then turned white.
  it('⚠️ hands the saved choice to Android on every launch', async () => {
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      mockAnswerStorage('light');
    });
    expect(mockSetAppNightMode).toHaveBeenLastCalledWith('light');
  });

  it('…and every change made in the app', async () => {
    const view = await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      mockAnswerStorage('system');
    });
    expect(mockSetAppNightMode).toHaveBeenLastCalledWith('system');

    await act(async () => {
      view.getByTestId('probe').props.onPress(); // → Dark
    });
    expect(mockSetAppNightMode).toHaveBeenLastCalledWith('dark');
  });
});
