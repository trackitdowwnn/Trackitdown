/**
 * WHAT:  Tests for the inbox conversation row — the car photo / colour-tile
 *        lead, the owner-only plate and its forwarded press, the unread badge's
 *        three forms, and the one sentence a screen reader hears.
 * WHY:   ⚠️ THIS ROW SHIPPED WITH NO TESTS AND WAS THEN REBUILT (2026-08-28,
 *        Airbnb inbox pass: the car photo took the leading slot from an
 *        initial-letter avatar). Nothing pinned the plate privacy rule, the
 *        forwarded press, or the unread wording — and two of those are the kind
 *        of defect that is invisible until someone is affected by it: a plate
 *        shown to a spotter is a privacy leak, and a plate that swallows the
 *        row's tap is a conversation you cannot open.
 * LINKS: ./ThreadRow.tsx; ../lib/inboxModel.ts (the privacy split);
 *        src/shared/ui/UnreadBadge.tsx; docs/TESTING.md.
 */

import { fireEvent, render, within } from '@testing-library/react-native';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';

import { radii } from '@/shared/theme';

import { formatClock } from '@/shared/lib/dateTimeLabel';

import type { InboxThread } from '../types';

import { ThreadRow } from './ThreadRow';

const thread = (overrides: Partial<InboxThread> = {}): InboxThread => ({
  threadId: 't1',
  postId: 'p1',
  role: 'owner',
  lastMessageAt: new Date().toISOString(),
  lastMessagePreview: 'Still parked outside number 12',
  unreadCount: 0,
  post: {
    make: 'BMW',
    model: '3 Series',
    colour: 'Blue',
    plate: 'AB12 CDE',
    status: 'active',
    coverPhotoUrl: null,
  },
  other: { firstName: 'Sam' },
  ...overrides,
});

const withPhoto = () =>
  thread({ post: { ...thread().post, coverPhotoUrl: 'https://example.test/car.jpg' } });

describe('the leading visual', () => {
  it('leads with the car’s photo when the post has one', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ThreadRow thread={withPhoto()} onPress={jest.fn()} />,
    );

    expect(getByTestId('thread-car-photo-t1')).toBeTruthy();
    expect(queryByTestId('thread-car-tile-t1')).toBeNull();
  });

  it('⚠️ falls back to the car’s COLOUR, never an empty grey square', async () => {
    // coverPhotoUrl is nullable and plenty of posts have none. Before the
    // fallback these rows led with nothing at all.
    const { getByTestId, queryByTestId } = await render(
      <ThreadRow thread={thread()} onPress={jest.fn()} />,
    );

    expect(getByTestId('thread-car-tile-t1')).toBeTruthy();
    expect(queryByTestId('thread-car-photo-t1')).toBeNull();
  });
});

