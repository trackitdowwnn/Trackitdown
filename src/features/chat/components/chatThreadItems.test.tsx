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
 *        src/features/chat/components/ClosedThreadBanner.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { ChatMessage, OutgoingMessage } from '../types';
import { ClosedThreadBanner } from './ClosedThreadBanner';
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

describe('⚠️ what a screen reader hears on a bubble', () => {
  // The time is DRAWN above only one bubble per group. A sighted reader infers
  // the rest from that caption; someone moving bubble by bubble never meets it,
  // so before this they could not get the time of any message that did not
  // happen to lead a group.
  it('carries the time on every bubble, not just the group leader', async () => {
    const { getByTestId } = await render(
      <MessageBubble message={message()} mine={false} otherName="Sam" />,
    );

    const label = getByTestId('bubble-m1').props.accessibilityLabel as string;
    expect(label).toContain('Sam: spotted it on the high street');
    // Locale-formatted, so assert the shape rather than a literal string.
    expect(label).toMatch(/\d{1,2}[:.]\d{2}/);
  });

  it('names the speaker as "You" on my own message', async () => {
    const { getByTestId } = await render(
      <MessageBubble message={message({ senderId: 'me' })} mine />,
    );

    expect(getByTestId('bubble-m1').props.accessibilityLabel).toContain('You: ');
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
       
        onReport={onLongPress}
      />,
    );
    await press(getByTestId('bubble-m2'), 'longPress');
    expect(onLongPress).not.toHaveBeenCalled();
  });

  // ⚠️ REPLACES 'shows the time caption when the group rule says so' AND
  // 'hides the time caption otherwise' (2026-09-04). Both drove a `showTime`
  // prop that no longer exists: the time moved INSIDE the bubble and every
  // bubble now carries its own, so there is no longer a state in which one is
  // hidden. `messageGroups` still computes showTime as the run-breaker; it just
  // draws nothing, which is why messageGroups.test.ts is untouched.
  it('every bubble carries its own time, whatever the grouping says', async () => {
    // 12:00Z renders in device-local time — assert presence, not the value.
    const first = await render(<MessageBubble message={message()} mine={false} groupPos="first" />);
    expect(first.getByText(/\d{1,2}[:.]\d{2}/)).toBeTruthy();

    // The case that used to render nothing: a continuation deep inside a run.
    const middle = await render(
      <MessageBubble message={message({ id: 'm3' })} mine={false} groupPos="middle" />,
    );
    expect(middle.getByText(/\d{1,2}[:.]\d{2}/)).toBeTruthy();
  });

  // ⚠️ THE THREAD-LEVEL MARKER MUST NOT BE RENDERED AS A PER-MESSAGE ONE. It
  // rides the time rather than replacing it, and it stays a WORD — a tick on
  // one bubble and not its neighbours would assert a per-message fact the data
  // does not carry.
  it('wears "Seen" beside its time, and only where it is set', async () => {
    const seen = await render(<MessageBubble message={message()} mine seen />);
    expect(seen.getByTestId('seen-m1')).toHaveTextContent(/\d{1,2}[:.]\d{2} · Seen/);

    const unseen = await render(<MessageBubble message={message({ id: 'm4' })} mine />);
    expect(unseen.queryByTestId('seen-m4')).toBeNull();
    expect(unseen.queryByText(/Seen/)).toBeNull();
  });

  // ⚠️ ONE NODE. The meta Text is a descendant of the bubble's Pressable now,
  // so without `accessible` a screen reader reads the time twice — once from
  // the label, once from the child.
  it('is a single accessibility node, so the time is not read twice', async () => {
    const { getByTestId } = await render(<MessageBubble message={message()} mine={false} />);

    expect(getByTestId('bubble-m1').props.accessible).toBe(true);
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
