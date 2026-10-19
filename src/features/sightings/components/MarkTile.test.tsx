/**
 * WHAT:  Tests for MarkTile in its two modes: the wizard's checkbox (toggles,
 *        announces checked) and the owner page's read-only row (one stop
 *        that says "seen" / "not seen", no checkbox, nothing to press).
 * WHY:   The same row now serves both sides of a sighting (2026-10-19); a
 *        read-only row announced as a checkbox would invite a tap that does
 *        nothing.
 * LINKS: src/features/sightings/components/MarkTile.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { MarkTile } from './MarkTile';

it('in the wizard: a checkbox the spotter toggles', async () => {
  const onPress = jest.fn();
  const view = await render(
    <MarkTile description="Roof box" selected={false} onPress={onPress} testID="t" />,
  );
  const box = view.getByRole('checkbox', { name: 'Roof box' });
  expect(box).not.toBeChecked();
  await act(async () => {
    fireEvent.press(box);
  });
  expect(onPress).toHaveBeenCalledTimes(1);
});

it.each([
  [true, 'Roof box, seen'],
  [false, 'Roof box, not seen'],
])('on the owner’s page (seen: %s): read-only, saying so in words', async (selected, label) => {
  const view = await render(<MarkTile description="Roof box" selected={selected} testID="t" />);
  expect(view.getByLabelText(label)).toBeTruthy();
  expect(view.queryByRole('checkbox')).toBeNull();
});

it('shows the owner’s photo when there is one', async () => {
  const view = await render(
    <MarkTile description="Dent" photoUrl="https://x/m1.jpg" selected testID="t" />,
  );
  expect(view.getByTestId('t-photo')).toBeTruthy();
});
