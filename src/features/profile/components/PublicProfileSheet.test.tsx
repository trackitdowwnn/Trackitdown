/**
 * WHAT:  THE SAFETY TEST for PublicProfileSheet — the passport sheet shows
 *        first name, member-since, and reputation (stat column + earned
 *        emblems), and NOTHING else: even when handed an object smuggling
 *        extra fields (surname-bearing display_name, location, contact),
 *        none of them render — and the spotter's own next-badge progress
 *        never shows to owners.
 * WHY:   Spotter identity shown to owners is a hard privacy boundary
 *        (docs/SECURITY_AND_TRUST §1: first name + reputation only). This
 *        test asserts ABSENCE — the part a visual check can't prove.
 * LINKS: src/features/profile/components/PublicProfileSheet.tsx;
 *        src/features/profile/types.ts (PublicProfile SAFETY note).
 */

import { act, render } from '@testing-library/react-native';
import { createRef } from 'react';

import type { BottomSheetRef } from '@/shared/ui';

import type { PublicProfile } from '../types';
import { PublicProfileSheet } from './PublicProfileSheet';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useRef } = require('react');
  return {
    __esModule: true,
    default: { View, Text, createAnimatedComponent: (c: unknown) => c },
    Easing: { out: (fn: unknown) => fn, cubic: () => 0 },
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => true,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    withTiming: (value: unknown) => value,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => this.setState({ visible: false });
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

// A profile as an ATTACKER'S data layer might supply it: the permitted
// fields plus everything that must never reach the screen.
const leakyProfile = {
  firstName: 'Sam',
  avatarUrl: null,
  createdAt: '2026-03-01T00:00:00Z',
  counters: { sightingsReported: 5, sightingsHelpful: 2, recoveriesCredited: 1 },
  // SAFETY probes — none of these may ever render:
  display_name: 'Sam Surnameworth',
  displayName: 'Sam Surnameworth',
  email: 'sam@example.com',
  phone: '07700 900000',
  lastKnownLocation: 'Camden, London',
} as PublicProfile;

describe('PublicProfileSheet (privacy boundary)', () => {
  it('shows exactly the permitted fields — and none of the smuggled ones', async () => {
    const ref = createRef<BottomSheetRef>();
    const { getByText, getByTestId, queryByText, toJSON } = await render(
      <PublicProfileSheet ref={ref} profile={leakyProfile} />,
    );
    await act(async () => {
      ref.current?.open();
    });

    // Permitted: first name, member-since, reputation (stat column + emblems).
    expect(getByText('Sam')).toBeTruthy();
    expect(getByText('Member since March 2026')).toBeTruthy();
    expect(getByText('Recoveries')).toBeTruthy(); // 1 recovery as a stat row
    expect(getByTestId('stat-sightingsReported').props.accessibilityLabel).toBe(
      '5 sightings reported',
    );

    // SAFETY: assert ABSENCE of everything beyond the boundary.
    expect(queryByText(/Surnameworth/)).toBeNull();
    expect(queryByText(/sam@example\.com/)).toBeNull();
    expect(queryByText(/07700/)).toBeNull();
    expect(queryByText(/Camden/)).toBeNull();

    // Passports show EARNED trust only: the spotter's own next-badge goal
    // and progress never render for owners.
    expect(queryByText(/Next badge/)).toBeNull();

    // SAFETY: probe the WHOLE rendered tree, props included — a field
    // smuggled through an accessibilityLabel is invisible to queryByText
    // but must still fail this test.
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toMatch(/Surnameworth|sam@example\.com|07700|Camden/);
  });

  it('zero counters show no stat column — degrade by omission, never zeros', async () => {
    const ref = createRef<BottomSheetRef>();
    const fresh: PublicProfile = {
      firstName: 'Noor',
      avatarUrl: null,
      createdAt: '2026-06-01T00:00:00Z',
      counters: { sightingsReported: 0, sightingsHelpful: 0, recoveriesCredited: 0 },
    };
    const { getByText, queryByTestId } = await render(
      <PublicProfileSheet ref={ref} profile={fresh} />,
    );
    await act(async () => {
      ref.current?.open();
    });
    expect(getByText('Noor')).toBeTruthy();
    expect(getByText('Member since June 2026')).toBeTruthy();
    expect(queryByTestId('public-stats')).toBeNull();
    expect(queryByTestId('public-emblems')).toBeNull();
  });

  it('shows the trusted-spotter marker to owners once earned — derived, not leaked', async () => {
    const ref = createRef<BottomSheetRef>();
    const trusted: PublicProfile = {
      firstName: 'Priya',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00Z',
      counters: { sightingsReported: 9, sightingsHelpful: 5, recoveriesCredited: 1 },
    };
    const { getByTestId } = await render(<PublicProfileSheet ref={ref} profile={trusted} />);
    await act(async () => {
      ref.current?.open();
    });
    expect(getByTestId('trusted-spotter')).toBeTruthy();
  });

  it('below-threshold spotters show no trust marker', async () => {
    const ref = createRef<BottomSheetRef>();
    const { queryByTestId } = await render(
      <PublicProfileSheet ref={ref} profile={leakyProfile} />, // helpful=2 < 5
    );
    await act(async () => {
      ref.current?.open();
    });
    expect(queryByTestId('trusted-spotter')).toBeNull();
  });

  it('renders nothing while the profile is still loading', async () => {
    const ref = createRef<BottomSheetRef>();
    const { queryByTestId } = await render(<PublicProfileSheet ref={ref} profile={null} />);
    await act(async () => {
      ref.current?.open();
    });
    expect(queryByTestId('public-profile')).toBeNull();
  });
});
