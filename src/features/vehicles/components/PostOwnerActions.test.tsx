/**
 * WHAT:  Tests for PostOwnerActions — the owner's money and destructive paths,
 *        now shared by the listing page and the My listings long-press sheet:
 *        deactivate (plain, held, the no-reward skip of exit_check, the
 *        attested path, ATTESTATION_STALE), the delete offer after a clean
 *        cancel, both deletes, and the payout retry's three outcomes.
 * WHY:   These moved out of PostDetailScreen on 2026-09-24 so a second surface
 *        could use them, and that screen's suite only ever covered a clean
 *        deactivate and whether the payout row shows. One component, two
 *        hosts — so the component is where the money paths are pinned.
 * LINKS: src/features/vehicles/components/PostOwnerActions.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';

import type { PostDetail } from '../types';
import { PostOwnerActions, type PostOwnerActionsHandle } from './PostOwnerActions';

// --- mocks -------------------------------------------------------------------

const mockToast = jest.fn();
const mockDialogOpen = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text, View } = require('react-native');
  const toastApi = { show: (...args: unknown[]) => mockToast(...args) };
  return {
    useToast: () => toastApi,
    // The sheet: always rendered, so its rows are pressable.
    BottomSheet: React.forwardRef(function MockSheet(
      { children }: { children: React.ReactNode },
      ref: unknown,
    ) {
      React.useImperativeHandle(ref, () => ({ open: jest.fn(), close: jest.fn() }));
      return <View>{children}</View>;
    }),
    ListRow: ({ title, onPress, testID }: { title: string; onPress: () => void; testID?: string }) => (
      <Pressable testID={testID} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    // A confirm records open() by title, and exposes its confirm button.
    ConfirmDialog: React.forwardRef(function MockConfirm(
      { title, onConfirm }: { title: string; onConfirm: () => void },
      ref: unknown,
    ) {
      React.useImperativeHandle(ref, () => ({ open: () => mockDialogOpen(title) }));
      return (
        <Pressable testID={`confirm:${title}`} onPress={onConfirm}>
          <Text>{title}</Text>
        </Pressable>
      );
    }),
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  // usePostMoney re-reads on focus; a mounted test never refocuses.
  useFocusEffect: () => {},
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockExitCheck = jest.fn();
const mockDeactivate = jest.fn();
jest.mock('@/features/payments', () => ({
  exitCheck: (...args: unknown[]) => mockExitCheck(...args),
  useDeactivatePost: () => ({ deactivate: mockDeactivate, pending: false }),
}));

const mockReleasePayout = jest.fn();
jest.mock('../api/recoveryApi', () => {
  class RecoveryError extends Error {}
  return { RecoveryError, releasePayout: (...args: unknown[]) => mockReleasePayout(...args) };
});
const mockDeleteDraft = jest.fn();
jest.mock('../api/draftApi', () => ({ deleteDraft: (...a: unknown[]) => mockDeleteDraft(...a) }));
// The listing's money, read here when the host does not supply it (My
// listings). Null by default; the send-the-reward tests set a state.
const mockFetchMoney = jest.fn();
jest.mock('../api/postMoneyApi', () => ({
  fetchPostMoney: (...a: unknown[]) => mockFetchMoney(...a),
}));
const mockDeleteCancelled = jest.fn();
jest.mock('../api/deletePostApi', () => ({
  deleteCancelledPost: (...a: unknown[]) => mockDeleteCancelled(...a),
}));

jest.mock('./editors', () => ({ PostSectionEditorHost: () => null }));
jest.mock('./ExitAttestation', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text } = require('react-native');
  return {
    ExitAttestation: ({
      sightingIds,
      onConfirm,
      onCancel,
    }: {
      sightingIds: string[];
      onConfirm: (ids: string[]) => void;
      onCancel: () => void;
    }) => (
      <>
        <Pressable testID="attest-confirm" onPress={() => onConfirm(sightingIds)}>
          <Text>{`attesting ${sightingIds.join(',')}`}</Text>
        </Pressable>
        <Pressable testID="attest-cancel" onPress={onCancel} />
      </>
    ),
  };
});

// --- fixtures ----------------------------------------------------------------

const post = (over: Partial<PostDetail> = {}): PostDetail =>
  ({
    id: 'p1',
    isOwner: true,
    status: 'active',
    bountyPence: 25000,
    sightingCount: 2,
    make: 'Ford',
    model: 'Fiesta',
    colour: 'Blue',
    plate: 'AB12 CDE',
    ...over,
  }) as PostDetail;

const mount = async (p: PostDetail | null, extra: { refresh?: jest.Mock; onDeleted?: jest.Mock } = {}) => {
  const refresh = extra.refresh ?? jest.fn();
  const onDeleted = extra.onDeleted ?? jest.fn();
  const ref = createRef<PostOwnerActionsHandle>();
  const view = await render(
    <PostOwnerActions ref={ref} postId="p1" post={p} refresh={refresh} onDeleted={onDeleted} />,
  );
  return { view, ref, refresh, onDeleted };
};

/** Let pre-flights and async handlers settle. */
const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockExitCheck.mockResolvedValue({ requiresAttestation: false, sightingIds: [], holdHours: 72 });
  mockFetchMoney.mockResolvedValue(null);
});

