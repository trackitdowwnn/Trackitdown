/**
 * WHAT:  Tests for the alert-nudge flag and the post-view counter — including
 *        both fail-soft directions, which are opposites and easy to invert.
 * WHY:   The flag fails CLOSED (unreadable → "already offered" → stay quiet) so
 *        a storage fault can't re-nag someone who declined. The counter fails
 *        closed too (→ 0, below threshold) so a fault can't fire the sheet at
 *        someone who has opened one listing. Both are one character from being
 *        backwards and neither is visible in review.
 * LINKS: src/features/notifications/lib/alertNudgeStorage.ts, docs/TESTING.md.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ALERT_NUDGE_POST_VIEWS_KEY,
  ALERT_NUDGE_STORAGE_KEY,
  ALERT_NUDGE_VIEW_THRESHOLD,
  bumpAlertNudgePostViews,
  hasOfferedAlertNudge,
  markAlertNudgeOffered,
} from './alertNudgeStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const mockStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.getItem.mockResolvedValue(null);
  mockStorage.setItem.mockResolvedValue(undefined);
});

describe('the offered flag', () => {
  it('is false for someone never offered', async () => {
    await expect(hasOfferedAlertNudge()).resolves.toBe(false);
  });

  it('is true once marked', async () => {
    mockStorage.getItem.mockResolvedValue('true');
    await expect(hasOfferedAlertNudge()).resolves.toBe(true);
  });

  it('marks the offer under the versioned key', async () => {
    await markAlertNudgeOffered();
    expect(mockStorage.setItem).toHaveBeenCalledWith(ALERT_NUDGE_STORAGE_KEY, 'true');
  });

  // INVERTED fail-soft: a broken read must SUPPRESS, not re-nag.
  it('reports "already offered" when storage is unreadable', async () => {
    mockStorage.getItem.mockRejectedValue(new Error('nope'));
    await expect(hasOfferedAlertNudge()).resolves.toBe(true);
  });

  it('never throws when the write fails', async () => {
    mockStorage.setItem.mockRejectedValue(new Error('nope'));
    await expect(markAlertNudgeOffered()).resolves.toBeUndefined();
  });
});

describe('the post-view counter', () => {
  it('starts at one', async () => {
    await expect(bumpAlertNudgePostViews()).resolves.toBe(1);
    expect(mockStorage.setItem).toHaveBeenCalledWith(ALERT_NUDGE_POST_VIEWS_KEY, '1');
  });

  it('increments an existing total', async () => {
    mockStorage.getItem.mockResolvedValue('2');
    await expect(bumpAlertNudgePostViews()).resolves.toBe(ALERT_NUDGE_VIEW_THRESHOLD);
    expect(mockStorage.setItem).toHaveBeenCalledWith(ALERT_NUDGE_POST_VIEWS_KEY, '3');
  });

  it('treats a corrupt value as no history rather than poisoning the total', async () => {
    mockStorage.getItem.mockResolvedValue('not-a-number');
    await expect(bumpAlertNudgePostViews()).resolves.toBe(1);
  });

  // Fails CLOSED: 0 is below the threshold, so a storage fault costs a nudge
  // rather than firing one at someone who has opened a single listing.
  it('returns 0 when storage is unreadable, which cannot reach the threshold', async () => {
    mockStorage.getItem.mockRejectedValue(new Error('nope'));
    const views = await bumpAlertNudgePostViews();
    expect(views).toBe(0);
    expect(views).toBeLessThan(ALERT_NUDGE_VIEW_THRESHOLD);
  });

  it('returns 0 when the write fails', async () => {
    mockStorage.setItem.mockRejectedValue(new Error('nope'));
    await expect(bumpAlertNudgePostViews()).resolves.toBe(0);
  });
});
