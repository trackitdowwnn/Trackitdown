/**
 * WHAT:  Tests for Screen — children render in both plain and scroll modes,
 *        pull-to-refresh wires through to onRefresh, and the refresh control
 *        carries the app theme (not the platform default blue).
 * WHY:   Every screen rides on this wrapper; a broken refresh hookup would
 *        silently kill pull-to-refresh across the app. The native
 *        RefreshControl mock strips props, so wiring is asserted on the
 *        refreshControl element rather than the rendered host component, and
 *        the spinner's colours are asserted on the pure refreshControlColors
 *        helper (the component itself reads the palette through a hook).
 * LINKS: src/shared/ui/Screen.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

// Straight from the palette module: the barrel deliberately stops exporting
// `colors` so no COMPONENT can import the light palette by accident. A test
// asserting on specific values is the legitimate exception.
import { colors, darkColors } from '../theme/colors';
import { refreshControlColors, Screen } from './Screen';

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

describe('refreshControlColors', () => {
  // Asserted on the pure helper rather than by calling ThemedRefreshControl as
  // a plain function: the component now reads the palette through a hook, and
  // invoking it outside a renderer would throw "Invalid hook call".
  it('applies app colours', () => {
    expect(refreshControlColors(colors)).toEqual({
      tintColor: colors.primary,
      colors: [colors.primary],
      progressBackgroundColor: colors.surface,
    });
  });

  it('follows the palette it is given, so dark mode is not the platform blue', () => {
    expect(refreshControlColors(darkColors)).toEqual({
      tintColor: darkColors.primary,
      colors: [darkColors.primary],
      progressBackgroundColor: darkColors.surface,
    });
  });
});