/** get_post_money's answer for a claimed listing, in the given state. */
const moneyIn = (state: string, hasCreditedSighting: boolean) => ({
  kind: 'bounty_escrow',
  pricing: 'fee_on_top',
  state,
  headlinePence: 25000,
  rewardPence: 25000,
  serviceFeePence: 1250,
  chargedPence: 26250,
  hasCreditedSighting,
  paid: null,
  refund: null,
  refundHold: null,
});

// --- tests -------------------------------------------------------------------

describe('send the reward (fixed 2026-09-25)', () => {
  // A held "found it myself" refund ALSO sits in recovery_claimed — with nobody
  // credited — and the row used to appear there too, then fail with "No
  // spotter is credited on this listing". The listing's money decides now.
  it('is offered while a credited spotter is waiting to be paid', async () => {
    mockFetchMoney.mockResolvedValue(moneyIn('awaiting_payee', true));
    const { view } = await mount(post({ status: 'recovery_claimed' }));
    await flush();
    expect(view.getByTestId('manage-release-payout')).toBeTruthy();
  });

  it('is NOT offered on a held no-spotter refund, though the status is the same', async () => {
    mockFetchMoney.mockResolvedValue(moneyIn('refund_on_hold', false));
    const { view } = await mount(post({ status: 'recovery_claimed' }));
    await flush();
    expect(view.queryByTestId('manage-release-payout')).toBeNull();
  });

  it('stays offered when the money read FAILED — a blip must not take the owner’s only action away', async () => {
    mockFetchMoney.mockRejectedValue(new Error('network'));
    const { view } = await mount(post({ status: 'recovery_claimed' }));
    await flush();
    expect(view.getByTestId('manage-release-payout')).toBeTruthy();
  });

  it('is NOT offered before the money is known', async () => {
    mockFetchMoney.mockResolvedValue(null);
    const { view } = await mount(post({ status: 'recovery_claimed' }));
    await flush();
    expect(view.queryByTestId('manage-release-payout')).toBeNull();
  });
});

