/**
 * WHAT:  Tests that AlertsScreen reaches each of its honest states — loading,
 *        error, signed out, empty, populated, and at-cap — and that every one
 *        of them can be escaped.
 * WHY:   The single-zone screen this replaces shipped with its error and
 *        signed-out branches UNREACHABLE (a guard ordering bug), so a failing
 *        RPC looked identical to a slow one, for ever. It passed typecheck,
 *        lint and the whole unit suite; only opening the app caught it. These
 *        assertions exist so the same class of bug can't return here.
 *
 *        ⚠️ AND THE 2026-08-27 REDESIGN ADDED A SECOND CLASS OF THE SAME BUG.
 *        The error and signed-out branches were REACHABLE but rendered a bare
 *        view with no title and no back chevron — on a pushed route with
 *        headers hidden app-wide, that is a dead end with only the iOS
 *        edge-swipe out of it. `alerts-back` is now asserted in every state.
 * LINKS: ./AlertsScreen.tsx; ../hooks/useMyAlerts.ts;
 *        ../components/AlertZoneThumb.tsx (why the map is mocked below).
 */

import { fireEvent, render } from '@testing-library/react-native';

import { AlertsScreen } from './AlertsScreen';

let mockAlertsState: Record<string, unknown> = {
  status: 'ready',
  alerts: [],
  refresh: jest.fn(),
};
jest.mock('../hooks/useMyAlerts', () => ({
  useMyAlerts: () => mockAlertsState,
  invalidateMyAlerts: jest.fn(),
}));

let mockPermission: Record<string, unknown> = {
  status: { state: 'granted', canAskAgain: true },
  request: jest.fn(),
  refresh: jest.fn(),
};
jest.mock('@/features/permissions', () => ({
  useDevicePermission: () => mockPermission,
}));

// ⚠️ Hoisted, not created inside the factory. The previous version returned a
// fresh jest.fn() from every useRouter() call, so nothing about navigation
// could be asserted at all — and the at-cap test now turns on exactly that.
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  // ⚠️ A NO-OP, NOT `(effect) => effect()`. The real hook runs its callback in
  // an EFFECT; calling it during render makes AlertZoneThumb's setState a
  // render-phase update and React bails out with "Too many re-renders". The
  // thumbnail's default state is already `focused`, which is what a mounted
  // screen looks like, so running it adds nothing anyway.
  useFocusEffect: () => {},
}));

jest.mock('../api/alertsApi', () => ({
  deleteAlert: jest.fn(),
  setAlertEnabled: jest.fn(),
}));

const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({ useRequireAuth: () => mockRequireAuth }));

// ⚠️ THERE IS NO GLOBAL react-native-maps MOCK in this repo — five other suites
// hand-roll this, and without it the suite dies in the native-module layer
// rather than anywhere that names the problem. AppMapCircle must be listed too:
// AlertZoneThumb renders one.
jest.mock('@/shared/ui/AppMap', () => ({
  AppMap: 'AppMap',
  AppMapCircle: 'AppMapCircle',
}));

