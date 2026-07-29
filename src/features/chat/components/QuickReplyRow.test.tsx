/**
 * WHAT:  Tests for QuickReplyRow — a tap hands the text to the caller and
 *        does nothing else; the accessibility label says "fills the box",
 *        not "sends".
 * WHY:   "Never auto-sent" is the feature's one hard rule: a chip that sent
 *        would put unedited words in a victim's mouth. The component can't
 *        send (it has no send path to call), and this pins that its ONLY
 *        output is onPick.
 * LINKS: src/features/chat/components/QuickReplyRow.tsx;
 *        src/features/chat/lib/quickReplies.ts; docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { QuickReplyRow } from './QuickReplyRow';

const REPLIES = ['It’s still here', 'It’s gone now'] as const;

describe('QuickReplyRow', () => {
  it('renders one chip per reply', async () => {
    const { getByTestId } = await render(
      <QuickReplyRow replies={REPLIES} onPick={jest.fn()} />,
    );
    for (const reply of REPLIES) {
      expect(getByTestId(`quick-reply-${reply}`)).toBeTruthy();
    }
  });

  it('a tap emits exactly that text — once, and nothing more', async () => {
    const onPick = jest.fn();
    const { getByTestId } = await render(<QuickReplyRow replies={REPLIES} onPick={onPick} />);

    fireEvent.press(getByTestId('quick-reply-It’s gone now'));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('It’s gone now');
  });

  it('tells a screen reader it FILLS the box, not that it sends', async () => {
    const { getByTestId } = await render(
      <QuickReplyRow replies={REPLIES} onPick={jest.fn()} />,
    );
    const label = getByTestId('quick-reply-It’s still here').props
      .accessibilityLabel as string;
    expect(label).toContain('puts this in the message box');
    expect(label.toLowerCase()).not.toContain('sends');
  });

  it('renders nothing for an empty set', async () => {
    const { queryByTestId } = await render(<QuickReplyRow replies={[]} onPick={jest.fn()} />);
    expect(queryByTestId('quick-reply-row')).toBeNull();
  });
});