describe('PostOwnerActions', () => {
  it('renders nothing for anyone but the owner', async () => {
    const { view } = await mount(post({ isOwner: false }));
    expect(view.queryByTestId('manage-view-sightings')).toBeNull();
  });

  // The archive (2026-09-24): the host decides whether to offer it; the sheet
  // shows exactly one of the pair, and only when asked.
  describe('archive', () => {
    const mountWith = (archive?: { archived: boolean; toggle: () => void }) =>
      render(
        <PostOwnerActions
          postId="p1"
          post={post({ status: 'recovered' })}
          refresh={jest.fn()}
          onDeleted={jest.fn()}
          archive={archive}
        />,
      );

    it('offers Archive for a listing in the main list, and runs the toggle', async () => {
      const toggle = jest.fn();
      const view = await mountWith({ archived: false, toggle });

      expect(view.queryByTestId('manage-unarchive')).toBeNull();
      await fireEvent.press(view.getByTestId('manage-archive'));
      expect(toggle).toHaveBeenCalledTimes(1);
    });

    it('offers Unarchive for an archived listing', async () => {
      const view = await mountWith({ archived: true, toggle: jest.fn() });

      expect(view.getByTestId('manage-unarchive')).toBeTruthy();
      expect(view.queryByTestId('manage-archive')).toBeNull();
    });

    it('offers neither when the host passes no archive (the listing page)', async () => {
      const view = await mountWith(undefined);

      expect(view.queryByTestId('manage-archive')).toBeNull();
      expect(view.queryByTestId('manage-unarchive')).toBeNull();
    });
  });

  describe('deactivate', () => {
    it('clean path: pre-flight, the confirm, the exact refund in the toast, a refresh', async () => {
      mockDeactivate.mockResolvedValue({ outcome: 'done', result: { refundedPence: 24000 } });
      const { view, refresh } = await mount(post());

      await fireEvent.press(view.getByTestId('manage-deactivate'));
      await flush();
      expect(mockExitCheck).toHaveBeenCalledWith('p1');
      expect(mockDialogOpen).toHaveBeenCalledWith('Deactivate this listing?');

      await fireEvent.press(view.getByTestId('confirm:Deactivate this listing?'));
      await flush();
      expect(mockDeactivate).toHaveBeenCalledWith('p1');
      expect(mockToast).toHaveBeenCalledWith('Listing deactivated — £240 refunded');
      expect(refresh).toHaveBeenCalled();
    });

    // ADR-0014: exit_check knows nothing about pricing, and on a no-reward
    // listing would open an attestation promising a refund that isn't coming.
    it('skips the exit_check pre-flight on a no-reward listing', async () => {
      const { view } = await mount(post({ bountyPence: null }));

      await fireEvent.press(view.getByTestId('manage-deactivate'));
      await flush();

      expect(mockExitCheck).not.toHaveBeenCalled();
      expect(mockDialogOpen).toHaveBeenCalledWith('Deactivate this listing?');
    });

    it('a zero refund says "deactivated", never "£0 refunded"', async () => {
      mockDeactivate.mockResolvedValue({ outcome: 'done', result: { refundedPence: 0 } });
      const { view } = await mount(post({ bountyPence: null }));

      await fireEvent.press(view.getByTestId('confirm:Deactivate this listing?'));
      await flush();

      expect(mockToast).toHaveBeenCalledWith('Listing deactivated');
    });

    it('a held refund names the date and refreshes', async () => {
      mockDeactivate.mockResolvedValue({ outcome: 'held', refundAfter: '2026-09-27T10:00:00Z' });
      const { view, refresh } = await mount(post());

      await fireEvent.press(view.getByTestId('confirm:Deactivate this listing?'));
      await flush();

      expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/^Listing deactivated\. Your refund is sent after /));
      expect(refresh).toHaveBeenCalled();
    });

    // The owner-denial gate: recent sightings detour through the attestation,
    // and what is sent is EXACTLY what the owner was shown.
    it('recent sightings open the attestation, and exactly those ids are attested', async () => {
      mockExitCheck.mockResolvedValue({ requiresAttestation: true, sightingIds: ['s1', 's2'], holdHours: 72 });
      mockDeactivate.mockResolvedValue({ outcome: 'held', refundAfter: '2026-09-27T10:00:00Z' });
      const { view } = await mount(post());

      await fireEvent.press(view.getByTestId('manage-deactivate'));
      await flush();
      expect(mockDialogOpen).not.toHaveBeenCalled(); // the attestation, not the plain confirm
      expect(view.getByText('attesting s1,s2')).toBeTruthy();

      await fireEvent.press(view.getByTestId('attest-confirm'));
      await flush();
      expect(mockDeactivate).toHaveBeenCalledWith('p1', ['s1', 's2']);
      expect(view.queryByTestId('attest-confirm')).toBeNull(); // closed after the hold
    });

    it('ATTESTATION_STALE re-fetches the set and asks again', async () => {
      mockExitCheck
        .mockResolvedValueOnce({ requiresAttestation: true, sightingIds: ['s1'], holdHours: 72 })
        .mockResolvedValueOnce({ requiresAttestation: true, sightingIds: ['s1', 's3'], holdHours: 72 });
      mockDeactivate.mockResolvedValue({
        outcome: 'error',
        code: 'ATTESTATION_STALE',
        message: 'A new sighting arrived.',
      });
      const { view } = await mount(post());

      await fireEvent.press(view.getByTestId('manage-deactivate'));
      await flush();
      await fireEvent.press(view.getByTestId('attest-confirm'));
      await flush();

      expect(mockToast).toHaveBeenCalledWith('A new sighting arrived.', 'error');
      expect(mockExitCheck).toHaveBeenCalledTimes(2);
      expect(view.getByText('attesting s1,s3')).toBeTruthy();
    });

    // "If a user cancels a post they should have an option … to delete it" —
    // once the refresh shows it cancelled, and only after a CLEAN cancel.
    it('offers the delete once a clean cancel has refreshed to cancelled', async () => {
      mockDeactivate.mockResolvedValue({ outcome: 'done', result: { refundedPence: 24000 } });
      const { view, refresh, onDeleted } = await mount(post());

      await fireEvent.press(view.getByTestId('confirm:Deactivate this listing?'));
      await flush();
      await view.rerender(
        <PostOwnerActions postId="p1" post={post({ status: 'cancelled' })} refresh={refresh} onDeleted={onDeleted} />,
      );

      expect(mockDialogOpen).toHaveBeenCalledWith('Delete this listing?');
    });
  });

  describe('delete', () => {
    it('a draft delete hands back to the host', async () => {
      mockDeleteDraft.mockResolvedValue(undefined);
      const { view, onDeleted } = await mount(post({ status: 'draft' }));

      await fireEvent.press(view.getByTestId('confirm:Delete this draft?'));
      await flush();

      expect(mockDeleteDraft).toHaveBeenCalledWith('p1');
      expect(mockToast).toHaveBeenCalledWith('Draft deleted');
      expect(onDeleted).toHaveBeenCalled();
    });

    it('a refused listing delete says why and does NOT hand back', async () => {
      mockDeleteCancelled.mockRejectedValue(new Error('A refund is still settling.'));
      const { view, onDeleted } = await mount(post({ status: 'cancelled' }));

      await fireEvent.press(view.getByTestId('confirm:Delete this listing?'));
      await flush();

      expect(mockToast).toHaveBeenCalledWith('A refund is still settling.', 'error');
      expect(onDeleted).not.toHaveBeenCalled();
    });
  });

  describe('send the reward', () => {
    it.each([
      [{ status: 'paid', transferPence: 23750 }, 'Sent. £237.50 is on its way to them.', true],
      [
        { status: 'awaiting_payee', transferPence: null },
        'Not yet — they still need to add their bank details. It’ll send automatically when they do.',
        false,
      ],
      [
        { status: 'held_for_review', transferPence: null },
        'We’re just double-checking this payout — no need to do anything.',
        false,
      ],
    ])('%o → the right words', async (payout, words, refreshes) => {
      mockReleasePayout.mockResolvedValue(payout);
      // The row needs a credited spotter waiting to be paid (2026-09-25).
      mockFetchMoney.mockResolvedValue(moneyIn('awaiting_payee', true));
      const { view, refresh } = await mount(post({ status: 'recovery_claimed' }));
      await flush();

      await fireEvent.press(view.getByTestId('manage-release-payout'));
      await flush();

      expect(mockReleasePayout).toHaveBeenCalledWith('p1');
      expect(mockToast).toHaveBeenCalledWith(words);
      expect(refresh).toHaveBeenCalledTimes(refreshes ? 1 : 0);
    });
  });

  it('reports busy while an attestation is open — a host must not replace it', async () => {
    mockExitCheck.mockResolvedValue({ requiresAttestation: true, sightingIds: ['s1'], holdHours: 72 });
    const { view, ref } = await mount(post());
    expect(ref.current?.isBusy()).toBe(false);

    await fireEvent.press(view.getByTestId('manage-deactivate'));
    await flush();

    expect(ref.current?.isBusy()).toBe(true);
  });
});
