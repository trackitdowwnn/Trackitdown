/**
 * WHAT:  Wiring tests for AppTabBar — config-driven rendering (adding a tab
 *        renders it), active mapping from navigation state, the tabPress
 *        emit/navigate contract (including preventDefault and re-tap),
 *        badge variants (dot / count / 9+), spoken labels with badges, and
 *        the hidden state driven by the focused screen's tabBarStyle.
 * WHY:   This bar is the app's spine: a wrong active mapping or a swallowed
 *        press strands navigation everywhere at once. Badge/label rules are
 *        pinned in appTabBarModel.test.ts — this file proves the component
 *        obeys them against a mocked React Navigation contract.
 * LINKS: src/shared/ui/AppTabBar.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { StyleSheet, Text, View } from 'react-native';

import { AppTabBar, type AppTabConfig, TabBadgeProvider, useTabBadges } from './AppTabBar';

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: {
      View,
      Text,
      createAnimatedComponent: (component: unknown) => component,
    },
    ZoomIn: { duration: () => ({}) },
    interpolateColor: () => '#000000',
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
  };
});

/** Stub icon: lucide icons are SVG; the component only needs a component. */
const StubIcon = (props: { color?: string }) => (
  <View>
    <Text>{props.color}</Text>
  </View>
);

const TABS: AppTabConfig[] = [
  { route: 'explore', label: 'Explore', icon: StubIcon as never },
  { route: 'my-cars', label: 'My cars', icon: StubIcon as never, badgeKey: 'myCars' },
  {
    route: 'inbox',
    label: 'Inbox',
    icon: StubIcon as never,
    badgeKey: 'inbox',
    badgeLabel: (count) => `${count} unread`,
  },
  { route: 'profile', label: 'Profile', icon: StubIcon as never },
];

function makeProps(
  tabs: AppTabConfig[],
  {
    index = 0,
    options = {},
  }: { index?: number; options?: Record<string, object> } = {},
) {
  const routes = tabs.map((tab) => ({ key: `${tab.route}-key`, name: tab.route }));
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const navigate = jest.fn();
  return {
    props: {
      state: { index, routes },
      descriptors: Object.fromEntries(
        routes.map((route) => [route.key, { options: options[route.name] ?? {} }]),
      ),
      navigation: { emit, navigate },
      insets: { top: 0, bottom: 20, left: 0, right: 0 },
    } as unknown as BottomTabBarProps,
    emit,
    navigate,
  };
}

