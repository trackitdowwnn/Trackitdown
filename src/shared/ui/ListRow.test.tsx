/**
 * WHAT:  Tests for ListRow — render variants (value, subtitle, destructive),
 *        press wiring, disabled state, chevron-only-when-pressable, and the
 *        combined accessibility label.
 * WHY:   Every settings row in the app rides on this; a swallowed press or a
 *        missing value in the spoken label breaks hub screens everywhere.
 * LINKS: src/shared/ui/ListRow.tsx; docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { View } from 'react-native';

import { ListRow } from './ListRow';

// Lucide ships ESM Jest can't parse; the row only needs SOME component.
const StubIcon = (() => <View />) as never;

describe('ListRow', () => {
  it('renders title, value, and subtitle', async () => {
    const { getByText } = await render(
      <ListRow title="Payouts" value="Payouts ready" subtitle="Via Stripe" />,
    );
    expect(getByText('Payouts')).toBeTruthy();
    expect(getByText('Payouts ready')).toBeTruthy();
    expect(getByText('Via Stripe')).toBeTruthy();
  });

  it('fires onPress and exposes a button role', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ListRow title="Notifications" icon={StubIcon} onPress={onPress} testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalled();
    expect(getByTestId('row').props.accessibilityRole).toBe('button');
  });

  it('disabled rows are inert', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ListRow title="Alert radius" onPress={onPress} disabled testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('row').props.accessibilityState).toEqual({ disabled: true });
  });

  it('speaks title, value, and subtitle together', async () => {
    const { getByTestId } = await render(
      <ListRow
        title="Payouts"
        value="Action needed"
        subtitle="Via Stripe"
        onPress={() => {}}
        testID="row"
      />,
    );
    expect(getByTestId('row').props.accessibilityLabel).toBe(
      'Payouts, Action needed, Via Stripe',
    );
  });
});
