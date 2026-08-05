/**
 * WHAT:  Tests for useTabAuthGate — the hold-and-sheet tabPress contract both
 *        guest-facing tabs run: a non-member's press is prevented and gated
 *        with the tab's own context, the continuation lands on that tab, and a
 *        member's press is left completely alone.
 * WHY:   This is the ONE implementation behind Profile and Inbox, and its
 *        failure mode is silent — a gate that stops preventing the press just
 *        navigates, and the guest reads an empty screen where the sheet should
 *        have been. That is exactly the bug that put Inbox on this hook, so
 *        both contexts are pinned here rather than trusting one to imply the
 *        other. The layout that wires them (src/app/(tabs)/_layout.tsx) cannot
 *        hold a test of its own — anything under src/app becomes a route.
 * LINKS: src/features/auth/gate/useTabAuthGate.ts; docs/TESTING.md;
 *        src/features/profile/hooks/useProfileTab.test.tsx (the Profile tab's
 *        label/icon half).
 */

import { renderHook } from '@testing-library/react-native';

import type { AuthStanding } from '../hooks/useAuthStanding';
import { useTabAuthGate } from './useTabAuthGate';

const mockStanding = jest.fn<AuthStanding, []>();
const mockRequireAuth = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../hooks/useAuthStanding', () => ({
  useAuthStanding: () => mockStanding(),
}));
jest.mock('./useRequireAuth', () => ({
  useRequireAuth: () => mockRequireAuth,
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

const pressEvent = () => ({ preventDefault: jest.fn() });

const TABS = [
  { name: 'Inbox', context: 'tab_inbox' as const, route: '/(tabs)/inbox' as const },
  { name: 'Profile', context: 'tab_profile' as const, route: '/(tabs)/profile' as const },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each(TABS)('$name tab', ({ context, route }) => {
  it('a guest press is prevented and gated — nothing navigates', async () => {
    mockStanding.mockReturnValue('guest');
    const { result } = await renderHook(() => useTabAuthGate({ context, route }));

    const event = pressEvent();
    result.current.tabPress(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockRequireAuth).toHaveBeenCalledWith({ context, run: expect.any(Function) });
    // Dismissing the sheet drops the intent, so the guest must still be
    // standing on the tab they pressed FROM.
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("the gate's continuation lands on this tab", async () => {
    mockStanding.mockReturnValue('guest');
    const { result } = await renderHook(() => useTabAuthGate({ context, route }));

    result.current.tabPress(pressEvent());
    const intent = mockRequireAuth.mock.calls[0][0] as { run: () => void };
    intent.run();

    expect(mockNavigate).toHaveBeenCalledWith(route);
  });

  it('an incomplete session (orphaned signup) gates like a guest', async () => {
    mockStanding.mockReturnValue('incomplete');
    const { result } = await renderHook(() => useTabAuthGate({ context, route }));

    const event = pressEvent();
    result.current.tabPress(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockRequireAuth).toHaveBeenCalledWith(expect.objectContaining({ context }));
  });

  it("'loading' gates too — the sheet self-resolves for a restoring member", async () => {
    mockStanding.mockReturnValue('loading');
    const { result } = await renderHook(() => useTabAuthGate({ context, route }));

    const event = pressEvent();
    result.current.tabPress(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockRequireAuth).toHaveBeenCalledWith(expect.objectContaining({ context }));
  });

  it('a member press is left alone — no preventDefault, no gate', async () => {
    mockStanding.mockReturnValue('member');
    const { result } = await renderHook(() => useTabAuthGate({ context, route }));

    const event = pressEvent();
    result.current.tabPress(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });
});
