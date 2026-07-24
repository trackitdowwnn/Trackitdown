/**
 * WHAT:  Tests for DistinctiveFeaturesField — rendering added pairs (labelled
 *        thumbnail + description + edit/remove), removing a pair, and the add
 *        flow (pick a photo → write a description → Add) including the
 *        description-required-once-a-photo-exists gate.
 * WHY:   A photo with no description is half-useful, so the editor must not let
 *        an orphan photo through; and remove/add must hand the parent the right
 *        ordered list. Ordering/bounds themselves are pinned in the model test.
 * LINKS: src/features/vehicles/post/components/DistinctiveFeaturesField.tsx;
 *        src/features/vehicles/post/lib/distinctiveFeatures.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { DistinctiveFeaturesField } from './DistinctiveFeaturesField';
import type { DistinctiveFeature } from '../lib/distinctiveFeatures';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockLaunchLibrary = jest.fn(async () => ({
  canceled: false,
  assets: [{ uri: 'file://picked.jpg', width: 400, height: 300 }],
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...(args as [])),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));

const feature = (n: number): DistinctiveFeature => ({
  photo: { uri: `file://m${n}.jpg`, width: 400, height: 300 },
  description: `Mark ${n}`,
});

beforeEach(() => mockLaunchLibrary.mockClear());

describe('DistinctiveFeaturesField', () => {
  it('renders each added pair as a labelled thumbnail + description', async () => {
    const { getByText, getByLabelText } = await render(
      <DistinctiveFeaturesField value={[feature(1), feature(2)]} onChange={jest.fn()} />,
    );

    expect(getByText('Mark 1')).toBeTruthy();
    // The image announces the description (colour-blind-safe / no bare image).
    expect(getByLabelText('Photo: Mark 1')).toBeTruthy();
    expect(getByLabelText('Photo: Mark 2')).toBeTruthy();
  });

  it('removes a pair, handing the parent the list without it', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <DistinctiveFeaturesField value={[feature(1), feature(2)]} onChange={onChange} />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Remove Mark 1'));
    });

    expect(onChange).toHaveBeenCalledWith([feature(2)]);
  });

  it('adds a pair only once a photo AND a valid description are present', async () => {
    const onChange = jest.fn();
    const view = await render(<DistinctiveFeaturesField value={[]} onChange={onChange} />);

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Add a feature' }));
    });

    // No photo yet → Add is disabled.
    expect(view.getByRole('button', { name: 'Add' }).props.accessibilityState?.disabled).toBe(true);

    // Pick a photo.
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Choose photo' }));
    });
    expect(mockLaunchLibrary).toHaveBeenCalledTimes(1);

    // Photo but still no description → Add stays disabled.
    expect(view.getByRole('button', { name: 'Add' }).props.accessibilityState?.disabled).toBe(true);

    // A valid description unlocks Add.
    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Description'), 'Cracked nearside wing mirror');
    });
    expect(view.getByRole('button', { name: 'Add' }).props.accessibilityState?.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Add' }));
    });

    expect(onChange).toHaveBeenCalledWith([
      {
        photo: { uri: 'file://picked.jpg', width: 400, height: 300 },
        description: 'Cracked nearside wing mirror',
      },
    ]);
  });
});
