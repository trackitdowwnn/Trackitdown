/**
 * WHAT:  Tests for the Settings screen — the Appearance chooser and the four
 *        permission rows.
 * WHY:   Two things here can go quietly wrong. The Appearance rows must bind to
 *        the stored PREFERENCE rather than the effective scheme, or "System"
 *        becomes unreachable again — which is the whole reason this screen
 *        exists. And a permission row must send the user to the right place for
 *        the state it is in: an unexplained OS dialog fired at a denied
 *        permission on Android burns their last chance to grant it.
 * LINKS: ./SettingsScreen.tsx; ../components/PermissionRow.tsx;
 *        src/features/permissions.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { ThemeControlsContext } from '@/shared/theme/paletteContext';
import type { ThemePreference } from '@/shared/theme';

import { SettingsScreen } from './SettingsScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: jest.fn(),
    canGoBack: () => true,
  }),
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

// Mocked at the FEATURE boundary (the AlertsScreen precedent), which also
// sidesteps useDevicePermission's internal useFocusEffect.
const mockRequest = jest.fn();
const mockStatuses: Record<string, { state: string; canAskAgain: boolean } | null> = {};
jest.mock('@/features/permissions', () => ({
  useDevicePermission: (kind: string) => ({
    status: mockStatuses[kind] ?? null,
    request: (...args: unknown[]) => mockRequest(kind, ...args),
    refresh: jest.fn(),
  }),
}));

/** Renders with a real setter so the Appearance choice can be asserted — the
 *  defaulted context's setPreference is a __DEV__ console.warn no-op. */
async function renderWithTheme(preference: ThemePreference = 'system') {
  const setPreference = jest.fn();
  const view = await render(
    <ThemeControlsContext.Provider value={{ preference, scheme: 'light', setPreference }}>
      <SettingsScreen />
    </ThemeControlsContext.Provider>,
  );
  return { view, setPreference };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  for (const kind of ['notifications', 'location', 'camera', 'photos']) {
    mockStatuses[kind] = { state: 'granted', canAskAgain: false };
  }
});

describe('Appearance', () => {
  it('⚠️ offers System, which the old two-state switch could not reach', async () => {
    // The point of the screen. Bound to `preference`, a real three-state union;
    // the switch it replaced was bound to `scheme`, which has no value meaning
    // "follow the phone" — so once flipped there was no way back.
    const { view } = await renderWithTheme('system');
    const row = await view.findByTestId('row-appearance-system');

    expect(row.props.accessibilityRole).toBe('radio');
    // `selected`, not `checked` — ListRow's deliberate split: "radio,
    // selected" reads as this-one-of-several, while `checked` is reserved for
    // switch rows. Asserted the wrong way round first.
    expect(row.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('marks exactly one choice, and it is the stored preference', async () => {
    const { view } = await renderWithTheme('dark');

    expect((await view.findByTestId('row-appearance-dark')).props.accessibilityState).toMatchObject(
      { selected: true },
    );
    // `false`, never undefined — a radio group where the others are silent
    // leaves a screen reader with one row claiming nothing.
    expect(
      (await view.findByTestId('row-appearance-system')).props.accessibilityState,
    ).toMatchObject({ selected: false });
    expect((await view.findByTestId('row-appearance-light')).props.accessibilityState).toMatchObject(
      { selected: false },
    );
  });

  it('stores the choice that was tapped', async () => {
    const { view, setPreference } = await renderWithTheme('system');

    fireEvent.press(await view.findByTestId('row-appearance-dark'));
    expect(setPreference).toHaveBeenCalledWith('dark');

    fireEvent.press(await view.findByTestId('row-appearance-system'));
    expect(setPreference).toHaveBeenCalledWith('system');
  });
});

describe('Permissions', () => {
  it('says what each permission currently allows', async () => {
    mockStatuses.notifications = { state: 'granted', canAskAgain: false };
    mockStatuses.location = { state: 'denied', canAskAgain: false };
    mockStatuses.camera = { state: 'undetermined', canAskAgain: true };
    mockStatuses.photos = { state: 'unavailable', canAskAgain: false };

    const { view } = await renderWithTheme();

    expect(await view.findByText('Allowed')).toBeTruthy();
    expect(await view.findByText('Not allowed')).toBeTruthy();
    expect(await view.findByText('Not set')).toBeTruthy();
  });

  it('⚠️ prompts only when the permission has never been asked', async () => {
    // iOS does not list an app's permission until it has been requested once,
    // so deep-linking an `undetermined` permission is a dead end.
    mockStatuses.camera = { state: 'undetermined', canAskAgain: true };
    mockRequest.mockResolvedValue({ state: 'granted', canAskAgain: false });

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-permission-camera'));
    });

    expect(mockRequest).toHaveBeenCalledWith('camera');
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });

  it('⚠️ sends a DENIED permission to the OS settings, never to a bare dialog', async () => {
    // Diverges from the house `canAskAgain` rule on purpose: every other site
    // that re-prompts does so from behind a PermissionPrimer that has just
    // explained why. A settings row has no primer, and on Android a second
    // refusal is permanent — so an unexplained dialog here spends the user's
    // last chance for nothing.
    mockStatuses.location = { state: 'denied', canAskAgain: true };

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-permission-location'));
    });

    expect(Linking.openSettings).toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a granted permission still opens settings, because only the OS can revoke', async () => {
    mockStatuses.notifications = { state: 'granted', canAskAgain: false };

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-permission-notifications'));
    });

    expect(Linking.openSettings).toHaveBeenCalled();
  });

  it('⚠️ shows no value and does nothing while the first check is in flight', async () => {
    // `status` is null until the silent check resolves. Showing "Not set" and
    // correcting it a beat later would be the screen guessing out loud.
    mockStatuses.photos = null;

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-permission-photos'));
    });

    expect(mockRequest).not.toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled();
  });

  it('omits a permission the platform does not have', async () => {
    // Degrade by omission — a row reading "Unavailable" is an apology for a
    // platform the user is not on.
    mockStatuses.camera = { state: 'unavailable', canAskAgain: false };

    const { view } = await renderWithTheme();

    expect(view.queryByTestId('row-permission-camera')).toBeNull();
    expect(await view.findByTestId('row-permission-location')).toBeTruthy();
  });

  it('says so rather than failing silently when settings will not open', async () => {
    jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no activity'));
    mockStatuses.location = { state: 'denied', canAskAgain: false };

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-permission-location'));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Couldn’t open your phone’s settings.', 'error');
  });
});
