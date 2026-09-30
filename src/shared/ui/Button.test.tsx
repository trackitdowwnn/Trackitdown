/**
 * WHAT:  Tests for the Button primitive — press handling, disabled behaviour
 *        (no press, announced to screen readers), and label rendering across
 *        variants.
 * WHY:   Every action in the app goes through this component; a button that
 *        swallows presses or hides its disabled state would break flows
 *        everywhere at once.
 * LINKS: src/shared/ui/Button.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { Button, type ButtonVariant } from './Button';

describe('Button', () => {
  it('fires onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Button label="Continue" onPress={onPress} />);

    fireEvent.press(getByRole('button', { name: 'Continue' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress while disabled and announces the disabled state', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Button label="Publish" onPress={onPress} disabled />);

    const button = getByRole('button', { name: 'Publish' });
    fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('blocks presses and announces busy while loading', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button label="Post & pay" onPress={onPress} loading />,
    );

    const button = getByRole('button', { name: 'Post & pay' });
    fireEvent.press(button);

    expect(onPress).not.toHaveBeenCalled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true });
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'dangerOutline', 'subtle'] as ButtonVariant[])(
    'renders the label for the %s variant',
    async (variant) => {
      const { getByText } = await render(
        <Button label="Action" variant={variant} onPress={() => {}} />,
      );

      expect(getByText('Action')).toBeTruthy();
    },
  );

  it('speaks its own label and hint when given, and still presses', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(
      <Button
        label="Call 999"
        icon="phone"
        variant="dangerOutline"
        accessibilityLabel="Call 9 9 9, emergency"
        accessibilityHint="Opens your phone to call emergency services"
        onPress={onPress}
      />,
    );

    const button = getByRole('button', { name: 'Call 9 9 9, emergency' });
    expect(button.props.accessibilityHint).toBe('Opens your phone to call emergency services');
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
