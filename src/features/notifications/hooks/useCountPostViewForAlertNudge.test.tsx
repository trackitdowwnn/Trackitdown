/**
 * WHAT:  Tests the post-view counter hook — it counts on UNMOUNT, raises the
 *        offer from the third listing ONWARDS, and goes silent once the sheet
 *        has actually recorded the offer.
 * WHY:   This decides WHEN the app interrupts someone. Counting on mount would
 *        drop the sheet on top of the listing they just tapped. And the
 *        threshold must be `>=`, not `==`: the sheet suppresses without marking
 *        offered in several cases, so an exact match let a guest cross the
 *        threshold, get suppressed, and then miss by one forever. The offered
 *        FLAG is what stops the nag, not the arithmetic.
 * LINKS: src/features/notifications/hooks/useCountPostViewForAlertNudge.ts,
 *        docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';

import { requestAlertNudge } from '../lib/alertNudgeIntent';
import { bumpAlertNudgePostViews, hasOfferedAlertNudge } from '../lib/alertNudgeStorage';
import { useCountPostViewForAlertNudge } from './useCountPostViewForAlertNudge';

jest.mock('../lib/alertNudgeIntent', () => ({ requestAlertNudge: jest.fn() }));
// requireActual below pulls the real storage module in for ALERT_NUDGE_VIEWS_
// THRESHOLD (so this test can't drift from the real number), and that module
// imports AsyncStorage — whose native side is null under jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));
jest.mock('../lib/alertNudgeStorage', () => ({
  ...jest.requireActual('../lib/alertNudgeStorage'),
  hasOfferedAlertNudge: jest.fn(),
  bumpAlertNudgePostViews: jest.fn(),
}));

const mockOffered = hasOfferedAlertNudge as jest.MockedFunction<typeof hasOfferedAlertNudge>;
const mockBump = bumpAlertNudgePostViews as jest.MockedFunction<typeof bumpAlertNudgePostViews>;
const mockRequest = requestAlertNudge as jest.MockedFunction<typeof requestAlertNudge>;

function Probe() {
  useCountPostViewForAlertNudge();
  return null;
}

/** Mount, then unmount — the unmount is where the counting happens. */
const viewAndLeave = async () => {
  const view = await act(async () => render(<Probe />));
  await act(async () => {
    view.unmount();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOffered.mockResolvedValue(false);
  mockBump.mockResolvedValue(1);
});

describe('useCountPostViewForAlertNudge', () => {
  it('counts nothing while the listing is still open', async () => {
    await act(async () => render(<Probe />));

    expect(mockBump).not.toHaveBeenCalled();
  });

  it('counts the view once they leave', async () => {
    await viewAndLeave();

    expect(mockBump).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('raises the offer on the third listing', async () => {
    mockBump.mockResolvedValue(3);

    await viewAndLeave();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  // REGRESSION: this used to assert the opposite, encoding a bug. The sheet
  // suppresses without marking offered in several cases (signed out, the
  // garage sheet holding the slot, alerts still resolving), so an exact-equals
  // check let a guest cross the threshold, get suppressed, and then miss by one
  // forever — the offer dead for the life of the install, including after they
  // register. The nag is prevented by the offered-flag early return instead.
  it('keeps raising the offer past the threshold until it is actually made', async () => {
    mockBump.mockResolvedValue(4);

    await viewAndLeave();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('stops for good once the sheet has recorded the offer', async () => {
    mockOffered.mockResolvedValue(true);
    mockBump.mockResolvedValue(9);

    await viewAndLeave();

    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('costs one read and no writes once the offer has been made', async () => {
    mockOffered.mockResolvedValue(true);

    await viewAndLeave();

    expect(mockOffered).toHaveBeenCalledTimes(1);
    expect(mockBump).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
