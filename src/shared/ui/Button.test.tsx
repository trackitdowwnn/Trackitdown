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

  it.each(['primary', 'secondary', 'ghost', 'danger'] as ButtonVariant[])(
    'renders the label for the %s variant',
    async (variant) => {
      const { getByText } = await render(
        <Button label="Action" variant={variant} onPress={() => {}} />,
      );

      expect(getByText('Action')).toBeTruthy();
    },
  );
});