// ⚠️ THESE PIN A SHAPE THAT HAS NOW BEEN REVERSED TWICE, which is the only
// reason they earn their place — TESTING.md is right that asserting a prop
// usually guards nothing. The lead went square (2026-08-28) then round
// (2026-09-04), and the time went from the name's line into a trailing column
// on the same date. Both are decisions a later tidy-up would undo without
// realising it had chosen anything.
//
// ⚠️ AND THEY ONLY COVER HALF THE INVARIANT. `NotificationRowItem` is supposed
// to be the same silhouette — both file headers say "change one and change
// both" — but it has NO TEST FILE AT ALL, so nothing catches the two faces
// drifting apart. That is a real gap, stated here rather than papered over.
describe('the row shape the inbox pass settled on', () => {
  it('leads with a ROUND tile, not the rounded square it used to be', async () => {
    const { getByTestId } = await render(<ThreadRow thread={withPhoto()} onPress={jest.fn()} />);
    const lead = StyleSheet.flatten(getByTestId('thread-car-photo-t1').props.style);

    expect(lead.borderRadius).toBe(radii.full);
  });

  // ⚠️ fontScale PINNED. jest-expo reports 2 by default, which is ABOVE
  // `listRowStackFontScale` — so without this the suite silently tests only the
  // large-type branch, and the ordinary layout would go uncovered. The
  // onboarding suite learned the same lesson about the same default.
  const atScale = (fontScale: number) =>
    jest
      .spyOn(RN.Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });

  afterEach(() => jest.restoreAllMocks());

  it('keeps the time and the unread badge together in one trailing column', async () => {
    // They used to be two separate right-hand objects at two different heights
    // — the time on the name's line, the badge centred in a side slot. If this
    // fails, someone has put the time back beside the name.
    atScale(1);
    const { getByTestId } = await render(
      <ThreadRow thread={thread({ unreadCount: 3 })} onPress={jest.fn()} />,
    );
    const meta = within(getByTestId('thread-meta-t1'));

    expect(meta.getByText(formatClock(new Date().toISOString()))).toBeTruthy();
    expect(meta.getByText('3')).toBeTruthy();
  });

  // ⚠️ THE REGRESSION THIS EXISTS TO CATCH. The trailing column is
  // `flexShrink: 0` and the body is `flex: 1` (basis 0), so Yoga hands the
  // column its INTRINSIC width first. At 2× text a "6 Jul 2025" stamp is
  // ~120pt of a 390pt row and the preview collapses to about nine characters.
  // Past `listRowStackFontScale` the stamp therefore leaves the column and only
  // the badge stays. A version of this row shipped without the guard on
  // 2026-09-04; this is what would have caught it.
  it('⚠️ moves the stamp out of the trailing column at large text sizes', async () => {
    atScale(2);
    const { getByTestId } = await render(
      <ThreadRow thread={thread({ unreadCount: 3 })} onPress={jest.fn()} />,
    );
    const stamp = formatClock(new Date().toISOString());

    // Still on the row — just not squeezing the body from the right.
    expect(within(getByTestId('thread-row-t1')).getByText(stamp)).toBeTruthy();
    expect(within(getByTestId('thread-meta-t1')).queryByText(stamp)).toBeNull();
    // The badge does not move: its slot is a fixed width either way.
    expect(within(getByTestId('thread-meta-t1')).getByText('3')).toBeTruthy();
  });
});

