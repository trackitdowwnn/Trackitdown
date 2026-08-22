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

  describe('initialCentre', () => {
    const CENTRE = { latitude: 53.48, longitude: -2.24 };

    it('opens the map there WITHOUT settling the value', async () => {
      // SAFETY: the whole point of this prop. "Where did you last see it" is a
      // claim other people act on — it drives the alert fan-out and the public
      // map — so opening the camera near the reporter must not also answer the
      // question for them. If this ever emits isSettled:true, the posting
      // wizard's Next unlocks on a point nobody chose.
      const onLocationChange = jest.fn();
      await render(
        <LocationPicker
          MapComponent={MockMap}
          initialCentre={CENTRE}
          locationServices={makeServices()}
          onLocationChange={onLocationChange}
        />,
      );

      expect(mapProps?.region).toEqual(
        expect.objectContaining({ latitude: CENTRE.latitude, longitude: CENTRE.longitude }),
      );
      expect(onLocationChange).toHaveBeenCalledWith(
        expect.objectContaining({ isSettled: false }),
      );
    });

    it('recentres when the centre arrives AFTER mount, still without settling', async () => {
      // useDefaultMapCentre opens the screen on whatever it has and may resolve
      // a real fix seconds later — "no cached fix" is not "no location". The
      // picker's `region` comes from a useState initialiser that has already
      // run, so without an explicit hand-off a late centre is silently dropped
      // and the map stays on the whole-UK view for the rest of the session.
      // That was the post wizard's last-seen bug (2026-08-22).
      const onLocationChange = jest.fn();
      const view = await render(
        <LocationPicker
          MapComponent={MockMap}
          initialCentre={null}
          locationServices={makeServices()}
          onLocationChange={onLocationChange}
        />,
      );
      expect(mapProps?.region).toEqual(UK_DEFAULT_REGION);

      await view.rerender(
        <LocationPicker
          MapComponent={MockMap}
          initialCentre={CENTRE}
          locationServices={makeServices()}
          onLocationChange={onLocationChange}
        />,
      );

      expect(mapProps?.region).toEqual(
        expect.objectContaining({ latitude: CENTRE.latitude, longitude: CENTRE.longitude }),
      );
      // SAFETY: camera only. A late GPS fix must never answer "where did you
      // last see it" on the reporter's behalf.
      expect(onLocationChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ isSettled: true }),
      );
    });

    it('a late centre does NOT move the map once a point is settled', async () => {
      // SAFETY: the gate that stops a slow GPS fix overwriting a point the
      // reporter already chose. Without it, someone who picks a street and
      // waits a moment watches the map jump to wherever their phone is.
      const settled = { latitude: 51.5, longitude: -0.12 };
      const view = await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={settled}
          initialCentre={null}
          locationServices={makeServices()}
        />,
      );
      const before = mapProps?.region;

      await view.rerender(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={settled}
          initialCentre={CENTRE}
          locationServices={makeServices()}
        />,
      );

      expect(mapProps?.region).toEqual(before);
    });

    it('lets initialLocation win, and that one DOES settle', async () => {
      const settled = { latitude: 51.5, longitude: -0.12 };
      const onLocationChange = jest.fn();
      await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={settled}
          initialCentre={CENTRE}
          locationServices={makeServices()}
          onLocationChange={onLocationChange}
        />,
      );

      expect(mapProps?.region).toEqual(
        expect.objectContaining({ latitude: settled.latitude, longitude: settled.longitude }),
      );
      expect(onLocationChange).toHaveBeenCalledWith(expect.objectContaining({ isSettled: true }));
    });

    it('still falls back to the whole-UK view when neither is given', async () => {
      await render(<LocationPicker MapComponent={MockMap} locationServices={makeServices()} />);
      expect(mapProps?.region).toEqual(UK_DEFAULT_REGION);
    });
  });

  describe('fitRadiusMiles', () => {
    const CENTRE = { latitude: 51.5, longitude: -0.12 };
    /** regionAround spans the diameter, and the picker pads by 1.3. */
    const spanFor = (miles: number) => (miles * 1.3 * 2) / 69;

    it('leaves the zoom at street level when omitted', async () => {
      // The regression guard for post-a-car and report-a-sighting, which share
      // this picker and must keep opening on a ~1km span.
      await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={CENTRE}
          locationServices={makeServices()}
        />,
      );
      expect(mapProps?.region.latitudeDelta).toBeCloseTo(0.01, 6);
    });

    it('frames the map around the radius on mount', async () => {
      await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={CENTRE}
          locationServices={makeServices()}
          fitRadiusMiles={5}
        />,
      );
      expect(mapProps?.region.latitudeDelta).toBeCloseTo(spanFor(5), 6);
    });

    it('zooms OUT when the radius grows and back IN when it shrinks', async () => {
      const { rerender } = await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={CENTRE}
          locationServices={makeServices()}
          fitRadiusMiles={5}
        />,
      );
      const atFive = mapProps!.region.latitudeDelta;

      await act(async () => {
        rerender(
          <LocationPicker
            MapComponent={MockMap}
            initialLocation={CENTRE}
            locationServices={makeServices()}
            fitRadiusMiles={50}
          />,
        );
      });
      expect(mapProps!.region.latitudeDelta).toBeGreaterThan(atFive);
      expect(mapProps!.region.latitudeDelta).toBeCloseTo(spanFor(50), 6);

      await act(async () => {
        rerender(
          <LocationPicker
            MapComponent={MockMap}
            initialLocation={CENTRE}
            locationServices={makeServices()}
            fitRadiusMiles={1}
          />,
        );
      });
      expect(mapProps!.region.latitudeDelta).toBeCloseTo(spanFor(1), 6);
    });

    it('re-frames around where the user panned to, not the original centre', async () => {
      // The circle follows the pin, so the camera must too — otherwise dragging
      // the radius after moving the map snaps you back to where you started.
      const { rerender } = await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={CENTRE}
          locationServices={makeServices()}
          fitRadiusMiles={5}
        />,
      );
      await settle({ latitude: 53.4, longitude: -2.24, latitudeDelta: 0.2, longitudeDelta: 0.2 });

      await act(async () => {
        rerender(
          <LocationPicker
            MapComponent={MockMap}
            initialLocation={CENTRE}
            locationServices={makeServices()}
            fitRadiusMiles={20}
          />,
        );
      });
      expect(mapProps!.region.latitude).toBeCloseTo(53.4, 6);
      expect(mapProps!.region.latitudeDelta).toBeCloseTo(spanFor(20), 6);
    });

    it('leaves a pinch alone until the radius actually changes', async () => {
      // Re-framing keys off the radius CHANGING, not off its current value. If
      // it re-derived the span every render it would also re-apply after each
      // onRegionChangeComplete, so a pinch would snap back the moment the
      // gesture ended — the map fighting the user rather than simply
      // overriding them at the next slider move.
      await render(
        <LocationPicker
          MapComponent={MockMap}
          initialLocation={CENTRE}
          locationServices={makeServices()}
          fitRadiusMiles={5}
        />,
      );
      await settle({ latitude: 51.5, longitude: -0.12, latitudeDelta: 0.9, longitudeDelta: 0.9 });

      expect(mapProps!.region.latitudeDelta).toBeCloseTo(0.9, 6);
    });

    it('does not re-frame the whole-UK fallback, which has no centre yet', async () => {
      // Framing 5 miles around (54, -2.5) would zoom into the Irish Sea.
      await render(
        <LocationPicker
          MapComponent={MockMap}
          locationServices={makeServices()}
          fitRadiusMiles={5}
        />,
      );
      expect(mapProps?.region).toEqual(UK_DEFAULT_REGION);
    });
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

    // The WHOLE ROW is the control, not just the Switch. A 31pt switch sat
    // under the 44pt minimum while the card looked like a big target, and the
    // title was not tappable at all — so pressing the row must toggle, and the
    // row must be the single accessible element carrying the state.
    const toggle = withSlot.getByLabelText('Use approximate area only');
    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });

    await act(async () => {
      fireEvent.press(toggle);
    });
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
