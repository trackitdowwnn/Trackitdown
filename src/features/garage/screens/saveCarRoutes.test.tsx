/**
 * WHAT:  Tests for the two route files behind "save it to My cars" after a
 *        recovery: /recover-post raises the offer only once the success toast
 *        has had its time, and /add-vehicle hands ?fromPost to the screen.
 * WHY:   The 2026-10-27 review: both wirings lived in route files with no test,
 *        so the offer could fire at once (over the refund toast) or the seed
 *        could be dropped with every other test green.
 *        Lives here, not in src/app/: anything under src/app/ becomes an Expo
 *        Router route (the guestTabs.test.tsx precedent).
 * LINKS: src/app/recover-post.tsx; src/app/add-vehicle.tsx.
 */

import { render } from '@testing-library/react-native';

import AddVehicleRoute from '../../../app/add-vehicle';
import RecoverPostRoute from '../../../app/recover-post';

let mockParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));

const mockRequestSaveCarNudge = jest.fn();
const mockAddVehicleScreen = jest.fn((_props: unknown) => null);
jest.mock('@/features/garage', () => ({
  requestSaveCarNudge: (...args: unknown[]) => mockRequestSaveCarNudge(...args),
  AddVehicleScreen: (props: unknown) => mockAddVehicleScreen(props),
}));

let mockOnRecovered: ((toastMs: number) => void) | undefined;
jest.mock('@/features/vehicles', () => ({
  RecoverPostScreen: ({ onRecovered }: { onRecovered?: (toastMs: number) => void }) => {
    mockOnRecovered = onRecovered;
    return null;
  },
}));

jest.mock('@/shared/lib', () => ({ NO_BOUNTY_PARAM: 'none' }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockOnRecovered = undefined;
});

afterEach(() => jest.useRealTimers());

it('/recover-post offers "save it to My cars" only after the toast has been read', async () => {
  mockParams = { postId: 'p1', bounty: '25000' };
  await render(<RecoverPostRoute />);

  mockOnRecovered?.(3000);
  jest.advanceTimersByTime(2999);
  expect(mockRequestSaveCarNudge).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(mockRequestSaveCarNudge).toHaveBeenCalledWith({ source: 'recovered', postId: 'p1' });
});

it('/add-vehicle hands ?fromPost to the screen as fromPostId', async () => {
  mockParams = { fromPost: 'p1' };
  await render(<AddVehicleRoute />);
  expect(mockAddVehicleScreen).toHaveBeenCalledWith({ fromPostId: 'p1' });
});
