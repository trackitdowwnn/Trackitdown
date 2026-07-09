/**
 * WHAT:  Tests for LocationPicker — the debounced settle→reverse-geocode path,
 *        onLocationChange payloads (including the isSettled validity flip), the
 *        geocode-failure fallback that keeps the value valid, initialLocation vs
 *        the UK default region, search selection re-centring the map, and the
 *        option-slot visibility rule.
 * WHY:   This component records "where the car was last seen" and the spotter's
 *        alert location. Emitting an un-settled value (letting a never-touched
 *        map submit) or dropping the value on a geocode hiccup would corrupt a
 *        post or block someone mid-report — the behaviours worth locking down.
 * LINKS: src/shared/ui/LocationPicker.tsx, src/shared/types/location.ts,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { LocationServices } from '../types';
import { LocationPicker, UK_DEFAULT_REGION, type MapComponentProps } from './LocationPicker';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Same visibility-aware gorhom boundary the BottomSheet/DateTimeField suites
// use, so the search sheet's open()/close() actually gate its children.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    wedged = false;
    present = () => {
      if (this.wedged) return;
      this.setState({ visible: true });
    };
    dismiss = () => {
      if (!this.state.visible) {
        this.wedged = true;
        return;
      }
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

// Component-internal debounce windows (kept in sync with LocationPicker.tsx).
const GEOCODE_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 300;

// The injected map renders nothing but captures its latest props so tests can
// drive user pans (onRegionChangeStart/Complete) and read the controlled region.
let mapProps: MapComponentProps | null = null;
function MockMap(props: MapComponentProps) {
  mapProps = props;
  return null;
}

const PROMPT = 'Move the map to the last place you saw it';
const pillLabel = (address: string) => `Location, ${address}, opens search`;

const SETTLED_REGION = {
  latitude: 51.5,
  longitude: -0.12,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

/** A LocationServices double with per-method control. */
function makeServices(overrides: Partial<LocationServices> = {}): LocationServices {
  return {
    reverseGeocode: jest.fn(async () => null),
    forwardGeocode: jest.fn(async () => []),
    getCurrentPosition: jest.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  mapProps = null;
  jest.useFakeTimers();
});

afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

async function settle(region = SETTLED_REGION) {
  await act(async () => {
    mapProps?.onRegionChangeStart();
  });
  await act(async () => {
    mapProps?.onRegionChangeComplete(region);
  });
}

describe('LocationPicker', () => {
  it('reverse-geocodes the settled centre once, after the debounce', async () => {
    const reverseGeocode = jest.fn(async () => 'Shenley Rd, Hemel Hempstead, HP2 7RJ');
    const services = makeServices({ reverseGeocode });
    const { getByText } = await render(
      <LocationPicker MapComponent={MockMap} locationServices={services} />,
    );

    await settle();
    expect(reverseGeocode).not.toHaveBeenCalled(); // still inside the debounce

    await act(async () => {
      jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS);
    });

    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    expect(reverseGeocode).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: SETTLED_REGION.latitude, longitude: SETTLED_REGION.longitude }),
    );
    expect(getByText('Shenley Rd, Hemel Hempstead, HP2 7RJ')).toBeTruthy();
  });

  it('emits isSettled false for the default region, then true once settled', async () => {
    const onLocationChange = jest.fn();
    await render(
      <LocationPicker
        MapComponent={MockMap}
        locationServices={makeServices()}
        onLocationChange={onLocationChange}
      />,
    );

    // First emission: the untouched UK default is NOT settled (Next stays off).
    expect(onLocationChange).toHaveBeenCalledWith(
      expect.objectContaining({ isSettled: false }),
    );

    await settle();

    expect(onLocationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isSettled: true,
        latitude: SETTLED_REGION.latitude,
        longitude: SETTLED_REGION.longitude,
      }),
    );
  });

  it('keeps the value valid and shows the pin fallback when geocoding fails', async () => {
    const reverseGeocode = jest.fn(async () => {
      throw new Error('network down');
    });
    const onLocationChange = jest.fn();
    const { getByText } = await render(
      <LocationPicker
        MapComponent={MockMap}
        locationServices={makeServices({ reverseGeocode })}
        onLocationChange={onLocationChange}
      />,
    );

    await settle();
    await act(async () => {
      jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS);
    });

    expect(getByText('Pin location will be used')).toBeTruthy();
    // A hiccup must never block the post: the value stays settled (valid).
    expect(onLocationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isSettled: true, addressLabel: '' }),
    );
  });

  it('starts settled and centred on initialLocation, geocoding it', async () => {
    const reverseGeocode = jest.fn(async () => 'Home, London');
    const onLocationChange = jest.fn();
    const initial = { latitude: 51.507, longitude: -0.128 };
    const { getByText } = await render(
      <LocationPicker
        MapComponent={MockMap}
        initialLocation={initial}
        locationServices={makeServices({ reverseGeocode })}
        onLocationChange={onLocationChange}
      />,
    );

    expect(mapProps?.region).toEqual(
      expect.objectContaining({ latitude: initial.latitude, longitude: initial.longitude }),
    );
    expect(onLocationChange).toHaveBeenCalledWith(expect.objectContaining({ isSettled: true }));

    await act(async () => {
      jest.advanceTimersByTime(GEOCODE_DEBOUNCE_MS);
    });
    expect(getByText('Home, London')).toBeTruthy();
  });

  it('falls back to the whole-UK region with no initialLocation', async () => {
    await render(<LocationPicker MapComponent={MockMap} locationServices={makeServices()} />);
    expect(mapProps?.region).toEqual(UK_DEFAULT_REGION);
  });

  it('re-centres the map on a picked search result', async () => {
    const result = { latitude: 52.2, longitude: -0.9, label: 'Valley Green, Milton Keynes' };
    const forwardGeocode = jest.fn(async () => [result]);
    const onLocationChange = jest.fn();
    const { getByLabelText, getByText } = await render(
      <LocationPicker
        MapComponent={MockMap}
        locationServices={makeServices({ forwardGeocode })}
        onLocationChange={onLocationChange}
      />,
    );

    // Open search from the pill (the accessible path).
    await act(async () => {
      fireEvent.press(getByLabelText(pillLabel(PROMPT)));
    });

    await act(async () => {
      fireEvent.changeText(getByLabelText('Search'), 'valley green');
    });
    await act(async () => {
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(forwardGeocode).toHaveBeenCalledWith('valley green');

    await act(async () => {
      fireEvent.press(getByText('Valley Green, Milton Keynes'));
    });

    expect(mapProps?.region).toEqual(
      expect.objectContaining({ latitude: result.latitude, longitude: result.longitude }),
    );
    expect(onLocationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ isSettled: true, addressLabel: result.label }),
    );
  });

  it('shows the option card only when optionSlot is provided', async () => {
    const withoutSlot = await render(
      <LocationPicker MapComponent={MockMap} locationServices={makeServices()} />,
    );
    expect(withoutSlot.queryByLabelText('Use approximate area only')).toBeNull();

    const onValueChange = jest.fn();
    const withSlot = await render(
      <LocationPicker
        MapComponent={MockMap}
        locationServices={makeServices()}
        optionSlot={{
          title: 'Use approximate area only',
          caption: 'alerts still work, your exact home stays private',
          value: false,
          onValueChange,
        }}
      />,
    );

    const toggle = withSlot.getByLabelText('Use approximate area only');
    expect(toggle).toBeTruthy();
    await act(async () => {
      fireEvent(toggle, 'valueChange', true);
    });
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
