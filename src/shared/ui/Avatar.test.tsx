/**
 * WHAT:  Tests for Avatar — photo vs initial fallback, initial derivation,
 *        and the decorative-by-default accessibility stance.
 * WHY:   The fallback is what most users see until they add a photo; a wrong
 *        initial or an unlabelled-but-announced circle is a quiet paper cut
 *        on every profile surface.
 * LINKS: src/shared/ui/Avatar.tsx; docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { Avatar } from './Avatar';

// The avatar is accessibility-hidden by default (decorative), and RNTL v13
// excludes hidden elements from queries — so opt hidden elements in.
const hidden = { includeHiddenElements: true };

describe('Avatar', () => {
  it('shows the first initial, uppercased, when there is no photo', async () => {
    const { getByText } = await render(<Avatar name="ollie" />);
    expect(getByText('O', hidden)).toBeTruthy();
  });

  it('shows no initial when a photo is present', async () => {
    const { queryByText } = await render(
      <Avatar uri="https://example.com/a.jpg" name="Ollie" />,
    );
    expect(queryByText('O', hidden)).toBeNull();
  });

  it('is hidden from accessibility unless labelled', async () => {
    const { getByTestId, queryByTestId, rerender } = await render(
      <Avatar name="Ollie" testID="avatar" />,
    );
    // Hidden by default: invisible to accessibility-respecting queries…
    expect(queryByTestId('avatar')).toBeNull();
    expect(getByTestId('avatar', hidden).props.importantForAccessibility).toBe(
      'no-hide-descendants',
    );
    // …but a labelled avatar is a real element.
    await rerender(<Avatar name="Ollie" accessibilityLabel="Ollie's photo" testID="avatar" />);
    expect(getByTestId('avatar').props.accessibilityLabel).toBe("Ollie's photo");
  });
});
