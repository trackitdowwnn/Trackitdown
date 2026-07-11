/**
 * WHAT:  Tests for Screen — children render in both plain and scroll modes,
 *        pull-to-refresh wires through to onRefresh, and the refresh control
 *        carries the app theme (not the platform default blue).
 * WHY:   Every screen rides on this wrapper; a broken refresh hookup would
 *        silently kill pull-to-refresh across the app. The native
 *        RefreshControl mock strips props, so wiring is asserted on the
 *        refreshControl element rather than the rendered host component.
 * LINKS: src/shared/ui/Screen.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { colors } from '../theme';
import { Screen, ThemedRefreshControl } from './Screen';

describe('Screen', () => {
  it('renders children in plain mode', async () => {
    const { getByText } = await render(
      <Screen>
        <Text>Feed content</Text>
      </Screen>,
    );

    expect(getByText('Feed content')).toBeTruthy();
  });

  it('wires pull-to-refresh through to onRefresh in scroll mode', async () => {
    const onRefresh = jest.fn();
    const { getByText, getByTestId } = await render(
      <Screen scroll refreshing={false} onRefresh={onRefresh}>
        <Text>Feed content</Text>
      </Screen>,
    );

    expect(getByText('Feed content')).toBeTruthy();

    const refreshControl = getByTestId('screen-scroll').props.refreshControl;
    expect(refreshControl).toBeTruthy();

    refreshControl.props.onRefresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('attaches no refresh control when onRefresh is absent', async () => {
    const { getByTestId } = await render(
      <Screen scroll>
        <Text>Feed content</Text>
      </Screen>,
    );

    expect(getByTestId('screen-scroll').props.refreshControl).toBeUndefined();
  });
});

describe('ThemedRefreshControl', () => {
  it('applies app colours and forwards refresh props', () => {
    const onRefresh = jest.fn();
    const element = ThemedRefreshControl({ refreshing: true, onRefresh });

    expect(element.props.tintColor).toBe(colors.primary);
    expect(element.props.colors).toEqual([colors.primary]);
    expect(element.props.progressBackgroundColor).toBe(colors.surface);
    expect(element.props.refreshing).toBe(true);
    expect(element.props.onRefresh).toBe(onRefresh);
  });
});
