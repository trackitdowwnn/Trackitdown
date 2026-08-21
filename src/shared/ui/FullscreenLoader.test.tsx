/**
 * WHAT:  Tests for FullscreenLoader — visibility toggling, the 600ms
 *        minimum-display window (instant hides don't flash), message
 *        updates while visible, and the empty-message layout.
 * WHY:   This blocks the whole app during money-critical waits; hiding too
 *        early (a flash) or failing to unmount would both read as the app
 *        breaking mid-payment. The exit runs on timers, so the suite uses
 *        fake timers and flushes them — leaked timers corrupt sibling
 *        suites (see the VehicleCard lesson).
 * LINKS: src/shared/ui/FullscreenLoader.tsx, docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';

import { LOADER_PHRASES } from './BrandLoader';
import { FullscreenLoader } from './FullscreenLoader';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Boundary mock: the loader needs animated views, fade builders (chainable
// no-ops), shared values, the reduced-motion flag, and — since the waiting
// line shimmers per character — the colour interpolation and the loop
// cancellation its cleanup calls.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.easing = () => chain;
    chain.reduceMotion = () => chain;
    chain.withCallback = () => chain;
    return chain;
  };
  const value = (initial: unknown) => ({
    value: initial,
    get: () => initial,
    set: () => {},
  });
  return {
    __esModule: true,
    default: { View, Text },
    Easing: {
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      quad: () => 0,
      sin: () => 0,
      linear: () => 0,
    },
    ReduceMotion: { System: 'system' },
    FadeIn: builder(),
    FadeOut: builder(),
    // The waiting phrases rise in from below and leave through the top.
    FadeInDown: builder(),
    FadeOutUp: builder(),
    cancelAnimation: () => {},
    interpolateColor: () => '#6A6A6A',
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: value,
    withDelay: (_delay: number, v: unknown) => v,
    withRepeat: (v: unknown) => v,
    withSequence: (...steps: unknown[]) => steps[0],
    withTiming: (v: unknown) => v,
  };
});

/** The waiting line shimmers one view PER CHARACTER, so it is not a single
 *  queryable text node — recompose what a reader actually sees. (The
 *  reduced-motion branch does render one plain Text, so the test below that
 *  covers it can still use getByText.) */
function renderedText(view: { toJSON: () => unknown }): string {
  const walk = (node: unknown): string => {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(walk).join('');
    return walk((node as { children?: unknown }).children);
  };
  return walk(view.toJSON());
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

function loader(visible: boolean, message?: string) {
  return <FullscreenLoader visible={visible} message={message} testID="loader" />;
}

describe('FullscreenLoader', () => {
  it('renders nothing until visible, then shows the mark and message', async () => {
    const view = await render(loader(false, 'Uploading photos…'));
    expect(view.queryByTestId('loader')).toBeNull();

    await act(async () => {
      view.rerender(loader(true, 'Uploading photos…'));
    });

    expect(view.getByTestId('fullscreen-loader-mark')).toBeTruthy();
    expect(renderedText(view)).toContain('Uploading photos…');
  });

  it('stays up for the 600ms minimum even when hidden immediately', async () => {
    const view = await render(loader(true));

    await act(async () => {
      view.rerender(loader(false)); // operation finished instantly
    });

    // Well inside the minimum window: still shown.
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(view.getByTestId('fullscreen-loader-mark')).toBeTruthy();

    // Past the minimum plus the exit window: gone.
    await act(async () => {
      jest.advanceTimersByTime(300 + 600);
    });
    expect(view.queryByTestId('fullscreen-loader-mark')).toBeNull();
  });

  it('exits promptly when it has already been shown long enough', async () => {
    const view = await render(loader(true));

    await act(async () => {
      jest.advanceTimersByTime(1000); // shown well past the minimum
    });
    await act(async () => {
      view.rerender(loader(false));
    });
    await act(async () => {
      jest.advanceTimersByTime(600); // just the exit window
    });

    expect(view.queryByTestId('fullscreen-loader-mark')).toBeNull();
  });

  it('cancels a pending close when shown again mid-exit', async () => {
    const view = await render(loader(true));

    await act(async () => {
      view.rerender(loader(false));
    });
    await act(async () => {
      jest.advanceTimersByTime(200); // inside the minimum window
      view.rerender(loader(true)); // a second operation starts
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(view.getByTestId('fullscreen-loader-mark')).toBeTruthy();
  });

  it('updates the message while visible', async () => {
    const view = await render(loader(true, 'Uploading photos…'));

    await act(async () => {
      view.rerender(loader(true, 'Processing payment…'));
    });

    expect(renderedText(view)).toContain('Processing payment…');
  });

  it('renders the brand face with a waiting phrase when there is no message', async () => {
    const view = await render(loader(true));

    expect(view.getByTestId('fullscreen-loader-mark')).toBeTruthy();
    // The one loading face: the mark plus one of the rotating phrases (never
    // silence — the phrase swap IS the liveness signal). The wordmark was
    // removed 2026-08-21; see BrandLoader's header for the trade.
    expect(view.queryByText('Trackitdown')).toBeNull();
    const rendered = renderedText(view);
    const phrase = LOADER_PHRASES.find((candidate) => rendered.includes(candidate));
    expect(phrase).toBeDefined();
  });

  it('renders the reduced-motion variant — one still line, no shimmer', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime mock override
    const reanimated = require('react-native-reanimated');
    const spy = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const view = await render(loader(true, 'Uploading photos…'));

    expect(view.getByTestId('fullscreen-loader-mark')).toBeTruthy();
    expect(view.getByText('Uploading photos…')).toBeTruthy();
    spy.mockRestore();
  });
});
