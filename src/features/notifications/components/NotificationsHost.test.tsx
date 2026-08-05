/**
 * WHAT:  Tests for NotificationsHost — cold-start routing, warm taps, the
 *        once-only guard, and quiet foreground presentation.
 * WHY:   Every failure mode here is SILENT. A cold-start tap that navigates
 *        before the navigator exists does nothing at all; a sticky launch
 *        response re-opens a post the user already dismissed; a wrong handler
 *        field shows a system banner over the app. None of it throws, so
 *        nothing but a test catches it.
 * LINKS: ./NotificationsHost.tsx, ../lib/pushRoute.ts; docs/TESTING.md.
 */

import { render, waitFor } from '@testing-library/react-native';

import { NotificationsHost, resetNotificationsHostForTests } from './NotificationsHost';

const POST_ID = '11111111-2222-3333-4444-555555555555';
const THREAD_ID = '66666666-7777-8888-9999-000000000000';

// --- expo-notifications -------------------------------------------------------
const mockGetLastResponse = jest.fn();
let responseListener: ((response: unknown) => void) | null = null;
let receivedListener: ((notification: unknown) => void) | null = null;
const mockSetHandler = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (handler: unknown) => mockSetHandler(handler),
  getLastNotificationResponseAsync: () => mockGetLastResponse() as Promise<unknown>,
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => {
    responseListener = listener;
    return { remove: jest.fn() };
  },
  addNotificationReceivedListener: (listener: (notification: unknown) => void) => {
    receivedListener = listener;
    return { remove: jest.fn() };
  },
}));

// --- expo-router --------------------------------------------------------------
const mockPush = jest.fn();
const mockNavState = jest.fn();
const mockSegments = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRootNavigationState: () => mockNavState() as { key?: string } | undefined,
  useSegments: () => mockSegments() as string[],
}));

// --- session ------------------------------------------------------------------
const mockUseSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockUseSession() as { status: string; userId: string | null },
}));

// --- toast --------------------------------------------------------------------
const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => ({
  useToast: () => ({ show: mockToastShow }),
}));

// Registration has its own suite; keep this one about routing.
jest.mock('../hooks/usePushRegistration', () => ({
  usePushRegistration: jest.fn(),
}));

// The api module reaches the supabase client (env-dependent at import).
const mockMarkByPayload = jest.fn();
jest.mock('../api/notificationsApi', () => ({
  markNotificationsReadByPayload: (...args: unknown[]) => mockMarkByPayload(...args),
}));

function responseFor(data: unknown, identifier = 'notif-1') {
  return {
    notification: {
      request: { identifier, content: { title: 'Stolen car nearby', body: 'A blue BMW', data } },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetNotificationsHostForTests();
  responseListener = null;
  receivedListener = null;
  mockGetLastResponse.mockResolvedValue(null);
  mockNavState.mockReturnValue({ key: 'root' });
  mockSegments.mockReturnValue(['(tabs)']);
  mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
});

describe('NotificationsHost', () => {
  it('suppresses the system banner in the foreground', async () => {
    await render(<NotificationsHost />);
    // Set at module scope, so it has already run by now.
    const behaviour = await mockSetHandler.mock.calls[0][0].handleNotification();
    expect(behaviour.shouldShowBanner).toBe(false);
    expect(behaviour.shouldShowList).toBe(false);
  });

  it('opens a cold-start notification once the navigator is ready', async () => {
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    await render(<NotificationsHost />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/post/${POST_ID}`));
  });

  it('waits for the navigator before opening a cold-start notification', async () => {
    // The classic gap: the response is ready before expo-router has a
    // navigator, and pushing then silently does nothing.
    mockNavState.mockReturnValue(undefined);
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    const view = await render(<NotificationsHost />);
    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();

    mockNavState.mockReturnValue({ key: 'root' });
    await view.rerender(<NotificationsHost />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/post/${POST_ID}`));
  });

  it('waits for the session to resolve before opening', async () => {
    mockUseSession.mockReturnValue({ status: 'loading', userId: null });
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    const view = await render(<NotificationsHost />);
    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();

    mockUseSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
    await view.rerender(<NotificationsHost />);

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
  });

  it('drops a cold-start notification while the app is still on onboarding', async () => {
    mockSegments.mockReturnValue(['onboarding']);
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    const view = await render(<NotificationsHost />);
    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();

    // Finishing onboarding lands on the feed — it must NOT then jump into the
    // post, so the queued response is gone for good.
    mockSegments.mockReturnValue(['(tabs)']);
    await view.rerender(<NotificationsHost />);

    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('drops a QUEUED cold-start notification when the gates resolve on onboarding', async () => {
    // The other onboarding test enters through handleResponse, because the
    // gates are already resolved at first render. This one enters through the
    // QUEUE — the response arrives before the navigator exists — which is the
    // path the component was actually built for, and the one where forgetting
    // to mark it handled let it re-open later.
    mockNavState.mockReturnValue(undefined);
    mockSegments.mockReturnValue(['onboarding']);
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    const view = await render(<NotificationsHost />);
    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();

    // Navigator arrives while still on onboarding — the queue drains and drops.
    mockNavState.mockReturnValue({ key: 'root' });
    await view.rerender(<NotificationsHost />);
    expect(mockPush).not.toHaveBeenCalled();

    // Onboarding finishes. The drop must be permanent, not deferred.
    mockSegments.mockReturnValue(['(tabs)']);
    await view.rerender(<NotificationsHost />);
    expect(mockPush).not.toHaveBeenCalled();

    // And a remount must not resurrect it from the sticky launch response.
    await view.unmount();
    await render(<NotificationsHost />);
    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalledTimes(2));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not open the same launch notification twice', async () => {
    // getLastNotificationResponseAsync is STICKY — it keeps returning the same
    // response, so a remount must not re-open it.
    mockGetLastResponse.mockResolvedValue(responseFor({ type: 'alert', postId: POST_ID }));

    const view = await render(<NotificationsHost />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));

    await view.unmount();
    await render(<NotificationsHost />);

    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalledTimes(2));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('opens a warm tap immediately', async () => {
    await render(<NotificationsHost />);
    await waitFor(() => expect(responseListener).not.toBeNull());

    responseListener?.(responseFor({ type: 'message', threadId: THREAD_ID }, 'notif-warm'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/chat/${THREAD_ID}`));
  });

  it('shows a quiet toast instead of a system banner in the foreground', async () => {
    await render(<NotificationsHost />);
    await waitFor(() => expect(receivedListener).not.toBeNull());

    receivedListener?.({
      request: {
        identifier: 'notif-fg',
        content: { title: 'Stolen car nearby', body: 'A blue BMW', data: { type: 'alert', postId: POST_ID } },
      },
    });

    await waitFor(() => expect(mockToastShow).toHaveBeenCalled());
    const [message, , action] = mockToastShow.mock.calls[0];
    expect(message).toBe('A blue BMW');
    expect(action.label).toBe('View');

    // The toast's action is what navigates — nothing happened without it.
    expect(mockPush).not.toHaveBeenCalled();
    action.onPress();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/post/${POST_ID}`));
  });

  it('ignores a payload that fails the strict schema', async () => {
    // A push carrying more than ids must not be acted on.
    mockGetLastResponse.mockResolvedValue(
      responseFor({ type: 'alert', postId: POST_ID, plate: 'AB12CDE' }),
    );

    await render(<NotificationsHost />);

    await waitFor(() => expect(mockGetLastResponse).toHaveBeenCalled());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
