/**
 * WHAT:  Tests for the merged thread header — its two tap targets, the
 *        owner-only profile button and its reserved slot, and the three states
 *        that used to degrade to a lone back button.
 * WHY:   This row replaced two (a person header above a car strip) on a screen
 *        that was 46% chrome. Three things about it are easy to get wrong and
 *        invisible in review: the profile button must not appear for a spotter
 *        (there is no profile to open), its slot must be reserved before the
 *        peer request lands or the header reflows mid-read, and the degraded
 *        states must keep the row's height and a way to retry.
 *
 *        The wording of the error state is asserted here AND in
 *        ChatThreadScreen.test.tsx — deliberately. It is what a person sees
 *        when the thread's details will not load.
 * LINKS: ./ThreadHeader.tsx; ../screens/ChatThreadScreen.tsx;
 *        docs/design-refs/chat/GAP_ANALYSIS.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import type { InboxThread } from '../types';

import { ThreadHeader } from './ThreadHeader';

const thread = (overrides: Partial<InboxThread> = {}): InboxThread => ({
  threadId: 't1',
  postId: 'p1',
  role: 'owner',
  lastMessageAt: '2026-07-15T10:00:00Z',
  lastMessagePreview: 'hello',
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

const noop = jest.fn();
const props = {
  status: 'ready' as const,
  profileAvailable: true,
  onBack: noop,
  onOpenPost: noop,
  onOpenProfile: noop,
  onRetry: noop,
};

describe('the two targets', () => {
  it('the car opens the post, not the profile', async () => {
    const onOpenPost = jest.fn();
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={thread()} onOpenPost={onOpenPost} />,
    );

    fireEvent.press(getByTestId('chat-post-context'));

    expect(onOpenPost).toHaveBeenCalledWith('p1');
  });

  it('the profile button opens the profile', async () => {
    const onOpenProfile = jest.fn();
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={thread()} onOpenProfile={onOpenProfile} />,
    );

    fireEvent.press(getByTestId('chat-peer-profile'));

    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('names the person, the car and its state where a screen reader will find them', async () => {
    const { getByTestId } = await render(<ThreadHeader {...props} thread={thread()} />);

    const label = getByTestId('chat-post-context').props.accessibilityLabel as string;
    expect(label).toContain('Blue BMW 3 Series');
    expect(label).toContain('Still missing');
    // ⚠️ The role word is not drawn any more — it must survive in the label.
    expect(label).toContain('Sam');
    expect(label).toContain('owner');
  });
});

describe('⚠️ the profile button is owner-only', () => {
  it('is absent for a spotter, who has no profile to open', async () => {
    // The old header rendered a visually identical block as a Pressable for
    // owners and a plain View for spotters — a sighted user could not tell
    // which they had. Present-or-absent is honest.
    const { queryByTestId } = await render(
      <ThreadHeader {...props} thread={thread({ role: 'spotter' })} />,
    );

    expect(queryByTestId('chat-peer-profile')).toBeNull();
  });

  it('⚠️ reserves its slot before the peer request lands', async () => {
    // meta and peer resolve independently. Keying the button on the profile
    // arriving would pop 44pt into the row a beat after it drew, shoving the
    // text sideways mid-read.
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={thread()} profileAvailable={false} />,
    );

    // Hidden from assistive tech until it works, so the query must opt in —
    // which is itself the proof that it is hidden.
    const button = getByTestId('chat-peer-profile', { includeHiddenElements: true });
    expect(button).toBeTruthy();
    // Present but inert, and hidden from a screen reader until it works.
    expect(button.props.accessibilityRole).toBeUndefined();
    expect(button.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('does nothing when pressed while the profile has not arrived', async () => {
    const onOpenProfile = jest.fn();
    const { getByTestId } = await render(
      <ThreadHeader
        {...props}
        thread={thread()}
        profileAvailable={false}
        onOpenProfile={onOpenProfile}
      />,
    );

    fireEvent.press(getByTestId('chat-peer-profile', { includeHiddenElements: true }));

    expect(onOpenProfile).not.toHaveBeenCalled();
  });
});

describe('the states that used to be a lone back button', () => {
  it('shows a skeleton in the header’s own shape while loading', async () => {
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={null} status="loading" />,
    );

    expect(getByTestId('thread-header-skeleton')).toBeTruthy();
    expect(getByTestId('chat-back')).toBeTruthy();
  });

  it('names the screen and offers a retry when the details fail', async () => {
    const onRetry = jest.fn();
    const { getByText, getByTestId } = await render(
      <ThreadHeader {...props} thread={null} status="error" onRetry={onRetry} />,
    );

    expect(getByText('Conversation')).toBeTruthy();
    fireEvent.press(getByTestId('chat-meta-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('⚠️ offers no retry when the thread is MISSING, because there is nothing to retry', async () => {
    // 'missing' means closed or forbidden and the body sends you back;
    // 'error' means we could not reach the server, which is recoverable.
    const { getByText, queryByTestId } = await render(
      <ThreadHeader {...props} thread={null} status="missing" />,
    );

    expect(getByText('Conversation')).toBeTruthy();
    expect(queryByTestId('chat-meta-retry')).toBeNull();
  });

  it('always keeps a way back — loading', async () => {
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={null} status="loading" />,
    );
    expect(getByTestId('chat-back')).toBeTruthy();
  });

  it('always keeps a way back — error', async () => {
    const { getByTestId } = await render(<ThreadHeader {...props} thread={null} status="error" />);
    expect(getByTestId('chat-back')).toBeTruthy();
  });

  it('always keeps a way back — missing', async () => {
    const { getByTestId } = await render(
      <ThreadHeader {...props} thread={null} status="missing" />,
    );
    expect(getByTestId('chat-back')).toBeTruthy();
  });
});

describe('the car', () => {
  it('falls back to the car’s colour when the post has no photo', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ThreadHeader {...props} thread={thread()} />,
    );

    expect(getByTestId('chat-car-tile')).toBeTruthy();
    expect(queryByTestId('chat-car-photo')).toBeNull();
  });

  it('leads with the photo when there is one', async () => {
    const withPhoto = thread();
    withPhoto.post.coverPhotoUrl = 'https://example.test/car.jpg';
    const { getByTestId, queryByTestId } = await render(
      <ThreadHeader {...props} thread={withPhoto} />,
    );

    expect(getByTestId('chat-car-photo')).toBeTruthy();
    expect(queryByTestId('chat-car-tile')).toBeNull();
  });
});