describe('⚠️ the plate is a privacy rule, not a decoration', () => {
  it('shows an OWNER their own plate', async () => {
    const { getByText } = await render(<ThreadRow thread={thread()} onPress={jest.fn()} />);

    expect(getByText('AB12 CDE')).toBeTruthy();
  });

  it('⚠️ never shows a SPOTTER the plate, even though the payload carries it', async () => {
    // The RPC returns `plate` for both roles; the client rule is what withholds
    // it. A spotter must never see a plate the post's public face doesn't show.
    const { queryByText } = await render(
      <ThreadRow thread={thread({ role: 'spotter' })} onPress={jest.fn()} />,
    );

    expect(queryByText('AB12 CDE')).toBeNull();
  });

  it('⚠️ the plate opens the conversation rather than swallowing the tap', async () => {
    // PlateChip long-presses to copy, which makes it the touch responder — so
    // the row forwards its own onPress into the chip. Without that, an owner's
    // row has a dead ~80×26 patch that silently does nothing.
    const onPress = jest.fn();
    const { getByText } = await render(<ThreadRow thread={thread()} onPress={onPress} />);

    fireEvent.press(getByText('AB12 CDE'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress.mock.calls[0][0].threadId).toBe('t1');
  });
});

describe('the unread badge', () => {
  it('shows nothing on a read row', async () => {
    const { queryByTestId } = await render(<ThreadRow thread={thread()} onPress={jest.fn()} />);

    expect(queryByTestId('thread-unread-t1')).toBeNull();
  });

  it('a single unread message is a DOT, with no number to read', async () => {
    const { getByTestId, queryByText } = await render(
      <ThreadRow thread={thread({ unreadCount: 1 })} onPress={jest.fn()} />,
    );

    expect(getByTestId('thread-unread-t1')).toBeTruthy();
    expect(queryByText('1')).toBeNull();
  });

  it('more than one becomes a count — the number the payload always had', async () => {
    const { getByText } = await render(
      <ThreadRow thread={thread({ unreadCount: 3 })} onPress={jest.fn()} />,
    );

    expect(getByText('3')).toBeTruthy();
  });

  it('caps at the same 9+ the tab badge uses', async () => {
    const { getByText } = await render(
      <ThreadRow thread={thread({ unreadCount: 12 })} onPress={jest.fn()} />,
    );

    expect(getByText('9+')).toBeTruthy();
  });
});

describe('what a screen reader hears', () => {
  it('reads as one sentence: who, which car, what they said, when', async () => {
    const { getByTestId } = await render(
      <ThreadRow thread={thread({ role: 'spotter' })} onPress={jest.fn()} />,
    );

    // The fixture's timestamp is `now`, so the spoken form is always "Today,
    // HH:MM" — built from the same formatter the row uses rather than typed
    // out, because a literal clock time here would fail once an hour.
    expect(getByTestId('thread-row-t1').props.accessibilityLabel).toBe(
      'Conversation with Sam. Your sighting · Blue BMW 3 Series. ' +
        `Still parked outside number 12. Today, ${formatClock(new Date().toISOString())}.`,
    );
  });

  // ⚠️ THE LABEL SAYS THE DAY; THE ROW DRAWS ONLY THE CLOCK. That asymmetry is
  // the point (2026-09-04): a sighted reader gets the day from the DayHeader
  // above the row, and a screen-reader user moving row by row never meets it.
  // If these two ever converge, one of the two audiences has lost the day.
  it('speaks the day the drawn row leaves to its header', async () => {
    const { getByTestId } = await render(
      <ThreadRow thread={thread({ role: 'spotter' })} onPress={jest.fn()} />,
    );
    const row = getByTestId('thread-row-t1');
    const clock = formatClock(new Date().toISOString());

    expect(row.props.accessibilityLabel).toContain(`Today, ${clock}`);
    // Drawn: the clock alone, and nothing relative.
    expect(within(row).getByText(clock)).toBeTruthy();
    expect(within(row).queryByText(/ago/)).toBeNull();
  });

  it('⚠️ speaks the plate an owner can SEE, spelled out', async () => {
    // The label was built from the context prefix alone while the chip rendered
    // from `plate`, so a sighted owner had their registration and a VoiceOver
    // user did not. Spelled by character group, because "AB12 CDE" read as a
    // word is not something anyone can write down.
    const { getByTestId } = await render(<ThreadRow thread={thread()} onPress={jest.fn()} />);

    expect(getByTestId('thread-row-t1').props.accessibilityLabel).toContain('Plate A B 1 2');
  });

  it('has no plate to speak on a spotter’s row', async () => {
    const { getByTestId } = await render(
      <ThreadRow thread={thread({ role: 'spotter' })} onPress={jest.fn()} />,
    );

    expect(getByTestId('thread-row-t1').props.accessibilityLabel).not.toContain('Plate');
  });

  it('⚠️ pluralises the unread clause', async () => {
    // The old label ended "3 unread." — a fragment, and "1 unread" for one.
    const one = await render(<ThreadRow thread={thread({ unreadCount: 1 })} onPress={jest.fn()} />);
    expect(one.getByTestId('thread-row-t1').props.accessibilityLabel).toContain(
      '1 unread message.',
    );
    one.unmount();

    const many = await render(<ThreadRow thread={thread({ unreadCount: 4 })} onPress={jest.fn()} />);
    expect(many.getByTestId('thread-row-t1').props.accessibilityLabel).toContain(
      '4 unread messages.',
    );
  });
});
