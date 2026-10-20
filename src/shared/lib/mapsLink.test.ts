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

import { googleMapsPinUrl, mapPinUrl, wazePinUrl } from './mapsLink';

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

// 2026-10-20: the owner's sighting page opens the point in Google Maps or
// Waze by name. Both must stay a PIN (SECURITY_AND_TRUST §1).
describe('googleMapsPinUrl and wazePinUrl', () => {
  it('opens Google Maps on a search pin at the point', () => {
    expect(googleMapsPinUrl(53.4794, -2.2453)).toBe(
      'https://www.google.com/maps/search/?api=1&query=53.479400,-2.245300',
    );
  });

  it('opens Waze on the place — never starting a drive', () => {
    expect(wazePinUrl(53.4794, -2.2453)).toBe('waze://?ll=53.479400,-2.245300');
  });

  it('⚠️ opens Waze through its app scheme — never the web link that falls back to directions', () => {
    // waze.com/ul without the app redirects to waze.com/live-map/directions.
    expect(wazePinUrl(1, 2)).not.toMatch(/^https?:/);
  });

  it('rounds to six places and carries no label — nothing about the car or the person', () => {
    const urls = [
      googleMapsPinUrl(51.123456789, -0.987654321),
      wazePinUrl(51.123456789, -0.987654321),
    ];
    for (const url of urls) {
      expect(url).toContain('51.123457,-0.987654');
      expect(url).not.toMatch(/[()]|q=.*[a-zA-Z]{3,}/);
    }
  });

  it('⚠️ never emits a navigation form (§1: a pin, never directions)', () => {
    for (const url of [googleMapsPinUrl(1, 2), wazePinUrl(1, 2)]) {
      expect(url).not.toMatch(/navigate=|daddr=|google\.navigation|\/dir\b|\/dir\//);
    }
  });
});
