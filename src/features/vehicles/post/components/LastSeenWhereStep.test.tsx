/**
 * WHAT:  Tests for the post wizard's last-seen map step: it holds its quiet
 *        placeholder until BOTH its opening centre is known and the move
 *        that brought it in has finished, and a settled pin starts the
 *        place-label lookup that the step's Next will need.
 * WHY:   2026-10-08 ("janky, slow and not smooth"): a native map mounting in
 *        the middle of the transition cost it its frames, and Next on this
 *        step waited on a reverse-geocode with no head start.
 * LINKS: ./postSteps.tsx (LastSeenWhereStep);
 *        src/shared/lib/location/placeLabels.ts (warmPlaceLabels);
 *        src/shared/lib/location/useDefaultMapCentre.ts.
 */

import { act, render } from '@testing-library/react-native';

import type { PostACarAnswers } from '../types';
import { LastSeenWhereStep } from './postSteps';

type PickerProps = {
  onLocationChange: (value: {
    isSettled: boolean;
    latitude: number;
    longitude: number;
    addressLabel?: string;
  }) => void;
};
let mockPickerProps: PickerProps | null = null;
jest.mock('@/shared/ui', () => ({
  ...jest.requireActual('@/shared/ui'),
  LocationPicker: (props: PickerProps) => {
    mockPickerProps = props;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
    const { Text: MockText } = require('react-native');
    return <MockText testID="map">map</MockText>;
  },
}));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
// The step file's other steps reach the network (reward guidance); this one doesn't.
jest.mock('@/shared/api', () => ({ supabase: {} }));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({ expoLocationServices: {} }));

let mockCentre: { status: 'resolving' | 'ready'; centre: null } = { status: 'ready', centre: null };
jest.mock('@/shared/lib/location/useDefaultMapCentre', () => ({
  useDefaultMapCentre: () => mockCentre,
}));
const mockWarm = jest.fn();
jest.mock('@/shared/lib/location/placeLabels', () => ({
  warmPlaceLabels: (coord: unknown) => mockWarm(coord),
}));
const mockWarmGuidance = jest.fn();
jest.mock('../api/bountyGuidanceApi', () => ({
  warmBountyGuidance: (lat: number, lng: number) => mockWarmGuidance(lat, lng),
}));

function renderStep(settled: boolean) {
  return render(
    <LastSeenWhereStep
      answers={{} as Partial<PostACarAnswers>}
      setAnswers={jest.fn()}
      settled={settled}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPickerProps = null;
  mockCentre = { status: 'ready', centre: null };
});

describe('LastSeenWhereStep', () => {
  it('holds its placeholder until the move that brought it in has finished', async () => {
    const view = await renderStep(false);
    expect(view.queryByTestId('map')).toBeNull();

    await act(async () => {
      view.rerender(
        <LastSeenWhereStep answers={{}} setAnswers={jest.fn()} settled />,
      );
    });
    expect(view.getByTestId('map')).toBeTruthy();
  });

  it('…and until its opening centre is known', async () => {
    mockCentre = { status: 'resolving', centre: null };
    const view = await renderStep(true);
    expect(view.queryByTestId('map')).toBeNull();
  });

  const SETTLED = {
    isSettled: true,
    latitude: 53.4,
    longitude: -2.2,
    addressLabel: 'Deansgate, Manchester',
  };

  it('a pin that has RESTED starts the place lookup Next will need', async () => {
    jest.useFakeTimers();
    try {
      await renderStep(true);
      await act(async () => mockPickerProps?.onLocationChange(SETTLED));
      expect(mockWarm).not.toHaveBeenCalled(); // not on every settle of a pan
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(mockWarm).toHaveBeenCalledWith({ latitude: 53.4, longitude: -2.2 });
      // NOT the reward guidance: that is a server call, and waits for the
      // owner to confirm the point (the flow's onContinue — security review
      // of #143).
      expect(mockWarmGuidance).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a pin moved again before resting starts nothing (the picker already geocodes each settle)', async () => {
    jest.useFakeTimers();
    try {
      await renderStep(true);
      await act(async () => mockPickerProps?.onLocationChange(SETTLED));
      await act(async () =>
        mockPickerProps?.onLocationChange({ isSettled: false, latitude: 53.41, longitude: -2.2 }),
      );
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(mockWarm).not.toHaveBeenCalled();
      expect(mockWarmGuidance).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a pin still moving starts nothing', async () => {
    await renderStep(true);
    await act(async () => {
      mockPickerProps?.onLocationChange({ isSettled: false, latitude: 53.4, longitude: -2.2 });
    });
    expect(mockWarm).not.toHaveBeenCalled();
    expect(mockWarmGuidance).not.toHaveBeenCalled();
  });
});

