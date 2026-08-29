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

import { fireEvent, render } from '@testing-library/react-native';

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

    expect(getByTestId('thread-row-t1').props.accessibilityLabel).toBe(
      'Conversation with Sam. Your sighting · Blue BMW 3 Series. ' +
        'Still parked outside number 12. just now.',
    );
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
