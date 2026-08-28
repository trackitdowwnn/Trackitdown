/**
 * WHAT:  Tests for UnreadBadge — the three forms (nothing, dot, count), the
 *        shared "9+" cap, and the reserved slot that keeps a read row's text
 *        column the same width as an unread one's.
 * WHY:   The reserved slot is the reason this component exists, and it is
 *        exactly the kind of property that no screenshot review catches: both
 *        inbox faces used to render their dot conditionally, so read rows had
 *        20pt more text column than unread ones and previews truncated at two
 *        different widths down one list.
 *
 *        The cap is shared with the tab badge on purpose — a row saying "12"
 *        under a tab saying "9+" is one bug, not two opinions.
 * LINKS: ./UnreadBadge.tsx; ./appTabBarModel.ts (badgeDisplay);
 *        src/features/chat/components/ThreadRow.tsx (a consumer).
 */

import { render } from '@testing-library/react-native';

import { UnreadBadge } from './UnreadBadge';

describe('what it draws', () => {
  it('draws nothing readable at zero', async () => {
    const { queryByText } = await render(<UnreadBadge count={0} />);

    expect(queryByText('0')).toBeNull();
  });

  it('⚠️ still occupies its slot at zero', async () => {
    // The whole point: the slot is reserved so the text column beside it does
    // not change width between a read row and an unread one.
    const empty = await render(<UnreadBadge count={0} testID="badge" />);
    const filled = await render(<UnreadBadge count={5} testID="badge" />);

    expect(empty.getByTestId('badge')).toBeTruthy();
    expect(empty.getByTestId('badge').props.style).toEqual(
      filled.getByTestId('badge').props.style,
    );
  });

  it('⚠️ one unread is a dot, not the numeral "1"', async () => {
    // A row badge marks the row you are already looking at; "1" only says
    // "one". (The tab badge does print 1 — it tallies what you cannot see.)
    const { queryByText, getByTestId } = await render(<UnreadBadge count={1} testID="badge" />);

    expect(getByTestId('badge')).toBeTruthy();
    expect(queryByText('1')).toBeNull();
  });

  it('prints the count above one', async () => {
    const { getByText } = await render(<UnreadBadge count={4} />);

    expect(getByText('4')).toBeTruthy();
  });

  it('caps at the same 9+ the tab badge uses', async () => {
    expect((await render(<UnreadBadge count={9} />)).getByText('9')).toBeTruthy();
    expect((await render(<UnreadBadge count={10} />)).getByText('9+')).toBeTruthy();
  });
});

describe('nonsense inputs', () => {
  it('renders no numeral for undefined, false, or a negative', async () => {
    for (const count of [undefined, false, -3] as const) {
      const { queryByText } = await render(<UnreadBadge count={count} />);
      expect(queryByText(/\d/)).toBeNull();
    }
  });

  it('⚠️ floors before deciding, so 0.9 is not a "0" pill', async () => {
    const { queryByText } = await render(<UnreadBadge count={0.9} />);

    expect(queryByText('0')).toBeNull();
  });
});
