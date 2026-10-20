/**
 * WHAT:  Tests for the opening screen — the mark at the native splash's size
 *        and in its ink, on its background; nothing else on screen until a
 *        start is slow; the dissolve and its hand-back; Reduce Motion; and the
 *        launch-scheme rule.
 * WHY:   Its whole job is to be indistinguishable from the native splash at the
 *        handover and to get out of the way at the end. Both are numbers and
 *        timings that drift silently, so the inputs are pinned to their
 *        sources (app.json, markSpec.mjs) rather than to a copy of them.
 * LINKS: src/features/auth/components/BrandSplash.tsx; AuthGate.test.tsx;
 *        scripts/brand/markGeometry.drift.test.mjs (pins the ink).
 */

import { act, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MARK_INK, MARK_INK_DARK } from '@/shared/brand/markGeometry';
import { motion } from '@/shared/theme';
import { colors, darkColors } from '@/shared/theme/colors';
import { PaletteContext, ThemeControlsContext } from '@/shared/theme/paletteContext';

import appJson from '../../../../app.json';
import {
  BrandSplash,
  NATIVE_SPLASH_IMAGE_DP,
  NATIVE_SPLASH_MARK_DP,
  NATIVE_SPLASH_MARK_FILL,
} from './BrandSplash';

// Jest's CommonJS module scope; the app tsconfig carries no node types.
declare const __dirname: string;

type JsonNode = { type: string; props: Record<string, unknown>; children: unknown };

/** Every host node in the tree. (RNTL 14 dropped the UNSAFE_* by-type
 *  queries; walking toJSON is the repo's idiom — see BrandLoader.test.) */
function hostNodes(view: RenderResult): JsonNode[] {
  const nodes: JsonNode[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(walk);
    nodes.push(node as JsonNode);
    walk((node as JsonNode).children);
  };
  walk(view.toJSON());
  return nodes;
}

/** react-native-svg packs colours into an ARGB int (see BrandMark.test). */
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;
const ink = (view: RenderResult) =>
  (hostNodes(view).find((node) => node.type === 'RNSVGRect')?.props.fill as { payload: number })
    .payload;
const paint = (view: RenderResult) =>
  StyleSheet.flatten(view.getByTestId('brand-splash').props.style).backgroundColor;
/** The progress line's track: the one plain View inside the line's slot. */
const trackColour = (view: RenderResult) => {
  const track = view.getByTestId('brand-splash-progress').children[0] as unknown as JsonNode;
  return StyleSheet.flatten(track.props.style as { backgroundColor?: string }).backgroundColor;
};

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

const reducedMotion = () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- spying needs the module object
  jest.spyOn(require('react-native-reanimated'), 'useReducedMotion').mockReturnValue(true);

const splashPlugin = () =>
  appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen',
  ) as [string, { imageWidth: number; backgroundColor: string; dark: { backgroundColor: string } }];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the handover from the native splash', () => {
  it('draws the mark at the native splash’s size', async () => {
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    const [svg] = hostNodes(view).filter((node) => node.type === 'RNSVGSvgView');
    expect(svg.props.bbWidth).toBe(NATIVE_SPLASH_MARK_DP);
    expect(NATIVE_SPLASH_MARK_DP).toBeCloseTo(59.28, 2);
  });

  it('⚠️ takes its size from the same numbers the native splash is built from', () => {
    expect(splashPlugin()[1].imageWidth).toBe(NATIVE_SPLASH_IMAGE_DP);

    // Both splash PNGs (light and dark) — read as text: the spec is an ES
    // module script, not app code.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- node's fs/path; no node types here
    const fs = require('fs') as { readFileSync: (path: string, encoding: 'utf8') => string };
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- as above
    const { join } = require('path') as { join: (...parts: string[]) => string };
    const spec = fs.readFileSync(join(__dirname, '../../../../scripts/brand/markSpec.mjs'), 'utf8');
    const fills = [...spec.matchAll(/file: 'splash-icon-\w+\.png',[\s\S]*?fill: ([\d.]+)/g)].map(
      (match) => Number(match[1]),
    );
    expect(fills).toEqual([NATIVE_SPLASH_MARK_FILL, NATIVE_SPLASH_MARK_FILL]);
  });

  it('⚠️ paints the native splash’s backgrounds', () => {
    // The opening screen paints `background`; the native splash paints
    // app.json's colours. Any gap between them is a visible step.
    const [, config] = splashPlugin();
    expect(config.backgroundColor).toBe(colors.background);
    expect(config.dark.backgroundColor).toBe(darkColors.background);
  });

  it('is the mark alone — no spinner, no words', async () => {
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    const types = hostNodes(view).map((node) => node.type);
    expect(types).not.toContain('ActivityIndicator');
    expect(types).not.toContain('Text');
  });

  it('tells a screen reader the app is loading', async () => {
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    expect(view.getByLabelText('Trackitdown, loading')).toBeTruthy();
  });
});

