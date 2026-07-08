/**
 * WHAT:  Tests for useFullscreenLoader — run() showing/hiding around
 *        success AND failure (the critical always-hide guarantee),
 *        rethrowing, and mid-flight message updates.
 * WHY:   Screens wrap escrow payments and payout confirmations in run();
 *        a loader that stays stuck after an error would trap the user on
 *        a blank page at the worst possible moment.
 * LINKS: src/shared/hooks/useFullscreenLoader.ts, docs/TESTING.md.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useFullscreenLoader } from './useFullscreenLoader';

describe('useFullscreenLoader', () => {
  it('shows during run and hides after it resolves, returning the value', async () => {
    const { result } = await renderHook(() => useFullscreenLoader());

    let resolveOperation!: (value: string) => void;
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });

    let runResult: Promise<string>;
    await act(async () => {
      runResult = result.current.run(() => operation, 'Uploading photos…');
    });

    expect(result.current.loaderProps).toEqual({
      visible: true,
      message: 'Uploading photos…',
    });

    await act(async () => {
      resolveOperation('done');
      await runResult;
    });

    expect(result.current.loaderProps.visible).toBe(false);
    await expect(runResult!).resolves.toBe('done');
  });

  it('ALWAYS hides on failure and rethrows for the caller', async () => {
    const { result } = await renderHook(() => useFullscreenLoader());

    let rejected: unknown;
    await act(async () => {
      try {
        await result.current.run(async () => {
          throw new Error('card declined');
        }, 'Processing payment…');
      } catch (error) {
        rejected = error;
      }
    });

    expect((rejected as Error).message).toBe('card declined');
    expect(result.current.loaderProps.visible).toBe(false);
  });

  it('keeps the loader up until the LAST of overlapping runs settles', async () => {
    const { result } = await renderHook(() => useFullscreenLoader());

    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });

    let firstRun: Promise<void>;
    let secondRun: Promise<void>;
    await act(async () => {
      firstRun = result.current.run(() => first);
      secondRun = result.current.run(() => second);
    });

    await act(async () => {
      finishFirst();
      await firstRun;
    });
    expect(result.current.loaderProps.visible).toBe(true); // second still going

    await act(async () => {
      finishSecond();
      await secondRun;
    });
    expect(result.current.loaderProps.visible).toBe(false);
  });

  it('a message-less overlapping run never blanks the sibling run’s message', async () => {
    const { result } = await renderHook(() => useFullscreenLoader());

    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });

    let firstRun: Promise<void>;
    let secondRun: Promise<void>;
    await act(async () => {
      firstRun = result.current.run(() => first, 'Uploading photos…');
      secondRun = result.current.run(() => second); // no message
    });

    expect(result.current.loaderProps.message).toBe('Uploading photos…');

    await act(async () => {
      finishFirst();
      finishSecond();
      await Promise.all([firstRun, secondRun]);
    });
  });

  it('update() re-points the message mid-flight', async () => {
    const { result } = await renderHook(() => useFullscreenLoader());

    let finish!: () => void;
    const operation = new Promise<void>((resolve) => {
      finish = resolve;
    });

    let runResult: Promise<void>;
    await act(async () => {
      runResult = result.current.run(() => operation, 'Uploading photos…');
    });
    await act(async () => {
      result.current.update('Processing payment…');
    });

    expect(result.current.loaderProps.message).toBe('Processing payment…');

    await act(async () => {
      finish();
      await runResult;
    });
  });
});
