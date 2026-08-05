/**
 * WHAT:  Tests for BrandLoader — the shimmer line's composition, the phrase
 *        rotation, the message override, the reduced-motion fallback, and the
 *        single screen-reader announcement.
 * WHY:   This is the app's ONE loading face, rendered by both the cold-start
 *        splash and every blocking wait, so a regression here is a regression
 *        everywhere at once. Two properties are easy to break and invisible
 *        in review: that the shimmer never splits a WORD across a wrap (it
 *        renders per character, so only the word grouping prevents it), and
 *        that reduced motion collapses to a plain still line rather than a
 *        frozen row of per-character views. The rotation runs on an interval,
 *        so this suite uses fake timers and flushes them — leaked timers
 *        corrupt sibling suites.
 * LINKS: src/shared/ui/BrandLoader.tsx, docs/DESIGN_SYSTEM.md (Loading,
 *        Motion), jest/reanimatedMock.js (supplies useReducedMotion).
 */

import { act, render, type RenderResult } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BrandLoader, LOADER_PHRASES, splitIntoWords } from './BrandLoader';

type JsonNode = { type?: string; children?: unknown } | string | null;

/** The shimmer renders one view per character, so the line is NOT a single
 *  queryable text node — `getByText('Keeping watch…')` cannot see it. Walk the
 *  rendered tree and recompose the words the way a reader sees them. (RNTL 14
 *  dropped the UNSAFE_* by-type queries; toJSON is the repo's idiom.) */
function renderedText(view: RenderResult): string {
  const walk = (node: unknown): string => {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(walk).join('');
    return walk((node as { children?: unknown }).children);
  };
  return walk(view.toJSON());
}

/** Every host component type present in the tree — used to prove an absence. */
function renderedTypes(view: RenderResult): string[] {
  const types: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const element = node as JsonNode & { type?: string; children?: unknown };
    if (typeof element.type === 'string') types.push(element.type);
    walk(element.children);
  };
  walk(view.toJSON());
  return types;
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

describe('BrandLoader', () => {
  it('shows the wordmark and one of the waiting phrases', async () => {
    const view = await render(<BrandLoader testID="loader" />);

    expect(view.getByText('Trackitdown')).toBeTruthy();
    // Wordmark + the phrase, with the phrase spelled out one view per char.
    const rendered = renderedText(view);
    const phrase = LOADER_PHRASES.find((candidate) => rendered.endsWith(candidate));
    expect(phrase).toBeDefined();
  });

  it('rotates to a different phrase while it waits', async () => {
    const view = await render(<BrandLoader testID="loader" />);
    const first = renderedText(view);

    await act(async () => {
      jest.advanceTimersByTime(2800);
    });

    expect(renderedText(view)).not.toBe(first);
  });

  it('shows an explicit message instead of the phrases, and never rotates it', async () => {
    const view = await render(<BrandLoader testID="loader" message="Uploading photos…" />);

    expect(renderedText(view)).toContain('Uploading photos…');

    // Real information must not be swapped out for flavour after a few seconds.
    await act(async () => {
      jest.advanceTimersByTime(2800 * 3);
    });

    expect(renderedText(view)).toContain('Uploading photos…');
  });

  describe('splitIntoWords (what stops the shimmer wrapping mid-word)', () => {
    it('keeps each space attached to the word it follows', () => {
      expect(splitIntoWords('Eyes on the streets…')).toEqual([
        'Eyes ',
        'on ',
        'the ',
        'streets…',
      ]);
    });

    it('round-trips every phrase in the pool exactly', () => {
      for (const phrase of LOADER_PHRASES) {
        expect(splitIntoWords(phrase).join('')).toBe(phrase);
      }
    });

    it('never emits a group with an interior space', () => {
      for (const phrase of [...LOADER_PHRASES, 'Uploading photos…', 'Finding your area']) {
        for (const group of splitIntoWords(phrase)) {
          expect(group.slice(0, -1)).not.toContain(' ');
        }
      }
    });

    it('handles the degenerate inputs without inventing a group', () => {
      expect(splitIntoWords('')).toEqual([]);
      expect(splitIntoWords('Loading')).toEqual(['Loading']);
    });
  });

  it('announces once, as a progressbar, without spelling the line out', async () => {
    const view = await render(<BrandLoader testID="loader" message="Uploading photos…" />);

    const block = view.getByTestId('loader');
    expect(block.props.accessible).toBe(true);
    expect(block.props.accessibilityRole).toBe('progressbar');
    expect(block.props.accessibilityLabel).toBe('Trackitdown, Uploading photos…');
  });

  it('falls back to a plain still line under reduced motion', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime mock override
    const reanimated = require('react-native-reanimated');
    const spy = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const view = await render(<BrandLoader testID="loader" message="Uploading photos…" />);

    // One whole text node again — not a row of per-character views.
    expect(view.getByText('Uploading photos…')).toBeTruthy();
    spy.mockRestore();
  });

  it('sets the waiting line in bold, by FAMILY not fontWeight', async () => {
    // Weight is a family everywhere in this app: with statically loaded faces
    // `fontWeight` makes Android synthesize a fake bold over a real one.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime mock override
    const reanimated = require('react-native-reanimated');
    const spy = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- runtime token lookup
    const { typography } = require('../theme');

    const view = await render(<BrandLoader testID="loader" message="Uploading photos…" />);
    const line = view.getByText('Uploading photos…');
    const style = StyleSheet.flatten(line.props.style);

    expect(style.fontFamily).toBe(typography.cardTitle.fontFamily);
    expect(style.fontWeight).toBeUndefined();
    spy.mockRestore();
  });

  it('keeps the spinner alongside the shimmer', async () => {
    // Both, deliberately. The loader is usually on screen for under half a
    // second; the shimmer gives the wait its character, the spinner is the
    // part a glimpse that short can actually read. Removing it was tried on
    // 2026-08-06 and the absence was noticed immediately.
    const view = await render(<BrandLoader testID="loader" />);

    expect(renderedTypes(view)).toContain('ActivityIndicator');
  });
});
