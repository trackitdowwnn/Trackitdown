/**
 * WHAT:  Tests for the thread's render pieces — the system safety message
 *        (distinct, never a user bubble), the outgoing bubble's failed
 *        state (text retained + retry fires; pending is inert), the
 *        long-press report affordance (theirs only, never our own), the
 *        timestamp caption rule, and the closed-banner copy split.
 * WHY:   These are the DOMAIN-visible behaviours of the thread UI: the
 *        safety first message and never-lose-a-failed-send are chat law;
 *        reporting your own message would only feed the moderation queue
 *        noise. Every fireEvent is wrapped in await act(async) — sync act
 *        overlaps the async render and poisons later queries (house rule).
 * LINKS: src/features/chat/components/chatThreadItems.tsx,
 *        src/features/chat/components/PostContextStrip.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { ChatMessage, OutgoingMessage } from '../types';
import { ClosedThreadBanner } from './PostContextStrip';
import { DaySeparator, MessageBubble, OutgoingBubble, SystemMessage } from './chatThreadItems';

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  threadId: 't1',
  senderId: 'them',
  kind: 'user',
  content: 'spotted it on the high street',
  createdAt: '2026-07-15T12:00:00Z',
  ...overrides,
});

const press = async (element: unknown, event: 'press' | 'longPress') => {
  await act(async () => {
    fireEvent(element as never, event);
  });
};

describe('SystemMessage', () => {
  it('renders the safety copy in the system treatment (not a bubble)', async () => {
    const system = message({ id: 's1', kind: 'system', senderId: null, content: 'Safety first: …' });
    const { getByTestId, getByText } = await render(<SystemMessage message={system} />);
    expect(getByTestId('system-s1')).toBeTruthy();
    expect(getByText('Safety first: …')).toBeTruthy();
  });
});

describe('MessageBubble', () => {
  it('long-press on THEIR message opens the report path', async () => {
    const onLongPress = jest.fn();
    const theirs = message();
    const { getByTestId } = await render(
      <MessageBubble
        message={theirs}
        mine={false}
        showTime={false}
        otherName="Sam"
        onReport={onLongPress}
      />,
    );
    await press(getByTestId('bubble-m1'), 'longPress');
    expect(onLongPress).toHaveBeenCalledWith(theirs);
  });

  it('long-press on OUR OWN message does nothing (not reportable)', async () => {
    const onLongPress = jest.fn();
    const { getByTestId } = await render(
      <MessageBubble
        message={message({ id: 'm2', senderId: 'me' })}
        mine
        showTime={false}
        onReport={onLongPress}
      />,
    );
    await press(getByTestId('bubble-m2'), 'longPress');
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('shows the time caption when the group rule says so', async () => {
    const { getByText } = await render(
      <MessageBubble message={message()} mine={false} showTime />,
    );
    // 12:00Z renders in device-local time — assert presence, not the value.
    expect(getByText(/\d{1,2}[:.]\d{2}/)).toBeTruthy();
  });

  it('hides the time caption otherwise', async () => {
    const { queryByText } = await render(
      <MessageBubble message={message({ id: 'm3' })} mine={false} showTime={false} />,
    );
    expect(queryByText(/\d{1,2}[:.]\d{2}/)).toBeNull();
  });
});

describe('OutgoingBubble', () => {
  const outgoing = (state: OutgoingMessage['state']): OutgoingMessage => ({
    localId: 'L1',
    content: 'my exact words',
    createdAt: '2026-07-15T12:01:00Z',
    state,
  });

  it('failed: retains the text, says so, and retries on tap', async () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = await render(
      <OutgoingBubble message={outgoing('failed')} onRetry={onRetry} />,
    );
    expect(getByText('my exact words')).toBeTruthy(); // NEVER dropped
    expect(getByText(/Not sent/)).toBeTruthy();
    await press(getByTestId('outgoing-L1'), 'press');
    expect(onRetry).toHaveBeenCalledWith('L1');
  });

  it('pending: shows Sending… and is not tappable', async () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = await render(
      <OutgoingBubble message={outgoing('pending')} onRetry={onRetry} />,
    );
    expect(getByText('Sending…')).toBeTruthy();
    await press(getByTestId('outgoing-L1'), 'press');
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('chrome', () => {
  it('DaySeparator renders its label', async () => {
    const { getByText } = await render(<DaySeparator label="Yesterday" />);
    expect(getByText('Yesterday')).toBeTruthy();
  });

  it('ClosedThreadBanner treats recovery as good news', async () => {
    const { getByText } = await render(<ClosedThreadBanner status="recovered" />);
    expect(getByText(/recovered/)).toBeTruthy();
  });

  it('ClosedThreadBanner states generic closure as read-only', async () => {
    const { getByText } = await render(<ClosedThreadBanner status="expired" />);
    expect(getByText(/read-only/)).toBeTruthy();
  });
});
