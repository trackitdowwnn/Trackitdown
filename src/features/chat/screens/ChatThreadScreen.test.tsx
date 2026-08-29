/**
 * WHAT:  Tests for the conversation screen's two states that most need pinning:
 *        the metadata-error branch, and a healthy thread — where the absence of
 *        the safety notice and the presence of the empty state are both product
 *        decisions rather than accidents.
 * WHY:   ⚠️ THIS BRANCH DID NOT EXIST UNTIL 2026-08-28 and its absence was
 *        silent. The screen only ever handled `'missing'`, so a network failure
 *        loading the thread's metadata (`useThreadMeta.test.tsx` pins that this
 *        is `'error'`, not `'missing'`) rendered a header block containing a
 *        back button and nothing else — no name, no car, and no way to ask
 *        again.
 *
 *        Deliberately narrow: the full screen drags in a deferred profile
 *        import, FlashList, realtime and a toast provider, and none of that is
 *        what broke. Everything else here is covered by the hooks' own suites.
 * LINKS: ./ChatThreadScreen.tsx; ../hooks/useThreadMeta.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SAFETY_NOTICE_TITLE } from '@/shared/ui';

import { ChatThreadScreen } from './ChatThreadScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
}));

jest.mock('@/features/auth', () => ({
  useSession: () => ({ status: 'signedIn', userId: 'me' }),
}));

// The screen imports flagMessage, which reaches the Supabase client — and the
// client throws at import time without env. The hooks' own suites cover the API.
jest.mock('../api/chatApi', () => ({
  flagMessage: jest.fn().mockResolvedValue(undefined),
  CHAT_ERROR_MESSAGES: {},
}));

// The toast is only reached by the profile-open failure path, which this suite
// never exercises — but useToast throws outside a provider, so it needs a stub
// rather than a wrapper.
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  return {
    ...actual,
    useToast: () => jest.fn(),
    // The report sheet is gorhom-backed and needs a provider this suite has no
    // reason to mount — the sheet is not what is under test.
    BottomSheet: React.forwardRef(function BottomSheetStub(_props: unknown, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ open: jest.fn(), close: jest.fn() }));
      return null;
    }),
  };
});

const mockRetry = jest.fn();
const mockUseThreadMeta = jest.fn();
jest.mock('../hooks/useThreadMeta', () => ({
  useThreadMeta: () => mockUseThreadMeta(),
}));

jest.mock('../hooks/useThreadMessages', () => ({
  useThreadMessages: () => ({
    status: 'ready',
    messages: [],
    outgoing: [],
    hasOlder: false,
    sendError: null,
    send: jest.fn(),
    retrySend: jest.fn(),
    loadOlder: jest.fn(),
    retry: jest.fn(),
  }),
}));

jest.mock('../hooks/useThreadPeer', () => ({
  useThreadPeer: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUseThreadMeta.mockReturnValue({ status: 'error', thread: null, retry: mockRetry });
});

describe('⚠️ when the thread’s details fail to load', () => {
  it('still names the screen instead of showing a bare back button', async () => {
    const { getByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(getByText('Conversation')).toBeTruthy();
  });

  it('offers a way to ask again', async () => {
    const { getByTestId } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    fireEvent.press(getByTestId('chat-meta-retry'));

    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it('degrades only the identity slot, leaving the conversation usable', async () => {
    // The point of the meta-error branch: the messages load on their own hook
    // and are usually fine, so a metadata failure must not replace the screen.
    const { getByTestId } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(getByTestId('thread-list')).toBeTruthy();
  });

  it('does not claim the conversation is unavailable — that is a different state', async () => {
    // 'missing' means closed or forbidden and sends the reader back. 'error'
    // means we could not reach the server, which is recoverable.
    const { queryByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(queryByText('This conversation isn’t available')).toBeNull();
  });
});

describe('a healthy thread', () => {
  // ⚠️ A SEPARATE DESCRIBE, because the file's beforeEach pins meta to 'error'.
  // The safety-notice assertion previously lived in that block, so the product
  // decision — no notice on a WORKING thread — was never actually exercised.
  beforeEach(() => {
    mockUseThreadMeta.mockReturnValue({
      status: 'ready',
      thread: {
        threadId: 't1',
        postId: 'p1',
        role: 'spotter',
        lastMessageAt: '2026-07-15T10:00:00Z',
        lastMessagePreview: null,
        unreadCount: 0,
        post: {
          make: 'BMW',
          model: '3 Series',
          colour: 'Blue',
          plate: null,
          status: 'active',
          coverPhotoUrl: null,
        },
        other: { firstName: 'Sam' },
      },
      retry: mockRetry,
    });
  });

  it('⚠️ shows no safety notice — removed from THIS screen on 2026-08-29', async () => {
    // Owner decision, with DOMAIN.md (Chat) and SECURITY_AND_TRUST §1 amended
    // the same day. Asserted rather than merely deleted, because the test this
    // replaces asserted the OPPOSITE as a security requirement: whoever reads
    // it next should meet a decision, not an oversight.
    //
    // ⚠️ The rule still reaches five surfaces — the component on the sighting
    // wizard, post sightings, sighting detail and post detail, and the copy on
    // onboarding. This is not the precedent for removing it from those.
    const { queryByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(queryByText(SAFETY_NOTICE_TITLE)).toBeNull();
  });

  it('⚠️ says so when nobody has written yet, rather than showing a blank', async () => {
    // A thread could never be empty before the system message was removed, so
    // this screen had no empty state. Without one the first thing a spotter
    // sees after "Message the owner" is a blank rectangle.
    const { getByTestId, getByText } = await act(async () =>
      render(<ChatThreadScreen threadId="t1" />),
    );

    expect(getByTestId('thread-empty')).toBeTruthy();
    expect(getByText('No messages yet')).toBeTruthy();
  });

  it('⚠️ asks a SPOTTER what they saw', async () => {
    // Role-aware: an owner did not see anything, and owners reach empty threads
    // too (the inbox lists them via previewText's null fallback).
    const { getByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(getByText('Say what you saw, and where.')).toBeTruthy();
  });
});
