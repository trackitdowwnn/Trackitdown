/**
 * WHAT:  Tests for MessageInputBar — the send button's enabled/disabled rule,
 *        text delegation, the length cap, and the two properties that came out
 *        of dropping the shared form field: a placeholder rather than a
 *        floating label, and a height cap on growth.
 * WHY:   This bar used to wrap the form TextField, which gave a chat composer
 *        a label that slid up and permanently took a line, plus reserved
 *        helper space the send button had to be nudged around. The rewrite is
 *        easy to undo by accident (the obvious "fix" for any composer bug is
 *        to reach for TextField again), so the shape is pinned here. The
 *        max-height matters most: unbounded, a pasted paragraph pushes the
 *        whole conversation off screen.
 * LINKS: src/features/chat/components/MessageInputBar.tsx;
 *        src/features/chat/screens/ChatThreadScreen.tsx (owns the draft);
 *        docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MessageInputBar } from './MessageInputBar';

const setup = async (value: string, onSend = jest.fn(), onChangeText = jest.fn()) => ({
  onSend,
  onChangeText,
  ...(await render(
    <MessageInputBar
      value={value}
      onChangeText={onChangeText}
      onSend={onSend}
      maxLength={2000}
    />,
  )),
});

describe('MessageInputBar', () => {
  it('sends when there is content', async () => {
    const { getByTestId, onSend } = await setup('On my way');

    fireEvent.press(getByTestId('send-button'));

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('is disabled for an empty draft — and for whitespace only', async () => {
    const { getByTestId, onSend } = await setup('   ');

    expect(getByTestId('send-button').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(getByTestId('send-button'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('delegates typing upward — the screen owns the draft', async () => {
    const { getByTestId, onChangeText } = await setup('');

    fireEvent.changeText(getByTestId('message-input'), 'Saw it on Elm St');

    expect(onChangeText).toHaveBeenCalledWith('Saw it on Elm St');
  });

  it('carries the length cap down to the input', async () => {
    const { getByTestId } = await setup('');

    expect(getByTestId('message-input').props.maxLength).toBe(2000);
  });

  it('uses a placeholder, not a floating label, and stays labelled for a11y', async () => {
    const { getByTestId } = await setup('');
    const input = getByTestId('message-input');

    // A chat box is identified by its placeholder; the old form label slid up
    // and kept a whole line of the composer forever.
    expect(input.props.placeholder).toBe('Message…');
    // ...but a bare edit box would be unlabelled to a screen reader.
    expect(input.props.accessibilityLabel).toBe('Message');
  });

  it('caps how tall the field can grow, then scrolls inside itself', async () => {
    const { getByTestId } = await setup('a paragraph\nover\nseveral\nlines\nand\nmore');
    const style = StyleSheet.flatten(getByTestId('message-input').props.style);

    // Without this, a long paste pushes the conversation off screen entirely.
    expect(style.maxHeight).toBeGreaterThan(0);
    expect(getByTestId('message-input').props.multiline).toBe(true);
  });
});
