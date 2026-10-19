/**
 * WHAT:  Tests for PostManageSheet's deactivate row — the ONLY way to
 *        deactivate since 2026-10-16, so it must say what happens to the money.
 * WHY:   It always read "Deactivate & refund · refunds your reward", which was
 *        false on a £5 fee listing and on a reward that had already ended. The
 *        page's own deactivate block used to say the true thing; that block is
 *        gone, so the row carries it now.
 * LINKS: ./PostManageSheet.tsx; ./PostOwnerActions.tsx (passes the kind);
 *        ../lib/noRewardKind.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { PostManageSheet } from './PostManageSheet';

jest.mock('@gorhom/bottom-sheet', () => jest.requireActual('@gorhom/bottom-sheet/mock'));
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const renderSheet = (props: Partial<Parameters<typeof PostManageSheet>[0]> = {}) =>
  render(
    <PostManageSheet
      onViewSightings={jest.fn()}
      onViewStats={jest.fn()}
      sightingCount={0}
      onShare={jest.fn()}
      onDeactivate={jest.fn()}
      {...props}
    />,
  );

describe('PostManageSheet — the deactivate row', () => {
  it.each([
    ['refund', 'Deactivate & refund', /refunds your reward, minus the card fee/],
    ['fee', 'Deactivate listing', /£5 listing fee isn’t refunded/],
    ['ended', 'Deactivate listing', /Your reward already went back/],
    ['unknown', 'Deactivate listing', /no reward held to refund/],
  ] as const)('%s: "%s" and the true money line', async (kind, title, line) => {
    const view = await renderSheet({ deactivateKind: kind });
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText(line)).toBeTruthy();
  });

  it('a reward listing is the default — the row is unchanged for callers that pass no kind', async () => {
    const view = await renderSheet();
    expect(view.getByText('Deactivate & refund')).toBeTruthy();
  });

  it('⚠️ a fee listing never promises a refund', async () => {
    const view = await renderSheet({ deactivateKind: 'fee' });
    expect(view.queryByText('Deactivate & refund')).toBeNull();
    expect(view.queryByText(/refunds your reward/)).toBeNull();
  });

  it('the row asks the parent to confirm — it never deactivates by itself', async () => {
    const onDeactivate = jest.fn();
    const view = await renderSheet({ onDeactivate, deactivateKind: 'fee' });
    await act(async () => {
      fireEvent.press(view.getByTestId('manage-deactivate'));
    });
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it('no deactivate handler, no row (drafts, closed listings)', async () => {
    const view = await renderSheet({ onDeactivate: undefined });
    expect(view.queryByTestId('manage-deactivate')).toBeNull();
  });
});