describe('a slow start', () => {
  it('shows the progress line only once the start is slow', async () => {
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    await advance(motion.splashSlowAfter - 1);
    expect(view.queryByTestId('brand-splash-progress')).toBeNull();

    await advance(1);
    expect(view.getByTestId('brand-splash-progress')).toBeTruthy();
    expect(trackColour(view)).toBe(colors.border);
  });

  it('never shows it once the screen is leaving', async () => {
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    await view.rerender(<BrandSplash visible={false} onHidden={jest.fn()} />);
    await advance(motion.splashSlowAfter * 2);
    // Hidden elements counted: a leaving screen is hidden from screen readers,
    // so without this the null would prove nothing.
    expect(view.queryByTestId('brand-splash-progress', { includeHiddenElements: true })).toBeNull();
  });
});

describe('leaving', () => {
  it('dissolves, out of the way of touches and screen readers at once, then hands back', async () => {
    const onHidden = jest.fn();
    const view = await render(<BrandSplash visible onHidden={onHidden} />);
    const root = () => view.getByTestId('brand-splash', { includeHiddenElements: true });
    expect(root().props.pointerEvents).toBe('auto');

    await view.rerender(<BrandSplash visible={false} onHidden={onHidden} />);
    expect(root().props.pointerEvents).toBe('none');
    expect(root().props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view.queryByLabelText('Trackitdown, loading')).toBeNull();
    expect(onHidden).not.toHaveBeenCalled();

    await advance(motion.standard);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });
});

describe('Reduce Motion', () => {
  it('holds the mark still, and still dissolves — a fade moves nothing', async () => {
    reducedMotion();
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- spying needs the module object
    const reanimated = require('react-native-reanimated');
    const timing = jest.spyOn(reanimated, 'withTiming');
    const onHidden = jest.fn();
    const view = await render(<BrandSplash visible onHidden={onHidden} />);
    // No animated style on the mark — not a paused one, none.
    expect(view.getByTestId('brand-splash-mark').props.style).toBeNull();

    await view.rerender(<BrandSplash visible={false} onHidden={onHidden} />);
    // ⚠️ Opted OUT of the system setting — left to it, Reanimated would jump
    // straight to transparent, which is the cut, and the timer below could not
    // tell the difference.
    expect(timing).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        duration: motion.standard,
        reduceMotion: reanimated.ReduceMotion.Never,
      }),
    );
    await advance(motion.standard - 1);
    expect(onHidden).not.toHaveBeenCalled();
    await advance(1);
    expect(onHidden).toHaveBeenCalledTimes(1);
  });

  it('shows the line standing still, on a track strong enough to read at rest', async () => {
    reducedMotion();
    const view = await render(<BrandSplash visible onHidden={jest.fn()} />);
    await advance(motion.splashSlowAfter);
    expect(trackColour(view)).toBe(colors.borderStrong);
  });
});

describe('the scheme', () => {
  /** Render inside the app's theme, as ThemeProvider supplies it. */
  const inAppTheme = (scheme: 'light' | 'dark') => (
    <ThemeControlsContext.Provider value={{ preference: scheme, scheme, setPreference: jest.fn() }}>
      <PaletteContext.Provider value={scheme === 'dark' ? darkColors : colors}>
        <BrandSplash visible onHidden={jest.fn()} />
      </PaletteContext.Provider>
    </ThemeControlsContext.Provider>
  );

  it('⚠️ follows the theme set in the app, in the native splash’s ink', async () => {
    // Owner, 2026-10-20: "adhere to whatever theme the user has set up" — the
    // app's choice, never the phone's.
    const dark = await render(inAppTheme('dark'));
    expect(paint(dark)).toBe(darkColors.background);
    expect(ink(dark)).toBe(argb(MARK_INK_DARK));
    await dark.unmount();

    const light = await render(inAppTheme('light'));
    expect(paint(light)).toBe(colors.background);
    // The PNG's black, not `primary` — the designer's value, not UI.
    expect(ink(light)).toBe(argb(MARK_INK));
  });
});