describe('config-driven rendering', () => {
  it('renders every configured tab', async () => {
    const { props } = makeProps(TABS);
    const { getByTestId, getByText } = await render(<AppTabBar {...props} tabs={TABS} />);
    for (const tab of TABS) {
      expect(getByTestId(`app-tab-${tab.route}`)).toBeTruthy();
      expect(getByText(tab.label)).toBeTruthy();
    }
  });

  it('a fifth tab in config renders — data, not surgery', async () => {
    const withAlerts = [
      ...TABS,
      { route: 'alerts', label: 'Alerts', icon: StubIcon as never },
    ];
    const { props } = makeProps(withAlerts);
    const { getByTestId } = await render(<AppTabBar {...props} tabs={withAlerts} />);
    expect(getByTestId('app-tab-alerts')).toBeTruthy();
    expect(getByTestId('app-tab-alerts').props.accessibilityLabel).toBe(
      'Alerts, tab 5 of 5',
    );
  });

  it('routes without config (utility screens) render no item', async () => {
    const { props } = makeProps([...TABS, { route: 'secret', label: '', icon: StubIcon as never }]);
    const { queryByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    expect(queryByTestId('app-tab-secret')).toBeNull();
  });
});

describe('active state', () => {
  it('marks exactly the focused route selected', async () => {
    const { props } = makeProps(TABS, { index: 2 });
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    expect(getByTestId('app-tab-inbox').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('app-tab-explore').props.accessibilityState).toEqual({
      selected: false,
    });
  });
});

describe('press contract', () => {
  it('emits tabPress then navigates', async () => {
    const { props, emit, navigate } = makeProps(TABS);
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    await act(async () => {
      fireEvent.press(getByTestId('app-tab-inbox'));
    });
    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'inbox-key',
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith('inbox');
  });

  it('a prevented tabPress does not navigate', async () => {
    const { props, navigate } = makeProps(TABS);
    (props.navigation.emit as jest.Mock).mockReturnValue({ defaultPrevented: true });
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    await act(async () => {
      fireEvent.press(getByTestId('app-tab-inbox'));
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-tapping the active tab still emits and navigates (pop-to-root path)', async () => {
    const { props, emit, navigate } = makeProps(TABS, { index: 0 });
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    await act(async () => {
      fireEvent.press(getByTestId('app-tab-explore'));
    });
    expect(emit).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('explore');
  });
});

describe('badges', () => {
  it('a count renders the number and speaks the custom wording', async () => {
    const { props } = makeProps(TABS);
    const { getByTestId, getByText } = await render(
      <AppTabBar {...props} tabs={TABS} badges={{ inbox: 3 }} />,
    );
    expect(getByTestId('app-tab-inbox-badge')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByTestId('app-tab-inbox').props.accessibilityLabel).toBe(
      'Inbox, 3 unread, tab 3 of 4',
    );
  });

  it('counts past nine collapse to 9+', async () => {
    const { props } = makeProps(TABS);
    const { getByText } = await render(
      <AppTabBar {...props} tabs={TABS} badges={{ inbox: 42 }} />,
    );
    expect(getByText('9+')).toBeTruthy();
  });

  it('true renders a dot and announces activity', async () => {
    const { props } = makeProps(TABS);
    const { getByTestId, queryByText } = await render(
      <AppTabBar {...props} tabs={TABS} badges={{ myCars: true }} />,
    );
    expect(getByTestId('app-tab-my-cars-badge')).toBeTruthy();
    expect(queryByText('1')).toBeNull(); // dot, not a count
    expect(getByTestId('app-tab-my-cars').props.accessibilityLabel).toBe(
      'My cars, new activity, tab 2 of 4',
    );
  });

  it('zero and absent render no badge', async () => {
    const { props } = makeProps(TABS);
    const { queryByTestId } = await render(
      <AppTabBar {...props} tabs={TABS} badges={{ inbox: 0 }} />,
    );
    expect(queryByTestId('app-tab-inbox-badge')).toBeNull();
    expect(queryByTestId('app-tab-my-cars-badge')).toBeNull();
  });
});

describe('hide mechanism', () => {
  const barPointerEvents = (bar: { props: { style?: unknown } }) =>
    (StyleSheet.flatten(bar.props.style as never) as { pointerEvents?: string }).pointerEvents;

  it('the focused screen setting tabBarStyle display none disables the bar', async () => {
    const { props } = makeProps(TABS, {
      index: 2,
      options: { inbox: { tabBarStyle: { display: 'none' } } },
    });
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    expect(barPointerEvents(getByTestId('app-tab-bar'))).toBe('none');
  });

  it('an unfocused screen hiding its bar does not affect the current tab', async () => {
    const { props } = makeProps(TABS, {
      index: 0,
      options: { inbox: { tabBarStyle: { display: 'none' } } },
    });
    const { getByTestId } = await render(<AppTabBar {...props} tabs={TABS} />);
    expect(barPointerEvents(getByTestId('app-tab-bar'))).toBe('auto');
  });
});

describe('TabBadgeProvider', () => {
  function Probe() {
    const { badges, setBadge } = useTabBadges();
    return (
      <View>
        <Text testID="badge-value">{String(badges.inbox ?? 'unset')}</Text>
        <Text testID="set" onPress={() => setBadge('inbox', 5)}>
          set
        </Text>
      </View>
    );
  }

  it('screens can set and read badge values', async () => {
    const { getByTestId } = await render(
      <TabBadgeProvider>
        <Probe />
      </TabBadgeProvider>,
    );
    expect(getByTestId('badge-value').children.join('')).toBe('unset');
    await act(async () => {
      fireEvent.press(getByTestId('set'));
    });
    expect(getByTestId('badge-value').children.join('')).toBe('5');
  });
});
