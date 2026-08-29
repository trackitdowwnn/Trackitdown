/**
 * WHAT:  Tests for the one branch of the conversation screen that had none —
 *        what happens when `useThreadMeta` fails rather than reporting the
 *        thread missing.
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

  it('⚠️ keeps the safety notice, which is unconditional by security rule M1', async () => {
    // The notice must appear on every thread regardless of what else failed —
    // it needs nothing from the metadata anyway. This is why the branch
    // degrades only the identity slot rather than replacing the screen.
    const { getByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    // Collapsed, so the title is what shows; the elaboration folds.
    expect(getByText(SAFETY_NOTICE_TITLE)).toBeTruthy();
  });

  it('does not claim the conversation is unavailable — that is a different state', async () => {
    // 'missing' means closed or forbidden and sends the reader back. 'error'
    // means we could not reach the server, which is recoverable.
    const { queryByText } = await act(async () => render(<ChatThreadScreen threadId="t1" />));

    expect(queryByText('This conversation isn’t available')).toBeNull();
  });
});
