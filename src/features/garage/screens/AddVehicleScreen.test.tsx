/**
 * WHAT:  Tests for AddVehicleScreen starting a NEW car from a recovered
 *        listing (?fromPost): it seeds the wizard from the listing, and a
 *        failed read gives a blank form the owner is TOLD about.
 * WHY:   The 2026-10-27 review: the seed had no screen test, and its failure
 *        fell back to a blank wizard with no log and no word to the owner.
 * LINKS: src/features/garage/screens/AddVehicleScreen.tsx;
 *        src/features/garage/lib/vehicleAnswers.ts (postToAnswers).
 */

import { act, render } from '@testing-library/react-native';

import { AddVehicleScreen } from './AddVehicleScreen';

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }) }));

const mockFetchPostDetail = jest.fn();
jest.mock('@/features/vehicles', () => ({
  fetchPostDetail: (...args: unknown[]) => mockFetchPostDetail(...args),
}));

jest.mock('../hooks/useMyVehicles', () => ({
  useMyVehicles: () => ({ status: 'ready', vehicles: [], retry: jest.fn() }),
}));
jest.mock('../api/garageApi', () => ({ addVehicle: jest.fn(), updateVehicle: jest.fn() }));
jest.mock('../lib/addVehicleFlow', () => ({
  ADD_VEHICLE_INITIAL_ANSWERS: {},
  buildAddVehicleFlow: () => ({}),
}));
jest.mock('@/shared/lib/haptics', () => ({ successHaptic: jest.fn() }));

const mockWizard = jest.fn((_props: { initialAnswers: unknown }) => null);
jest.mock('@/shared/wizard', () => ({
  WizardScreen: (props: { initialAnswers: unknown }) => mockWizard(props),
}));

const mockShowToast = jest.fn();
// STABLE, like the real hook (its value is memoised): the seed effect depends
// on it, and a fresh object per render would re-run the fetch forever.
const mockToast = { show: (...args: unknown[]) => mockShowToast(...args) };
jest.mock('@/shared/ui', () => ({
  EmptyState: () => null,
  ErrorState: () => null,
  FullscreenLoader: () => null,
  Screen: ({ children }: { children: unknown }) => children,
  useToast: () => mockToast,
}));

const LISTING = {
  plate: 'AB12 CDE',
  make: 'BMW',
  model: '320d',
  colour: 'Blue',
  photos: [{ uri: 'https://x.supabase.co/storage/v1/object/public/post-photos/u1/a-0.jpg' }],
  distinctiveFeatures: [],
};

const lastAnswers = () => mockWizard.mock.calls.at(-1)?.[0].initialAnswers;

beforeEach(() => jest.clearAllMocks());

it('seeds a new car from the listing — and never mounts the wizard blank first', async () => {
  mockFetchPostDetail.mockResolvedValue({ kind: 'visible', post: LISTING });
  await render(<AddVehicleScreen fromPostId="p1" />);
  await act(async () => {});

  expect(mockFetchPostDetail).toHaveBeenCalledWith('p1');
  // The FIRST render already carries the seed: blank-then-reseeded would put
  // empty answers under the owner's fingers for a frame.
  expect(mockWizard.mock.calls[0]?.[0].initialAnswers).toMatchObject({
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
  });
  expect(mockShowToast).not.toHaveBeenCalled();
});

it('a failed read gives a blank form, and says so', async () => {
  mockFetchPostDetail.mockRejectedValue(new Error('network'));
  await render(<AddVehicleScreen fromPostId="p1" />);
  await act(async () => {});

  expect(lastAnswers()).toEqual({});
  expect(mockShowToast).toHaveBeenCalledWith('Couldn’t load your car’s details.', 'error');
});

it('a listing it cannot see is treated the same way', async () => {
  mockFetchPostDetail.mockResolvedValue({ kind: 'notFound' });
  await render(<AddVehicleScreen fromPostId="p1" />);
  await act(async () => {});

  expect(lastAnswers()).toEqual({});
  expect(mockShowToast).toHaveBeenCalledWith('Couldn’t load your car’s details.', 'error');
});

it('a plain add reads nothing', async () => {
  await render(<AddVehicleScreen />);
  expect(mockFetchPostDetail).not.toHaveBeenCalled();
  expect(lastAnswers()).toEqual({});
});
