/**
 * WHAT:  Tests that AlertsScreen reaches each of its honest states — loading,
 *        error, signed out, empty, populated, and at-cap.
 * WHY:   The single-zone screen this replaces shipped with its error and
 *        signed-out branches UNREACHABLE (a guard ordering bug), so a failing
 *        RPC looked identical to a slow one, for ever. It passed typecheck,
 *        lint and the whole unit suite; only opening the app caught it. These
 *        assertions exist so the same class of bug can't return here.
 * LINKS: ./AlertsScreen.tsx; ../hooks/useMyAlerts.ts.
 */

import { render } from '@testing-library/react-native';

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

jest.mock('@/features/permissions', () => ({
  useDevicePermission: () => ({
    status: { state: 'granted', canAskAgain: true },
    request: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

jest.mock('../api/alertsApi', () => ({
  deleteAlert: jest.fn(),
  setAlertEnabled: jest.fn(),
}));

// The heavy UI is mocked to plain text: this suite is about which STATE the
// screen resolves to, not how any of it looks.
jest.mock('@/shared/ui', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return {
    useToast: () => ({ show: jest.fn() }),
    FullscreenLoader: ({ message }: { message?: string }) => <RNText>{message}</RNText>,
    ErrorState: ({ title }: { title?: string }) => <RNText>{title}</RNText>,
    EmptyState: ({ title }: { title?: string }) => <RNText>{title}</RNText>,
    Button: ({ label }: { label: string }) => <RNText>{label}</RNText>,
    PermissionPrimer: () => null,
    ConfirmDialog: () => null,
    // The real one renders a RefreshControl, which needs a host scroll view
    // ancestor; the pull itself is exercised in useMyAlerts.test.tsx.
    ThemedRefreshControl: () => null,
  };
});

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
});

describe('AlertsScreen states', () => {
  it('shows the loader while alerts are loading', async () => {
    mockAlertsState = { status: 'loading', refresh: jest.fn() };
    const { getByText } = await render(<AlertsScreen />);
    expect(getByText('Loading your alerts')).toBeTruthy();
  });

  it('surfaces a load failure instead of spinning forever', async () => {
    mockAlertsState = { status: 'error', refresh: jest.fn() };
    const { getByText, queryByText } = await render(<AlertsScreen />);
    expect(getByText("We couldn't load your alerts")).toBeTruthy();
    expect(queryByText('Loading your alerts')).toBeNull();
  });

  it('tells a guest why the list is empty instead of spinning forever', async () => {
    mockAlertsState = { status: 'signedOut', refresh: jest.fn() };
    const { getByText, queryByText } = await render(<AlertsScreen />);
    expect(getByText('Set the areas you watch')).toBeTruthy();
    expect(queryByText('Loading your alerts')).toBeNull();
  });

  it('invites a first alert when the list is empty', async () => {
    const { getByText } = await render(<AlertsScreen />);
    expect(getByText('No alerts yet')).toBeTruthy();
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

  it('blocks creating a sixth alert and says why', async () => {
    mockAlertsState = {
      status: 'ready',
      alerts: [alert(), alert(), alert(), alert(), alert()],
      refresh: jest.fn(),
    };
    const { getByText, queryByText } = await render(<AlertsScreen />);
    expect(getByText('Limit reached (5)')).toBeTruthy();
    expect(queryByText('Create an alert')).toBeNull();
  });
});