// The heavy UI is mocked to plain text: this suite is about which STATE the
// screen resolves to, not how any of it looks.
jest.mock('@/shared/ui', () => {
  const { Text: RNText, View: RNView } = jest.requireActual('react-native');
  return {
    // ⚠️ ONE shared spy, not a fresh jest.fn() per call — see mockPush above.
    useToast: () => ({ show: mockShowToast }),
    ErrorState: ({ title }: { title?: string }) => <RNText>{title}</RNText>,
    // Renders body and actionLabel too: the redesign's whole point is the empty
    // state's copy and its one action, and a title-only double asserts neither.
    EmptyState: ({
      title,
      body,
      actionLabel,
      onAction,
    }: {
      title?: string;
      body?: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => (
      <RNView>
        <RNText>{title}</RNText>
        {body ? <RNText>{body}</RNText> : null}
        {actionLabel ? <RNText onPress={onAction}>{actionLabel}</RNText> : null}
      </RNView>
    ),
    Button: ({ label, onPress }: { label: string; onPress?: () => void }) => (
      <RNText onPress={onPress}>{label}</RNText>
    ),
    ConfirmDialog: () => null,
    Screen: ({ children, footer }: { children?: unknown; footer?: unknown }) => (
      <RNView>
        {children}
        {footer}
      </RNView>
    ),
    StickyActionBar: ({ children }: { children?: unknown }) => <RNView>{children}</RNView>,
    NudgeRow: ({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) => (
      <RNText onPress={onPress} testID={testID}>
        {title}
      </RNText>
    ),
    BottomSheet: ({ children }: { children?: unknown }) => <RNView>{children}</RNView>,
    ListRow: ({ title, onPress, testID }: { title: string; onPress?: () => void; testID?: string }) => (
      <RNText onPress={onPress} testID={testID}>
        {title}
      </RNText>
    ),
    // The real one renders a RefreshControl, which needs a host scroll view
    // ancestor; the pull itself is exercised in useMyAlerts.test.tsx.
    ThemedRefreshControl: () => null,
    // ⚠️ This mock is hand-listed, so anything the screen newly imports from
    // the barrel arrives as undefined and fails with "Element type is invalid"
    // rather than anything naming the missing export. The real Switch, so the
    // pause toggle stays pressable and keeps its accessibilityLabel.
    AppSwitch: jest.requireActual('react-native').Switch,
  };
});

const mockShowToast = jest.fn();

const alert = (overrides: Record<string, unknown> = {}) => ({
  id: `id-${Math.random()}`,
  name: 'Home',
  latitude: 51.5,
  longitude: -0.13,
  radiusMiles: 10,
  enabled: true,
  approximate: true,
  criteria: {
    make: null,
    model: null,
    colour: null,
    bodyType: null,
    minBountyPence: null,
    recencyDays: null,
  },
  updatedAt: '2026-07-31T12:00:00Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertsState = { status: 'ready', alerts: [], refresh: jest.fn() };
  mockPermission = {
    status: { state: 'granted', canAskAgain: true },
    request: jest.fn(),
    refresh: jest.fn(),
  };
});

describe('AlertsScreen states', () => {
  it('shows a skeleton while alerts are loading', async () => {
    // ⚠️ The string survives the move from FullscreenLoader to skeleton rows,
    // but it is now an accessibilityLabel — getByText would NOT find it, and
    // that is the intended trade: no blocking overlay, still announced.
    mockAlertsState = { status: 'loading', refresh: jest.fn() };
    const { getByLabelText } = await render(<AlertsScreen />);
    expect(getByLabelText('Loading your alerts')).toBeTruthy();
  });

  it('surfaces a load failure instead of spinning forever', async () => {
    mockAlertsState = { status: 'error', refresh: jest.fn() };
    const { getByText, queryByLabelText } = await render(<AlertsScreen />);
    expect(getByText("We couldn't load your alerts")).toBeTruthy();
    expect(queryByLabelText('Loading your alerts')).toBeNull();
  });

  it('tells a guest why the list is empty, and offers the way in', async () => {
    mockAlertsState = { status: 'signedOut', refresh: jest.fn() };
    const { getByText, queryByLabelText } = await render(<AlertsScreen />);
    expect(getByText('Set the areas you watch')).toBeTruthy();
    expect(queryByLabelText('Loading your alerts')).toBeNull();

    // Every other signed-out empty state in the app offers "Log in"; this one
    // used to be a dead end with no way to fix it.
    fireEvent.press(getByText('Log in'));
    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'alert_settings' });
  });

  // ⚠️ ONE RENDER PER TEST, hence it.each rather than a loop inside one case.
  // Two renders in a single test poison every test declared after them in the
  // file — they fail with "Unable to find" against a tree that is demonstrably
  // correct, which costs an hour to diagnose from the symptom.
  //
  // Headers are hidden app-wide and this is a pushed route, so a state without
  // a back control is a dead end on Android — the second form of the bug this
  // suite was originally written to catch.
  it.each(['loading', 'error', 'signedOut', 'ready'] as const)(
    '⚠️ can be escaped from the %s state',
    async (status) => {
      mockAlertsState = { status, alerts: [], refresh: jest.fn() };
      const { getByTestId } = await render(<AlertsScreen />);
      expect(getByTestId('alerts-back')).toBeTruthy();
    },
  );

  it('invites a first alert when the list is empty', async () => {
    const { getByText } = await render(<AlertsScreen />);
    expect(getByText('No alerts yet')).toBeTruthy();
    // ⚠️ The body carries the two facts the old copy left out: how often this
    // interrupts you, and that the saved area is not your address. Losing
    // either one quietly is the failure this pins.
    expect(getByText(/a few a day at most/i)).toBeTruthy();
    expect(getByText(/rough area rather than your exact address/i)).toBeTruthy();
  });

  it('lists each alert by name with what it watches', async () => {
    mockAlertsState = {
      status: 'ready',
      alerts: [
        alert({ name: 'Home' }),
        alert({
          name: 'Work',
          radiusMiles: 25,
          criteria: {
            make: 'BMW',
            model: null,
            colour: 'Blue',
            bodyType: null,
            minBountyPence: null,
            recencyDays: null,
          },
        }),
      ],
      refresh: jest.fn(),
    };
    const { getByText } = await render(<AlertsScreen />);
    expect(getByText('Home')).toBeTruthy();
    expect(getByText('Work')).toBeTruthy();
    // The summary is what makes several alerts tellable apart — the NAME is
    // the user's own words and may say nothing useful.
    expect(getByText('10 miles · Any car')).toBeTruthy();
    expect(getByText('25 miles · Blue BMWs')).toBeTruthy();
  });

  it('⚠️ draws every alert a zone thumbnail, with or without a map', async () => {
    // The thumbnail is the redesign: five alerts used to read as five identical
    // grey text blocks. It must render with the native map mocked away, because
    // that is also what a missing API key, Expo Go and web all look like.
    const one = alert({ id: 'a1' });
    mockAlertsState = { status: 'ready', alerts: [one], refresh: jest.fn() };
    const { getByTestId } = await render(<AlertsScreen />);
    // includeHiddenElements, because the thumbnail is deliberately hidden from
    // the accessibility tree — the card already announces the alert's name and
    // its summary, and "image" between the two adds nothing.
    expect(getByTestId('alert-thumb-a1', { includeHiddenElements: true })).toBeTruthy();
  });

  it('⚠️ explains the cap instead of going dead at it', async () => {
    // It used to render a DISABLED button reading "Limit reached (5)". The
    // garage screen — whose cap of 5 this deliberately mirrors — records the
    // house rule: a dead control explains nothing. This asserts the opposite
    // contract, so do not "restore" the old one.
    mockAlertsState = {
      status: 'ready',
      alerts: [alert(), alert(), alert(), alert(), alert()],
      refresh: jest.fn(),
    };
    const { getByText } = await render(<AlertsScreen />);

    fireEvent.press(getByText('Create an alert'));

    expect(mockShowToast).toHaveBeenCalledWith(
      'You can have up to 5 alerts. Delete one to add another.',
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(getByText("That's all 5 — delete one to add another.")).toBeTruthy();
  });

  it('opens the wizard below the cap', async () => {
    mockAlertsState = { status: 'ready', alerts: [alert()], refresh: jest.fn() };
    const { getByText } = await render(<AlertsScreen />);

    fireEvent.press(getByText('Create an alert'));

    expect(mockPush).toHaveBeenCalledWith('/alerts/new');
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

describe('the permission banner', () => {
  it('offers to ask when the OS has not been asked yet', async () => {
    const request = jest.fn().mockResolvedValue({ state: 'granted', canAskAgain: false });
    mockPermission = {
      status: { state: 'denied', canAskAgain: true },
      request,
      refresh: jest.fn(),
    };
    const { getByTestId } = await render(<AlertsScreen />);

    fireEvent.press(getByTestId('alerts-permission-banner'));
    expect(request).toHaveBeenCalled();
  });

  it('⚠️ sends a blocked user to Settings instead of asking again', async () => {
    // canAskAgain false means the OS will never show a prompt again, so an
    // "allow" button would do nothing at all.
    const { Linking } = jest.requireActual('react-native');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const request = jest.fn();
    mockPermission = {
      status: { state: 'denied', canAskAgain: false },
      request,
      refresh: jest.fn(),
    };
    const { getByTestId } = await render(<AlertsScreen />);

    fireEvent.press(getByTestId('alerts-permission-banner'));
    expect(openSettings).toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it('says nothing when notifications are already on', async () => {
    const { queryByTestId } = await render(<AlertsScreen />);
    expect(queryByTestId('alerts-permission-banner')).toBeNull();
  });
});

describe('the row actions', () => {
  it('⚠️ keeps delete behind the sheet, not on the card', async () => {
    // The card used to carry a ghost "Delete" styled identically to "Edit" —
    // an irreversible action one mis-tap away on a resting surface.
    const one = alert({ id: 'a1', name: 'Home' });
    mockAlertsState = { status: 'ready', alerts: [one], refresh: jest.fn() };
    const { getByTestId } = await render(<AlertsScreen />);

    // includeHiddenElements: the controls are hidden from the a11y tree on
    // purpose — iOS folds them into the card, so the card exposes them as
    // accessibility ACTIONS instead. See the next test.
    fireEvent.press(getByTestId('alert-more-a1', { includeHiddenElements: true }));
    expect(getByTestId('alert-action-delete')).toBeTruthy();
    expect(getByTestId('alert-action-edit')).toBeTruthy();
  });

  it('⚠️ reaches pause and the sheet by screen-reader action', async () => {
    // THE iOS BUG THIS PINS. A Pressable is `accessible` by default and iOS
    // GROUPS its children into one element, so a nested Switch and a nested
    // button are simply unreachable to VoiceOver — pause and delete would work
    // on Android and not exist on iOS. The card carries them as actions.
    const one = alert({ id: 'a1', name: 'Home', enabled: true });
    mockAlertsState = { status: 'ready', alerts: [one], refresh: jest.fn() };
    const { getByTestId } = await render(<AlertsScreen />);

    const card = getByTestId('alert-row-a1');
    const actions = (card.props.accessibilityActions ?? []) as { name: string }[];
    expect(actions.map((a) => a.name)).toEqual(['pause', 'more']);
    // The pause state reaches a screen reader through the card, since the
    // switch itself is inside the grouped element.
    expect(card.props.accessibilityState).toMatchObject({ checked: true });

    fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'more' } });
    expect(getByTestId('alert-action-delete')).toBeTruthy();
  });

  it('opens the alert for editing when the card itself is pressed', async () => {
    const one = alert({ id: 'a1' });
    mockAlertsState = { status: 'ready', alerts: [one], refresh: jest.fn() };
    const { getByTestId } = await render(<AlertsScreen />);

    fireEvent.press(getByTestId('alert-row-a1'));
    expect(mockPush).toHaveBeenCalledWith('/alerts/a1');
  });

  it('shows a paused alert as paused', async () => {
    const one = alert({ id: 'a1', enabled: false });
    mockAlertsState = { status: 'ready', alerts: [one], refresh: jest.fn() };
    const { getByTestId } = await render(<AlertsScreen />);
    expect(getByTestId('alert-paused-a1')).toBeTruthy();
  });
});
