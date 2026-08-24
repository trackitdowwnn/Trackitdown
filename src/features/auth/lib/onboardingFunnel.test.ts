/**
 * WHAT:  Tests for the onboarding funnel — what it sends, and the two things it
 *        must never do.
 * WHY:   This is data collected from somebody who has not signed up for
 *        anything, so the constraints that make it defensible are the ones
 *        worth pinning: the run id never leaves memory, and a failure never
 *        reaches the person reading the slides.
 * LINKS: ./onboardingFunnel.ts;
 *        supabase/migrations/20260824190000_onboarding_funnel.sql.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  endOnboardingRun,
  resetOnboardingRunForTests,
  startOnboardingRun,
  trackOnboardingStep,
} from './onboardingFunnel';

const mockRpc = jest.fn();
jest.mock('@/shared/api', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetOnboardingRunForTests();
  mockRpc.mockResolvedValue({ error: null });
});

describe('what it sends', () => {
  it('records a slide with its number', async () => {
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 2);

    expect(mockRpc).toHaveBeenCalledWith(
      'record_onboarding_step',
      expect.objectContaining({ p_step: 'slide_viewed', p_slide: 2 }),
    );
  });

  it('records the two ways a run ends, with no slide', async () => {
    startOnboardingRun();
    trackOnboardingStep('completed');

    expect(mockRpc).toHaveBeenCalledWith(
      'record_onboarding_step',
      expect.objectContaining({ p_step: 'completed', p_slide: null }),
    );
  });

  it('keeps one run id across every step of a run', async () => {
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);
    trackOnboardingStep('slide_viewed', 2);
    trackOnboardingStep('completed');

    const ids = mockRpc.mock.calls.map((call) => call[1].p_run_id);
    expect(new Set(ids).size).toBe(1);
    // The whole point of having an id: three ticks that are one journey.
    expect(ids).toHaveLength(3);
  });

  it('gives a NEW run a different id', async () => {
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);
    endOnboardingRun();

    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);

    const [first, second] = mockRpc.mock.calls.map((call) => call[1].p_run_id);
    expect(first).not.toBe(second);
  });

  it('a re-mount mid-run keeps the run it already had', async () => {
    // startOnboardingRun is called from an effect; a re-render must not split
    // one journey into two and halve the completion rate.
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 2);

    const ids = mockRpc.mock.calls.map((call) => call[1].p_run_id);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('⚠️ what it must never do', () => {
  it('sends nothing at all when no run is open', async () => {
    // Revisit mode: somebody re-reading the intro from Profile. Counting it
    // would inflate both ends of the funnel with people who already finished,
    // and drift the completion rate upward every time the tour was browsed.
    trackOnboardingStep('slide_viewed', 1);
    trackOnboardingStep('completed');

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('⚠️ never writes the run id to storage', async () => {
    // The single constraint the whole design rests on. Persisted, this stops
    // being an anonymous counter and becomes tracking of somebody who has not
    // signed up for anything.
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);
    trackOnboardingStep('completed');
    endOnboardingRun();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('⚠️ never carries a user, device or install identifier', async () => {
    startOnboardingRun();
    trackOnboardingStep('slide_viewed', 1);

    const params = mockRpc.mock.calls[0][1];
    expect(Object.keys(params).sort()).toEqual([
      'p_platform',
      'p_run_id',
      'p_slide',
      'p_step',
    ]);
  });

  it('⚠️ never throws when the write fails', async () => {
    // Somebody reading four slides must not meet an error because a counter
    // did not write. An unhandled rejection here is a red box over the first
    // thing anyone sees.
    mockRpc.mockRejectedValue(new Error('offline'));

    startOnboardingRun();
    expect(() => trackOnboardingStep('slide_viewed', 1)).not.toThrow();

    // Let the swallowed rejection settle — an unhandled one fails the suite.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does not block on the write', async () => {
    // Returns void, not a promise: nothing upstream can accidentally await it
    // and put a network round trip in front of a slide transition.
    startOnboardingRun();
    expect(trackOnboardingStep('slide_viewed', 1)).toBeUndefined();
  });
});
