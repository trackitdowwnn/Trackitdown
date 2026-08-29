/**
 * WHAT:  Tests for DayHeader and DayHeaderSkeleton — the heading semantics, and
 *        the gutter prop that lets one component serve a flush list and a
 *        padded one.
 * WHY:   Three lists now share this (both inbox faces and My reports) and they
 *        do NOT agree about who owns the horizontal gutter: a flush list whose
 *        rows pad themselves needs the header to carry the 24, while My
 *        reports' content container already pads and would double it to 48.
 *        That is invisible in isolation and obvious side by side, so it is
 *        pinned here rather than rediscovered.
 *
 *        The heading role is the affordance: it is what lets a screen reader's
 *        rotor jump between days instead of scrolling through them.
 * LINKS: ./DayHeader.tsx; src/shared/lib/dayGroups.ts (the labels);
 *        docs/DESIGN_SYSTEM.md (the 2026-08-28 day-label carve-out).
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DayHeader, DayHeaderSkeleton } from './DayHeader';

describe('DayHeader', () => {
  it('is a real heading, so rotor navigation can jump between days', async () => {
    const { getByRole } = await render(<DayHeader label="Today" />);

    expect(getByRole('header', { name: 'Today' })).toBeTruthy();
  });

  it('renders whatever calendar word it is given', async () => {
    const { getByText } = await render(<DayHeader label="23 July" />);

    expect(getByText('23 July')).toBeTruthy();
  });

  it('⚠️ drops its own gutter when the list already owns one', async () => {
    const padded = await render(<DayHeader label="Today" testID="h" />);
    const flush = await render(<DayHeader label="Today" gutter="none" testID="h" />);

    const flat = (style: unknown) => StyleSheetFlatten(style);
    expect(flat(padded.getByTestId('h').props.style).paddingHorizontal).toBe(24);
    expect(flat(flush.getByTestId('h').props.style).paddingHorizontal).toBe(0);
  });
});

describe('the trailing slot', () => {
  it('puts an action on the header’s own line', async () => {
    const { getByText } = await render(
      <DayHeader label="Today" trailing={<Text>Mark all as read</Text>} />,
    );

    expect(getByText('Today')).toBeTruthy();
    expect(getByText('Mark all as read')).toBeTruthy();
  });

  it('⚠️ does not change the header’s box when the action is absent', async () => {
    // The slot exists so an action needs no band of its own. If adding or
    // removing it changed the header's padding, the list would still shift —
    // which is the whole thing this replaced.
    const withAction = await render(
      <DayHeader label="Today" trailing={<Text>Act</Text>} testID="h" />,
    );
    const without = await render(<DayHeader label="Today" testID="h" />);

    expect(StyleSheetFlatten(withAction.getByTestId('h').props.style)).toEqual(
      StyleSheetFlatten(without.getByTestId('h').props.style),
    );
  });
});

describe('DayHeaderSkeleton', () => {
  it('⚠️ shows a bar, never the word "Today"', async () => {
    // The newest item in a sparse feed usually is not from today, so a word
    // here would flash a claim about to be replaced by a different date.
    const { queryByText } = await render(<DayHeaderSkeleton />);

    expect(queryByText('Today')).toBeNull();
    expect(queryByText(/\w/)).toBeNull();
  });
});

/** Flattens RN's array-or-object style prop for assertion. */
function StyleSheetFlatten(style: unknown): Record<string, number> {
  if (Array.isArray(style)) {
    return style.reduce(
      (acc: Record<string, number>, entry) => ({ ...acc, ...StyleSheetFlatten(entry) }),
      {},
    );
  }
  return (style ?? {}) as Record<string, number>;
}
