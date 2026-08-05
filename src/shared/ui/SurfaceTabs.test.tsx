/**
 * WHAT:  Tests for SurfaceTabs — selection callback, tab semantics, and the
 *        two things that make it read as navigation rather than as another
 *        filter row: the underline appears on exactly one tab, and the label
 *        keeps the same size and line height in both states.
 * WHY:   This replaced a segmented pill track precisely because the Inbox's
 *        surface switch and its filter chips were competing for the same
 *        visual grammar. If the underline ever drifts to "all" or "none", the
 *        active face stops being readable at a glance. And a label whose line
 *        height changes with the active family nudges the whole row on every
 *        tap — the kind of 2px twitch that reads as a rendering fault, so both
 *        states are pinned to the same metrics here.
 * LINKS: src/shared/ui/SurfaceTabs.tsx; src/app/(tabs)/inbox.tsx (consumer);
 *        docs/DESIGN_SYSTEM.md (Typography); docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { SurfaceTabs } from './SurfaceTabs';

const OPTIONS = [
  { value: 'messages', label: 'Messages' },
  { value: 'notifications', label: 'Notifications' },
];

describe('SurfaceTabs', () => {
  it('fires onSelect with the tapped value', async () => {
    const onSelect = jest.fn();
    const { getByLabelText } = await render(
      <SurfaceTabs options={OPTIONS} value="messages" onSelect={onSelect} />,
    );

    fireEvent.press(getByLabelText('Notifications'));

    expect(onSelect).toHaveBeenCalledWith('notifications');
  });

  it('announces tab semantics with only the active tab selected', async () => {
    const { getByLabelText } = await render(
      <SurfaceTabs options={OPTIONS} value="messages" onSelect={() => {}} />,
    );

    expect(getByLabelText('Messages').props.accessibilityRole).toBe('tab');
    expect(getByLabelText('Messages').props.accessibilityState).toMatchObject({ selected: true });
    expect(getByLabelText('Notifications').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('underlines exactly the active tab', async () => {
    const { queryByTestId, rerender } = await render(
      <SurfaceTabs options={OPTIONS} value="messages" onSelect={() => {}} />,
    );

    expect(queryByTestId('surface-tab-messages-underline')).toBeTruthy();
    expect(queryByTestId('surface-tab-notifications-underline')).toBeNull();

    await rerender(<SurfaceTabs options={OPTIONS} value="notifications" onSelect={() => {}} />);

    expect(queryByTestId('surface-tab-messages-underline')).toBeNull();
    expect(queryByTestId('surface-tab-notifications-underline')).toBeTruthy();
  });

  it('keeps font size and line height identical across states — no row twitch', async () => {
    const { getByText } = await render(
      <SurfaceTabs options={OPTIONS} value="messages" onSelect={() => {}} />,
    );

    const active = StyleSheet.flatten(getByText('Messages').props.style);
    const inactive = StyleSheet.flatten(getByText('Notifications').props.style);

    expect(active.fontSize).toBe(inactive.fontSize);
    expect(active.lineHeight).toBe(inactive.lineHeight);
    // The state IS carried — by family and colour, just not by metrics.
    expect(active.fontFamily).not.toBe(inactive.fontFamily);
    expect(active.color).not.toBe(inactive.color);
  });
});
