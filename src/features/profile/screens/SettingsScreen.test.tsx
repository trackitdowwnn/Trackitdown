/**
 * WHAT:  Tests for the Settings screen — the Appearance chooser and the four
 *        permission rows.
 * WHY:   Two things here can go quietly wrong. The Appearance rows must bind to
 *        the stored PREFERENCE rather than the effective scheme, or "System"
 *        becomes unreachable again — which is the whole reason this screen
 *        exists. And a permission row must send the user to the right place for
 *        the state it is in: an unexplained OS dialog fired at a denied
 *        permission on Android burns their last chance to grant it.
 *
 *        A third was added with the 2026-08-26 icon rail: WHICH glyph each
 *        notification category gets. TypeScript pins that every category has
 *        one, and nothing else pins that it is not a glyph the Permissions
 *        group below is already using for something else.
 * LINKS: ./SettingsScreen.tsx; ../components/PermissionRow.tsx;
 *        src/features/permissions.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Bell, MapPin } from 'lucide-react-native';
import { Linking } from 'react-native';

import { CATEGORY_COPY } from '@/features/notifications';
import { ThemeControlsContext } from '@/shared/theme/paletteContext';
import type { ThemePreference } from '@/shared/theme';

import { CATEGORY_ICONS, SettingsScreen } from './SettingsScreen';

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

// Both mocked at the FEATURE boundary. @/features/notifications and
// @/features/auth each reach the supabase client and through it AsyncStorage,
// whose native module is null under jest — the notifications barrel carries a
// comment about exactly this.
const mockSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession(),
}));

const mockSetEnabled = jest.fn();
const mockPreferences: Record<string, boolean> = {};
// Mutable so a test can put the hook back into its pre-read state — the mock
// factory runs once, so a spy on the module would never be reached.
const mockLoading = { value: false };
jest.mock('@/features/notifications', () => ({
  ...jest.requireActual('@/features/notifications/lib/notificationPreferences'),
  useNotificationPreferences: () => ({
    preferences: mockPreferences,
    loading: mockLoading.value,
    setEnabled: (...args: unknown[]) => mockSetEnabled(...args),
  }),
}));

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
  mockSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
  mockSetEnabled.mockResolvedValue(true);
  mockLoading.value = false;
  for (const c of ['alerts', 'messages', 'my_sightings', 'money', 'watched']) {
    mockPreferences[c] = true;
  }
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

describe('Notification categories', () => {
  it('offers a switch per category, reading the stored preference', async () => {
    mockPreferences.messages = false;

    const { view } = await renderWithTheme();
    const row = await view.findByTestId('row-notify-messages');

    expect(row.props.accessibilityRole).toBe('switch');
    expect(row.props.accessibilityState).toMatchObject({ checked: false });
    expect((await view.findByTestId('row-notify-alerts')).props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('writes the category that was toggled', async () => {
    const { view } = await renderWithTheme();

    await act(async () => {
      fireEvent.press(await view.findByTestId('row-notify-money'));
    });

    expect(mockSetEnabled).toHaveBeenCalledWith('money', false);
  });

  it('⚠️ says so when the write fails, because the switch has snapped back', async () => {
    // The hook rolls the switch back on failure. Without a message the user
    // sees a control that returned to where it was for no stated reason — and
    // would reasonably believe the mute took effect.
    mockSetEnabled.mockResolvedValue(false);

    const { view } = await renderWithTheme();
    await act(async () => {
      fireEvent.press(await view.findByTestId('row-notify-alerts'));
    });

    expect(mockShowToast).toHaveBeenCalledWith('Couldn’t save that. Please try again.', 'error');
  });

  it('⚠️ says which two kinds may never be muted, as a footnote not a row', async () => {
    // Built as a ListRow first, which was wrong three ways: ListRow hands RN
    // `disabled={!pressable}` and Pressable folds that into accessibilityState,
    // so a row with no onPress is ANNOUNCED AS DIMMED — the "stuck control
    // reads as a bug" reading this text exists to avoid. It also inherited
    // numberOfLines={2}, which cut the sentence off before the half that
    // explains anything.
    const { view } = await renderWithTheme();
    const note = await view.findByTestId('notify-always-on');

    expect(note.props.accessibilityState?.disabled).toBeFalsy();
    expect(note.props.accessibilityRole).toBeUndefined();
    // The WHOLE sentence, including the half that was being clipped.
    expect(await view.findByText(/72 hours/)).toBeTruthy();
    expect(await view.findByText(/Neither can be got back if you miss it/)).toBeTruthy();
  });

  it('hides the whole group from a guest rather than showing dead switches', async () => {
    // The categories are per-account rows behind an auth-pinned RPC. Appearance
    // and the permission rows are device-local and still work.
    mockSession.mockReturnValue({ status: 'signedOut', userId: null });

    const { view } = await renderWithTheme();

    expect(view.queryByTestId('row-notify-alerts')).toBeNull();
    expect(view.queryByTestId('notify-always-on')).toBeNull();
    expect(await view.findByTestId('row-appearance-system')).toBeTruthy();
  });
});

describe('⚠️ the notification icon rail', () => {
  // The Airbnb pass (2026-08-26) gave the Notifications group the leading icon
  // rail the reference runs down every settings row. TypeScript already
  // guarantees every category HAS an icon — CATEGORY_ICONS is a total Record —
  // so these tests cover only the half it cannot: WHICH icon.

  it('gives every category its own glyph, never a shared one', async () => {
    const glyphs = Object.values(CATEGORY_ICONS);

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('⚠️ never reuses the two glyphs the Permissions group owns', async () => {
    // The reason `alerts` is Radar rather than the obvious Bell. On this one
    // screen Bell is the OS notification permission and MapPin is the OS
    // location permission, both a few rows below. Putting either against a push
    // CATEGORY as well would mean one glyph standing for two different things
    // within a single scroll — exactly the confusion a rail is meant to remove.
    // `alerts: Bell` compiles fine, so only this stops it coming back.
    const glyphs = Object.values(CATEGORY_ICONS);

    expect(glyphs).not.toContain(Bell);
    expect(glyphs).not.toContain(MapPin);
  });

  it('covers every category the screen renders', async () => {
    // Guards the widening case: if CATEGORY_ICONS ever loosens to a Partial,
    // the total-Record compile error disappears and a row renders with a bare
    // left edge that no longer lines up with the four beside it.
    expect(Object.keys(CATEGORY_ICONS).sort()).toEqual(
      CATEGORY_COPY.map((entry) => entry.category).sort(),
    );
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

describe('⚠️ before the preferences have been read', () => {
  it('does not announce a placeholder as a real switch state', async () => {
    // The switches render from the defaults so the group is never an empty
    // hole — but `toggled` drives the row's ROLE and STATE, so someone who
    // muted Messages last week was told "switch, on" while the server had it
    // off. A stale pixel is a flicker; a stale announcement is a false
    // statement.
    mockLoading.value = true;

    const { view } = await renderWithTheme();
    const row = await view.findByTestId('row-notify-messages');

    expect(row.props.accessibilityRole).not.toBe('switch');
    expect(row.props.accessibilityState?.checked).toBeUndefined();
  });
});
