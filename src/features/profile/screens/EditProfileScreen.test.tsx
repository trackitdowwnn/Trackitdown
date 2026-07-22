/**
 * WHAT:  Wiring tests for EditProfileScreen — required-field validation,
 *        successful save (update + toast + back + refresh), avatar upload
 *        only when changed, inline saving state, and the signed-out guard.
 * WHY:   First name is what owners see next to sightings — an empty one
 *        slipping through weakens the trust surface; a save that silently
 *        fails loses user edits.
 * LINKS: src/features/profile/screens/EditProfileScreen.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { MyProfileState } from '../hooks/useMyProfile';
import { EditProfileScreen } from './EditProfileScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

const mockLaunchLibrary = jest.fn();
const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: () => mockGetPermission(),
  requestMediaLibraryPermissionsAsync: () => mockRequestPermission(),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));

// The blocked-photo-access primer lives in a BottomSheet; same
// visibility-aware mock as BottomSheet.test.tsx.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      this.setState({ visible: false });
      (this.props as { onDismiss?: () => void }).onDismiss?.();
    };
    render() {
      return this.state.visible ? (this.props as { children?: unknown }).children : null;
    }
  }

  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

let mockProfileState: MyProfileState & { refresh: () => void };
jest.mock('../hooks/useMyProfile', () => ({
  get useMyProfile() {
    return () => mockProfileState;
  },
}));

const mockUpdate = jest.fn();
const mockUploadAvatar = jest.fn();
jest.mock('../api/profileApi', () => ({
  get updateMyProfile() {
    return mockUpdate;
  },
  get uploadAvatar() {
    return mockUploadAvatar;
  },
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useRequireAuth: () => mockRequireAuth,
}));

const profile = {
  id: 'user-1',
  firstName: 'Ollie',
  displayName: 'Ollie B',
  avatarUrl: null,
  createdAt: '2026-05-14T09:00:00Z',
  counters: { sightingsReported: 0, sightingsHelpful: 0, recoveriesCredited: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileState = { status: 'ready', profile, refresh: jest.fn() };
  mockUpdate.mockResolvedValue(undefined);
  mockUploadAvatar.mockResolvedValue('https://example/avatar.jpg?v=1');
  mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
  mockGetPermission.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true });
});

describe('photo access permission', () => {
  it('already-blocked access opens the denied primer sheet, never the OS dialog', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: false });

    const { getByTestId, getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('edit-avatar'));
    });

    expect(getByText('Photo access is off')).toBeTruthy();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
    fireEvent.press(getByText('Open settings'));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('a fresh deny is respected silently — even when iOS reports it as canAskAgain:false', async () => {
    mockGetPermission.mockResolvedValue({ granted: false, canAskAgain: true });
    // iOS: a first-time deny already comes back canAskAgain:false.
    mockRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false });

    const { getByTestId, queryByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('edit-avatar'));
    });

    expect(queryByText('Photo access is off')).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });
});

describe('validation', () => {
  it('an empty first name blocks the save with a clear message', async () => {
    const { getByTestId, getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('field-first-name'), '   ');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    expect(getByText(/First name is required/)).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('saving', () => {
  it('saves trimmed names, refreshes, toasts, and goes back', async () => {
    const { getByTestId, getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('field-first-name'), '  Oliver ');
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('user-1', {
        firstName: 'Oliver',
        displayName: 'Ollie B',
      }),
    );
    expect(mockUploadAvatar).not.toHaveBeenCalled(); // avatar untouched
    expect(mockProfileState.refresh).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('Profile saved');
    expect(mockBack).toHaveBeenCalled();
  });

  it('uploads the avatar only when a new photo was picked', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked.jpg', width: 900, height: 900 }],
    });
    const { getByTestId, getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('edit-avatar'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    await waitFor(() =>
      expect(mockUploadAvatar).toHaveBeenCalledWith('user-1', 'file:///picked.jpg'),
    );
  });

  it('name saved but photo failed: honest toast, refresh fires, stays on screen', async () => {
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked.jpg', width: 900, height: 900 }],
    });
    mockUploadAvatar.mockRejectedValue(new Error('offline'));
    const { getByTestId, getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('edit-avatar'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Your name was saved, but the photo didn't upload — try again.",
        'error',
      ),
    );
    expect(mockProfileState.refresh).toHaveBeenCalled(); // the name DID change
    expect(mockBack).not.toHaveBeenCalled(); // retry stays one tap away
  });

  it('a failed save keeps the user on the screen with an error toast', async () => {
    mockUpdate.mockRejectedValue(new Error('offline'));
    const { getByText } = await render(<EditProfileScreen />);
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        "Couldn't save — check your connection and try again.",
        'error',
      ),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('signed out', () => {
  it('shows the calm invitation instead of the form, gated with edit_profile', async () => {
    mockProfileState = { status: 'signedOut', refresh: jest.fn() };
    const { getByText, queryByTestId } = await render(<EditProfileScreen />);
    expect(getByText('Log in to edit your profile')).toBeTruthy();
    expect(queryByTestId('field-first-name')).toBeNull();

    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'edit_profile' });
  });
});
