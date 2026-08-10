/**
 * WHAT:  Tests for MapSearchPill — the placeholder vs active-summary states,
 *        that the body opens the surface with its MEASURED window rect, and
 *        that the × clears the search.
 * WHY:   The pill is the map's search entry AND its active-filter readout; a
 *        wiring slip would either trap the user in a filter (no ×) or lose the
 *        summary. The rect is asserted because it is what SearchSheet morphs
 *        from — omitting it doesn't fail loudly, it just makes the surface
 *        vanish on close instead of animating (the 2026-08-10 fix).
 * LINKS: src/features/search-map/components/MapSearchPill.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { MapSearchPill } from './MapSearchPill';

const PILL_RECT = { x: 16, y: 60, width: 320, height: 48 };

// React Native's jest mock gives host components a measureInWindow that exists
// but never invokes its callback — so without this stub the pill's onPress
// (which fires FROM that callback) would silently never run, and the test would
// be asserting against a dead button rather than a wiring bug.
beforeAll(() => {
  jest
    .spyOn(View.prototype as unknown as { measureInWindow: () => void }, 'measureInWindow')
    .mockImplementation(function measureInWindow(
      ...args: unknown[]
    ) {
      const callback = args[0] as (x: number, y: number, w: number, h: number) => void;
      callback(PILL_RECT.x, PILL_RECT.y, PILL_RECT.width, PILL_RECT.height);
    } as never);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('MapSearchPill', () => {
  it('shows the placeholder and no clear button when nothing is active', async () => {
    const { getByText, queryByLabelText } = await render(
      <MapSearchPill summary={null} onPress={jest.fn()} onClear={jest.fn()} />,
    );
    expect(getByText('Search make or model')).toBeTruthy();
    expect(queryByLabelText('Clear search')).toBeNull();
  });

  it('shows the summary and a clear button when a search is active', async () => {
    const { getByText, getByLabelText } = await render(
      <MapSearchPill summary="Blue BMW · £500+" onPress={jest.fn()} onClear={jest.fn()} />,
    );
    expect(getByText('Blue BMW · £500+')).toBeTruthy();
    expect(getByLabelText('Clear search')).toBeTruthy();
  });

  it('opens on body press and clears on the ×', async () => {
    const onPress = jest.fn();
    const onClear = jest.fn();
    const { getByLabelText } = await render(
      <MapSearchPill summary="Blue BMW" onPress={onPress} onClear={onClear} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Search: Blue BMW. Edit search'));
    });
    // The MEASURED rect, not just "it fired": SearchSheet morphs out of this
    // rect and back into it, and a pill that opened the surface without one
    // would close with no animation at all — which is what this screen did
    // before 2026-08-10.
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(PILL_RECT);

    await act(async () => {
      fireEvent.press(getByLabelText('Clear search'));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
