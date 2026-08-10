/**
 * WHAT:  Tests for mapPinUrl — the per-platform URL shapes, label encoding,
 *        and the rule that a label never replaces the coordinate.
 * WHY:   A malformed maps URL fails in the worst way available: it opens the
 *        maps app successfully, at the wrong place. The label-as-search trap is
 *        the specific bug guarded here — "Blue BMW" as a bare query lands the
 *        owner at some unrelated result rather than where their car was seen.
 * LINKS: src/shared/lib/mapsLink.ts, docs/TESTING.md.
 */

import { Platform } from 'react-native';

import { mapPinUrl } from './mapsLink';

describe('mapPinUrl on iOS', () => {
  beforeAll(() => {
    Platform.OS = 'ios';
  });

  it('points Apple Maps at the coordinate', () => {
    expect(mapPinUrl(51.5074, -0.1278)).toBe('maps://?ll=51.5074,-0.1278');
  });

  it('keeps the coordinate when a label is given', () => {
    const url = mapPinUrl(51.5074, -0.1278, 'Blue BMW');

    expect(url).toContain('ll=51.5074,-0.1278');
    expect(url).toContain('q=Blue%20BMW');
  });

  it('encodes a label containing URL-significant characters', () => {
    expect(mapPinUrl(1, 2, 'Ford S&B')).toContain('q=Ford%20S%26B');
  });
});

describe('mapPinUrl on Android', () => {
  beforeAll(() => {
    Platform.OS = 'android';
  });

  it('uses the geo chooser intent', () => {
    expect(mapPinUrl(51.5074, -0.1278)).toBe('geo:51.5074,-0.1278?q=51.5074,-0.1278');
  });

  it('carries the label in the q parentheses, coordinate intact', () => {
    expect(mapPinUrl(51.5074, -0.1278, 'Blue BMW')).toBe(
      'geo:0,0?q=51.5074,-0.1278(Blue%20BMW)',
    );
  });
});

describe('mapPinUrl label handling', () => {
  beforeAll(() => {
    Platform.OS = 'android';
  });

  it('treats a blank label as no label', () => {
    expect(mapPinUrl(1, 2, '   ')).toBe('geo:1,2?q=1,2');
  });

  it('handles negative and fractional coordinates without mangling the sign', () => {
    expect(mapPinUrl(-33.8688, 151.2093)).toContain('-33.8688,151.2093');
  });

  it('a caption cannot close the geo q-group and append to the URI', () => {
    // encodeURIComponent does NOT escape parens, and the Android form ends the
    // caption with ")". Captions are built from free text, so a ")" in one must
    // not be able to reach the URI grammar.
    const url = mapPinUrl(51.5, -0.1, 'Blue BMW)&q=0,0');

    expect(url).toBe('geo:0,0?q=51.5,-0.1(Blue%20BMW%26q%3D0%2C0)');
    // One q-group, one coordinate: the injected pair is inert inside it.
    expect(url.match(/\(/g)).toHaveLength(1);
    expect(url.match(/\)/g)).toHaveLength(1);
  });

  it('bounds a long caption rather than posting an essay to a URI', () => {
    const url = mapPinUrl(1, 2, 'x'.repeat(200));

    expect(url.length).toBeLessThan(80);
  });
});
