/**
 * WHAT:  Tests for MapRecentreButton — it never asks for permission on mount,
 *        asks exactly once when tapped from an undetermined state, never asks
 *        when the user has turned it off for good, and flies only on a real fix.
 * WHY:   "The map must never cold-fire the OS location dialog" is a standing
 *        rule in this codebase, and it is invisible in review: the difference
 *        between asking on mount and asking on press is one line, and both
 *        look identical in a screenshot. The mount assertion below is the only
 *        thing that keeps it honest.
 * LINKS: src/features/search-map/components/MapRecentreButton.tsx,
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { MapRecentreButton } from './MapRecentreButton';

type State = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let mockStatus: { state: State; canAskAgain: boolean } | null;
const mockRequest = jest.fn();
jest.mock('@/features/permissions', () => ({
  useDevicePermission: () => ({ status: mockStatus, request: mockRequest }),
}));

const mockGetPosition = jest.fn();
jest.mock('../lib/feedDeviceLocation', () => ({
  expoFeedDeviceLocation: { getCurrentPosition: () => mockGetPosition() },
}));

const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => ({ useToast: () => ({ show: mockToastShow }) }));

const COORD = { latitude: 51.75, longitude: -0.34 };

const renderButton = async (onLocate = jest.fn()) => {
  const view = await act(async () => render(<MapRecentreButton onLocate={onLocate} />));
  return { view, onLocate };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStatus = { state: 'granted', canAskAgain: false };
  mockGetPosition.mockResolvedValue(COORD);
  mockRequest.mockResolvedValue({ state: 'granted', canAskAgain: false });
});

describe('never asks without being asked', () => {
  // THE guard for the cold-fire rule.
  it('does not request permission on mount, in any state', async () => {
    for (const state of ['granted', 'denied', 'undetermined'] as State[]) {
      mockStatus = { state, canAskAgain: true };
      await renderButton();
    }

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('renders nothing until the silent check resolves — no flash', async () => {
    mockStatus = null;

    const { view } = await renderButton();

    expect(view.queryByTestId('map-recentre')).toBeNull();
  });

  it('renders nothing when there is no location module at all', async () => {
    mockStatus = { state: 'unavailable', canAskAgain: false };

    const { view } = await renderButton();

    expect(view.queryByTestId('map-recentre')).toBeNull();
  });
});

describe('tapping it', () => {
  it('flies to the fix when permission is already granted', async () => {
    const { view, onLocate } = await renderButton();

    await act(async () => {
      fireEvent.press(view.getByTestId('map-recentre'));
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(onLocate).toHaveBeenCalledWith(COORD);
  });

  it('asks once when undetermined, then flies', async () => {
    mockStatus = { state: 'undetermined', canAskAgain: true };
    const { view, onLocate } = await renderButton();

    await act(async () => {
      fireEvent.press(view.getByTestId('map-recentre'));
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(onLocate).toHaveBeenCalledWith(COORD);
  });

  it('does not fly when the user declines the prompt', async () => {
    mockStatus = { state: 'undetermined', canAskAgain: true };
    mockRequest.mockResolvedValue({ state: 'denied', canAskAgain: false });
    const { view, onLocate } = await renderButton();

    await act(async () => {
      fireEvent.press(view.getByTestId('map-recentre'));
    });

    expect(onLocate).not.toHaveBeenCalled();
    // They just chose it — telling them what they did would be noise.
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  // A repeat request shows nothing at OS level, so it would be a dead button.
  it('never re-asks when denied for good — it offers Settings instead', async () => {
    mockStatus = { state: 'denied', canAskAgain: false };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    const { view, onLocate } = await renderButton();

    await act(async () => {
      fireEvent.press(view.getByTestId('map-recentre'));
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(onLocate).not.toHaveBeenCalled();
    const [, kind, action] = mockToastShow.mock.calls[0];
    expect(kind).toBe('error');
    expect(action.label).toBe('Open settings');

    action.onPress();
    expect(openSettings).toHaveBeenCalled();
  });

  it('says so when granted but no fix arrives', async () => {
    mockGetPosition.mockResolvedValue(null);
    const { view, onLocate } = await renderButton();

    await act(async () => {
      fireEvent.press(view.getByTestId('map-recentre'));
    });

    expect(onLocate).not.toHaveBeenCalled();
    expect(mockToastShow).toHaveBeenCalledWith("Couldn't find your location.", 'error');
  });
});
