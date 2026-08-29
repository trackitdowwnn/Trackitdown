/**
 * WHAT:  Tests for the inbox route's keep-alive host — that BOTH faces stay
 *        mounted across a segment switch, and that the hidden one is hidden
 *        from touch and from BOTH platforms' screen readers.
 * WHY:   ⚠️ THIS IS THE ONE THING IN THE INBOX PASS THAT A SIGHTED REVIEW
 *        CANNOT CATCH. The inactive face is fully laid out at `opacity: 0`, so
 *        it looks perfect while remaining, unless explicitly hidden, a whole
 *        second list that a screen reader will happily read out — a
 *        conversation list announced on top of a notification list, or the
 *        reverse. The two props that prevent it are single-platform:
 *        `accessibilityElementsHidden` is iOS-only and
 *        `importantForAccessibility` is Android-only, so deleting either one
 *        breaks exactly half the users and nothing on screen changes.
 *
 *        The device check (VoiceOver AND TalkBack, not one) is still worth
 *        doing once. This is what stops it silently regressing afterwards.
 * LINKS: ./inbox.tsx; docs/design-refs/inbox/GAP_ANALYSIS.md ("Verify before
 *        trusting", item 4).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import InboxRoute from './inbox';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
}));

const mockRequireAuth = jest.fn();
const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockUseSession(),
  useRequireAuth: () => mockRequireAuth,
}));

// The faces themselves are covered by their own suites; what matters here is
// how the host mounts and hides them.
jest.mock('@/features/chat', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text } = require('react-native');
  return { ChatInboxScreen: () => <Text>MESSAGES FACE</Text> };
});
jest.mock('@/features/notifications/screens/NotificationCenterScreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text } = require('react-native');
  return { NotificationCenterScreen: () => <Text>NOTIFICATIONS FACE</Text> };
});

jest.mock('@/features/notifications/lib/inboxSegmentStorage', () => ({
  loadInboxSegment: () => Promise.resolve('messages'),
  saveInboxSegment: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'me' });
});

/**
 * ⚠️ `includeHiddenElements` IS THE ASSERTION'S PREMISE, not a workaround.
 * RNTL excludes accessibility-hidden nodes from queries by default — so the
 * hidden face being unfindable without this flag is itself the first proof
 * that it is hidden. The flag lets us then check exactly HOW, since "not
 * found" alone would also pass if the face had been unmounted, which is the
 * bug this whole change removed.
 */
const HIDDEN_TOO = { includeHiddenElements: true } as const;

/** Both single-platform props plus touch, asserted together. */
const expectHidden = (node: { props: Record<string, unknown> }) => {
  expect(node.props.accessibilityElementsHidden).toBe(true);
  expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(node.props.pointerEvents).toBe('none');
};

const expectVisible = (node: { props: Record<string, unknown> }) => {
  expect(node.props.accessibilityElementsHidden).toBe(false);
  expect(node.props.importantForAccessibility).toBe('auto');
  expect(node.props.pointerEvents).toBe('auto');
};

describe('the keep-alive host', () => {
  it('mounts BOTH faces at once, not one', async () => {
    // The whole point of the change: switching segments must not destroy the
    // other list's scroll position, data or entrance.
    const { getByText } = await act(async () => render(<InboxRoute />));

    expect(getByText('MESSAGES FACE')).toBeTruthy();
    expect(getByText('NOTIFICATIONS FACE', HIDDEN_TOO)).toBeTruthy();
  });

  it('⚠️ hides the inactive face from touch and from BOTH screen readers', async () => {
    const { getByTestId } = await act(async () => render(<InboxRoute />));

    expectVisible(getByTestId('inbox-face-messages', HIDDEN_TOO));
    expectHidden(getByTestId('inbox-face-notifications', HIDDEN_TOO));
  });

  it('⚠️ the hidden face is unreachable by a default (accessibility-aware) query', async () => {
    // The property a screen reader actually experiences, stated directly: a
    // query that respects accessibility hiding must not find the hidden face's
    // content. This is the assertion that fails if either single-platform prop
    // is deleted.
    const { queryByText } = await act(async () => render(<InboxRoute />));

    expect(queryByText('NOTIFICATIONS FACE')).toBeNull();
    expect(queryByText('MESSAGES FACE')).toBeTruthy();
  });

  it('⚠️ swaps which face is hidden when the segment changes — without unmounting either', async () => {
    const { getByTestId, getByText } = await act(async () => render(<InboxRoute />));

    await act(async () => {
      fireEvent.press(getByTestId('surface-tab-notifications'));
    });

    expectVisible(getByTestId('inbox-face-notifications', HIDDEN_TOO));
    expectHidden(getByTestId('inbox-face-messages', HIDDEN_TOO));
    // Still mounted, which is the difference from the ternary this replaced.
    expect(getByText('MESSAGES FACE', HIDDEN_TOO)).toBeTruthy();
  });

  it('a signed-out visitor gets the invitation, and no faces at all', async () => {
    mockUseSession.mockReturnValue({ status: 'signedOut' });
    const { queryByTestId, getByText } = await act(async () => render(<InboxRoute />));

    expect(getByText('Your messages and updates live here')).toBeTruthy();
    expect(queryByTestId('inbox-face-messages')).toBeNull();
    expect(queryByTestId('inbox-face-notifications')).toBeNull();
  });
});
