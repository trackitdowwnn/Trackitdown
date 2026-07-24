/**
 * WHAT:  Tests for MapSearchPill — the placeholder vs active-summary states
 *        and that the body opens the surface while the × clears the search.
 * WHY:   The pill is the map's search entry AND its active-filter readout; a
 *        wiring slip would either trap the user in a filter (no ×) or lose the
 *        summary.
 * LINKS: src/features/search-map/components/MapSearchPill.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { MapSearchPill } from './MapSearchPill';

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
    expect(onPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.press(getByLabelText('Clear search'));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
