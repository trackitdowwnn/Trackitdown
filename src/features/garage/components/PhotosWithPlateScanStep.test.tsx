/**
 * WHAT:  Tests for the garage photos step that reads a plate from the photos
 *        an owner adds.
 * WHY:   The valuable assertions here are the SILENCES. This runs on its own,
 *        uninvited, while somebody is doing something else — so the failure
 *        that matters is not "it didn't find the plate", it is "it interrupted
 *        when it had nothing to say", or worse, "it overwrote a plate the owner
 *        had typed correctly".
 *
 *        The OCR engine is mocked at the module boundary: no native module, no
 *        camera, no device. What is being tested is the decision logic around
 *        it (see plateCandidates.test.ts for the reading itself).
 * LINKS: ./PhotosWithPlateScanStep.tsx; ./PlateScanSheet.tsx;
 *        src/shared/lib/plateCandidates.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { motion } from '@/shared/theme';

import { PLATE_SCAN_LABEL, PhotosWithPlateScanStep } from './PhotosWithPlateScanStep';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Records whether the sheet was ever opened. Named mockOpened so jest's
// hoisted factory below may reference it (the `mock` prefix is the escape
// hatch for its out-of-scope-variable check).
const mockOpened = { current: false };
/** BottomSheet's own ANIMATION_DURATION_MS — the window this mock reproduces. */
const mockSheetCloseMs = 250;
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  // Renders its children only once presented, like the real modal — so the
  // sheet's buttons are pressable in a test, without the "couldn't read it"
  // copy existing in the tree while the sheet is shut.
  //
  // dismiss() is DEFERRED and fires onDismiss, because the real one is: gorhom
  // keeps children mounted for the whole close animation and only calls
  // onDismiss at the end of it (BottomSheetModal's unmount()). A mock that
  // closed instantly and stayed silent hid every defect that lives in that
  // window — including cleanup running twice, once with the question already
  // cleared. The re-entrancy guard mirrors BottomSheet's presentedRef, which
  // makes close() a no-op unless the sheet is actually open.
  class TrackingModal extends React.Component<
    { children?: unknown; onDismiss?: () => void },
    { open: boolean }
  > {
    state = { open: false };
    timer: ReturnType<typeof setTimeout> | null = null;
    present = () => {
      mockOpened.current = true;
      this.setState({ open: true });
    };
    dismiss = () => {
      if (!this.state.open || this.timer) {
        return;
      }
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setState({ open: false });
        this.props.onDismiss?.();
      }, mockSheetCloseMs);
    };
    componentWillUnmount() {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    }
    render() {
      return this.state.open ? this.props.children : null;
    }
  }
  return {
    ...mock,
    BottomSheetModal: TrackingModal,
    BottomSheetScrollView: (props: object) =>
      React.createElement(ReactNative.ScrollView, props),
  };
});

// The shared photos step, reduced to the two things this wrapper cares about:
// it hands photos back through setAnswers, and it renders whatever per-tile
// status it is given. The status map is captured rather than rendered, because
// which URI is dimmed is the whole assertion.
let emit: ((photos: unknown) => void) | null = null;
let tileStatus: Record<string, { kind: string; label?: string }> | undefined;
/** Every distinct uri that has been dimmed, in order — proof that it MOVES. */
let mockDimmedOrder: string[] = [];
jest.mock('@/features/vehicles', () => ({
  PhotosStep: ({
    setAnswers,
    status,
  }: {
    setAnswers: (patch: unknown) => void;
    status?: Record<string, { kind: string; label?: string }>;
  }) => {
    emit = (photos) => setAnswers({ photos });
    tileStatus = status;
    const uri = status ? Object.keys(status)[0] : undefined;
    if (uri && mockDimmedOrder[mockDimmedOrder.length - 1] !== uri) {
      mockDimmedOrder.push(uri);
    }
    return null;
  },
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => ({
      resize: () => {},
      renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file://scan.jpg' }) }),
    }),
  },
}));

let mockBlocks: unknown[] = [];
let mockStatus: 'ok' | 'unavailable' = 'ok';
// Held open by gateScan() so a test can observe the MIDDLE of a scan. Null by
// default, so every pre-existing test keeps its instant-resolve behaviour.
let mockGate: Promise<void> | null = null;
// Per-call blocks, shifted as the recogniser is called — lets a test say
// "the plate is only in the SECOND photo".
let mockBlocksByCall: unknown[][] | null = null;
const mockRecognise = jest.fn(async () => {
  if (mockGate) {
    await mockGate;
  }
  if (mockStatus !== 'ok') {
    return { status: 'unavailable' };
  }
  const blocks = mockBlocksByCall ? (mockBlocksByCall.shift() ?? []) : mockBlocks;
  return { status: 'ok', blocks };
});
jest.mock('@/shared/lib/ocr/textRecognition', () => ({
  recogniseText: (...args: unknown[]) => mockRecognise(...(args as [])),
}));

// What the feature SAYS about itself. These events are the only measure of
// whether a scan is worth running, so a rejection logged on a confirmation —
// or logged twice — is not cosmetic: it makes the numbers a lie.
const mockLogInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    // A getter, not a spread value: the real ToastProvider cannot be rendered
    // here (reanimated is mapped to its mock, which has no useReducedMotion).
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

const plateBlock = (text: string) => ({
  text,
  box: { x: 0, y: 0, width: 460, height: 100 },
});

const addPhoto = async (uri = 'file://a.jpg') => {
  await act(async () => {
    emit?.([{ uri, width: 100, height: 100 }]);
  });
};

/** Emit a whole set at once — for reorders and multi-photo bursts. */
const addPhotos = async (uris: string[]) => {
  await act(async () => {
    emit?.(uris.map((uri) => ({ uri, width: 100, height: 100 })));
  });
};

/**
 * Hold every recogniser call open until the returned release() is called, so a
 * test can look at the screen WHILE a scan is running. Without this the whole
 * scan resolves inside the same `await act(...)` that started it.
 */
const gateScan = () => {
  let open!: () => void;
  mockGate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return async () => {
    mockGate = null;
    open();
    // Let the drain loop run to completion (and any queued second batch).
    // Each photo is a chain of awaits — resize, save, recognise — so one tick
    // is not enough.
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) {
        await Promise.resolve();
      }
    });
  };
};

const renderStep = (plate?: string) =>
  act(async () =>
    render(
      <PhotosWithPlateScanStep
        answers={plate ? { plate } : {}}
        setAnswers={setAnswers}
      />,
    ),
  );

let setAnswers: jest.Mock;

/**
 * Drive a scan to completion. The loop deliberately WAITS between photos (so a
 * tile can be seen), so flushing microtasks is no longer enough — timers have
 * to move too, and each photo is a chain of awaits behind them.
 */
const settle = async () => {
  // One act() per tick, deliberately. Batching the whole loop into a single
  // act() coalesces every intermediate render, so the dim on photo two would
  // never be committed — it would look like the scan skipped straight from
  // photo one to finished.
  for (let round = 0; round < 60; round += 1) {
    await act(async () => {
      jest.advanceTimersByTime(motion.loaderMinVisible / 2);
      await Promise.resolve();
    });
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  setAnswers = jest.fn();
  emit = null;
  mockOpened.current = false;
  mockStatus = 'ok';
  mockBlocks = [plateBlock('AB12 CDE')];
  mockBlocksByCall = null;
  mockGate = null;
  tileStatus = undefined;
  mockDimmedOrder = [];
  mockLogInfo.mockClear();
  mockShowToast.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

/** The uri of the photo currently dimmed, or null when no tile is. */
const dimmedUri = () => {
  const entries = Object.entries(tileStatus ?? {});
  return entries.length > 0 ? entries[0][0] : null;
};

describe('the silences — what it must NOT do', () => {
  it('says nothing when no plate is readable', async () => {
    mockBlocks = [plateBlock('HIGH STREET'), plateBlock('PAY HERE')];
    await renderStep();
    await addPhoto();

    expect(mockOpened.current).toBe(false);
  });

  it('says nothing when the reading AGREES with what they typed', async () => {
    // A "✓ plate verified" confirmation is noise: they already know, and they
    // were right. Interrupting to agree is the fastest way to make people
    // resent a feature that runs on its own.
    await renderStep('AB12 CDE');
    await addPhoto();

    expect(mockOpened.current).toBe(false);
  });

  it('agrees regardless of spacing or case', async () => {
    await renderStep('ab12cde');
    await addPhoto();

    expect(mockOpened.current).toBe(false);
  });

  it('says nothing, and never throws, when the recogniser is unavailable', async () => {
    // The native module may not be present or may fail. Adding a photo must
    // not break because of it — the plate is optional and typing works.
    mockStatus = 'unavailable';
    await renderStep();
    await addPhoto();

    expect(mockOpened.current).toBe(false);
  });

  it('NEVER writes a plate on its own', async () => {
    // The single most important assertion in this file. Detection may only
    // ever ASK; only an explicit confirmation writes to answers.
    await renderStep();
    await addPhoto();

    const wrotePlate = setAnswers.mock.calls.some(
      ([patch]) => patch && Object.hasOwn(patch, 'plate'),
    );
    expect(wrotePlate).toBe(false);
  });
});

describe('when it has something to say', () => {
  it('asks when a plate is read and the field is empty', async () => {
    await renderStep();
    await addPhoto();

    expect(mockOpened.current).toBe(true);
  });

  it('asks when the reading DISAGREES with what they typed', async () => {
    await renderStep('XY34 ZZZ');
    await addPhoto();

    expect(mockOpened.current).toBe(true);
  });
});

describe('showing WHICH photo it is reading', () => {
  // The dimmed tile is the only thing this feature shows on its own. These
  // tests are about which tile carries it, that it MOVES, and — most
  // importantly — that it always comes off again.
  it('dims the photo it is reading, and no other', async () => {
    const release = gateScan();
    await renderStep();
    expect(dimmedUri()).toBeNull();

    await addPhoto('file://one.jpg');
    expect(dimmedUri()).toBe('file://one.jpg');
    expect(tileStatus?.['file://one.jpg']).toEqual({
      kind: 'busy',
      label: PLATE_SCAN_LABEL,
    });

    await release();
    await settle();
    expect(dimmedUri()).toBeNull();
  });

  it('MOVES to the next photo when one turns up nothing', async () => {
    // The whole reason this lives on the tile: the walk IS the progress.
    mockBlocksByCall = [[plateBlock('HIGH STREET')], [plateBlock('AB12 CDE')]];
    await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settle();

    expect(mockDimmedOrder).toEqual(['file://one.jpg', 'file://two.jpg']);
    expect(mockOpened.current).toBe(true);
  });

  it('stops walking as soon as it reads a plate cleanly', async () => {
    // Photo one has the plate, so photo two is never read and never dimmed.
    await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settle();

    expect(mockDimmedOrder).toEqual(['file://one.jpg']);
    expect(mockRecognise).toHaveBeenCalledTimes(1);
  });

  it('holds a tile long enough to be seen when the read is instant', async () => {
    // Ungated and finds nothing, so OCR resolves in the tick it started.
    // Without the floor the dim would appear and vanish inside one frame.
    // (A CLEAN read is the deliberate exception — see the test below.)
    mockBlocks = [plateBlock('HIGH STREET')];
    await renderStep();
    await addPhoto();

    expect(dimmedUri()).toBe('file://a.jpg');
    await act(async () => {
      jest.advanceTimersByTime(motion.loaderMinVisible - 1);
    });
    expect(dimmedUri()).toBe('file://a.jpg');

    await settle();
    expect(dimmedUri()).toBeNull();
  });

  it('does NOT delay the sheet to admire the tile it just read', async () => {
    // A clean read skips the hold: the sheet is about to take the screen, so
    // waiting would only postpone the answer the scan exists to give.
    await renderStep();
    await addPhoto();

    expect(mockOpened.current).toBe(true);
  });

  it('clears the dim when nothing was found — and says nothing else', async () => {
    // The quiet ending. This is the regression someone will introduce the day
    // they decide "no plate found" would be helpful.
    mockBlocks = [plateBlock('HIGH STREET')];
    const { queryByText } = await renderStep();
    await addPhoto();
    await settle();

    expect(dimmedUri()).toBeNull();
    expect(mockOpened.current).toBe(false);
    expect(queryByText(/couldn't read/i)).toBeNull();
  });

  it('clears the dim when the recogniser is unavailable', async () => {
    mockStatus = 'unavailable';
    await renderStep();
    await addPhoto();
    await settle();

    expect(dimmedUri()).toBeNull();
  });

  it('clears the dim when the read AGREES with what they typed', async () => {
    await renderStep('AB12 CDE');
    await addPhoto();
    await settle();

    expect(dimmedUri()).toBeNull();
    expect(mockOpened.current).toBe(false);
  });

  it('clears the dim when the scan throws', async () => {
    mockRecognise.mockRejectedValueOnce(new Error('boom'));
    await renderStep();
    await addPhoto();
    await settle();

    expect(dimmedUri()).toBeNull();
  });

  it('never dims a photo it has already read', async () => {
    await renderStep();
    await addPhoto('file://same.jpg');
    await settle();
    mockDimmedOrder = [];

    await addPhotos(['file://same.jpg']);
    expect(dimmedUri()).toBeNull();
    expect(mockDimmedOrder).toEqual([]);
  });

  it('announces once that it has started', async () => {
    // Uninvited background work: a screen-reader user should not have to go
    // hunting the tiles to discover that a scan began.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    await renderStep();
    await addPhoto();
    await settle();

    expect(announce).toHaveBeenCalledWith(PLATE_SCAN_LABEL);
    // ONCE. Announcing that a scan has started when there is nothing queued —
    // which is what a stray drain() does — tells a screen-reader user to wait
    // for something that is not happening.
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it('survives the step being left mid-scan', async () => {
    // Next is deliberately never blocked, so the step can unmount while the
    // recogniser is still working. Nothing may dim a dead tree.
    const errors = jest.spyOn(console, 'error').mockImplementation();
    const release = gateScan();
    const view = await renderStep();

    await addPhoto();
    await act(async () => {
      view.unmount();
    });
    await release();
    await settle();

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('the photos still work', () => {
  it('passes photos straight through to the answers', async () => {
    await renderStep();
    await addPhoto();

    expect(setAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ photos: expect.any(Array) }),
    );
  });

  it('does not re-read a photo it has already read', async () => {
    await renderStep();
    await addPhoto('file://same.jpg');
    mockOpened.current = false;
    await addPhoto('file://same.jpg');

    // Re-rendering or removing another photo must not re-ask about this one.
    expect(mockOpened.current).toBe(false);
  });

  it('reads photos added WHILE a scan is running', async () => {
    // The bug the status line would otherwise paper over: photos used to be
    // marked read the moment they were added, so a burst arriving mid-scan was
    // turned away by the guard and then never looked at by anything. The line
    // would have claimed to be checking photos it had silently dropped.
    mockBlocksByCall = [[plateBlock('HIGH STREET')], [plateBlock('AB12 CDE')]];
    const release = gateScan();
    await renderStep();

    await addPhoto('file://one.jpg');
    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await release();
    await settle();

    expect(mockRecognise).toHaveBeenCalledTimes(2);
    expect(mockOpened.current).toBe(true);
  });

  it('does not queue the same photo twice when the grid reorders mid-scan', async () => {
    // onChangePhotos receives the WHOLE array every time, so a reorder during
    // a scan must not re-enqueue what is already waiting.
    const release = gateScan();
    await renderStep();

    await addPhoto('file://one.jpg');
    await addPhotos(['file://one.jpg']);
    await addPhotos(['file://one.jpg']);
    await release();

    expect(mockRecognise).toHaveBeenCalledTimes(1);
  });

  it('keeps accepting photos while a scan runs', async () => {
    const release = gateScan();
    await renderStep();

    await addPhoto('file://one.jpg');
    setAnswers.mockClear();
    await addPhotos(['file://one.jpg', 'file://two.jpg']);

    // Non-blocking: the answer went through before the recogniser finished.
    expect(setAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ photos: expect.any(Array) }),
    );
    await release();
  });
});

// "That's not it" is not the end of the scan. The owner has told us this
// reading is wrong; the photos we stopped short of may still hold the right
// one, and starting over would re-offer the reading they just turned down.
describe('carrying on after a reading is turned down', () => {
  const settleAll = async () => {
    for (let round = 0; round < 60; round += 1) {
      await act(async () => {
        jest.advanceTimersByTime(motion.loaderMinVisible);
        await Promise.resolve();
      });
    }
  };

  const reject = async (view: { getByText: (text: string) => unknown }) => {
    await act(async () => {
      fireEvent.press(view.getByText("That's not it") as never);
    });
  };

  it('resumes at the photo it stopped on, and offers the next reading', async () => {
    // Photo one reads a wrong plate; photo two holds the right one and was
    // never opened, because the walk stopped to ask about photo one.
    mockBlocksByCall = [[plateBlock('XY34 ZZZ')], [plateBlock('AB12 CDE')]];
    const view = await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settleAll();
    expect(mockRecognise).toHaveBeenCalledTimes(1);

    await reject(view);
    await settleAll();

    // It read photo two rather than giving up or starting again at photo one.
    expect(mockRecognise).toHaveBeenCalledTimes(2);
    expect(mockDimmedOrder).toEqual(['file://one.jpg', 'file://two.jpg']);
  });

  it('never re-offers a reading already turned down', async () => {
    // Both photos read the SAME wrong plate. Asking twice about it would be
    // arguing with someone who was looking at the actual car.
    mockBlocksByCall = [[plateBlock('XY34 ZZZ')], [plateBlock('XY34 ZZZ')]];
    const view = await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settleAll();
    mockOpened.current = false;

    await reject(view);
    await settleAll();

    expect(mockRecognise).toHaveBeenCalledTimes(2);
    // Photo two was read, found only the rejected plate, and said nothing.
    expect(mockOpened.current).toBe(false);
  });

  it('writes nothing when the resumed scan also comes up empty', async () => {
    mockBlocksByCall = [[plateBlock('XY34 ZZZ')], [plateBlock('HIGH STREET')]];
    const view = await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settleAll();
    await reject(view);
    await settleAll();

    const wrotePlate = setAnswers.mock.calls.some(
      ([patch]) => patch && Object.hasOwn(patch, 'plate'),
    );
    expect(wrotePlate).toBe(false);
  });

  it('stops for good when the owner accepts a reading', async () => {
    // Confirming is the answer, so nothing parked is worth reading any more.
    mockBlocksByCall = [[plateBlock('AB12 CDE')], [plateBlock('XY34 ZZZ')]];
    const view = await renderStep();

    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settleAll();
    await act(async () => {
      fireEvent.press(view.getByText("Yes, that's it") as never);
    });
    await settleAll();

    expect(mockRecognise).toHaveBeenCalledTimes(1);
    expect(setAnswers).toHaveBeenCalledWith(
      expect.objectContaining({ plate: 'AB12 CDE', plateFromScan: true }),
    );
  });
});

// A sheet takes 250ms to close, and the answer arrives at the START of that
// window while the cleanup runs at the END of it. Everything below is about
// that gap: what the closing sheet says while it slides away, and the cleanup
// running EXACTLY once, with the right intent.
describe('closing the question', () => {
  const settleAll = async () => {
    for (let round = 0; round < 60; round += 1) {
      await act(async () => {
        jest.advanceTimersByTime(motion.loaderMinVisible);
        await Promise.resolve();
      });
    }
  };

  const rejections = () =>
    mockLogInfo.mock.calls.filter(([event]) => event === 'plate_scan_rejected');

  it('records a turned-down reading once, with the count it actually offered', async () => {
    // Twice — once real, once with an empty count — is how a single handler
    // wired to both the button and the sheet's own dismissal reports itself.
    const view = await renderStep();
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText("That's not it") as never);
    });
    await settleAll();

    expect(rejections()).toEqual([['plate_scan_rejected', { candidates: 1 }]]);
  });

  it('never records a rejection when the owner ACCEPTED the reading', async () => {
    const view = await renderStep();
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText("Yes, that's it") as never);
    });
    await settleAll();

    expect(rejections()).toEqual([]);
  });

  it('does not announce a fresh scan after the owner has finished', async () => {
    // Accepting ends the work. A screen reader saying "Looking for a number
    // plate" AFTERWARDS sends someone back to wait for nothing.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    const view = await renderStep();
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText("Yes, that's it") as never);
    });
    await settleAll();

    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });

  it('keeps the question on screen while the sheet slides away', async () => {
    // The answer is recorded the instant they tap, but the sheet is still
    // visible for 250ms. Clearing the reading first swaps the copy to
    // "Couldn't read it" — telling them it failed as it closes on a success.
    const view = await renderStep();
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText("Yes, that's it") as never);
    });

    expect(view.queryByText("Couldn't read it")).toBeNull();
    expect(view.getByText('Is this your registration?')).toBeTruthy();
    await settleAll();
  });

  it('confirms the plate was taken, since the plate step will not be asked', async () => {
    // `when: !plateFromScan` retires the question they were expecting, so
    // without this the whole interaction ends in nothing visibly happening.
    const view = await renderStep();
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText("Yes, that's it") as never);
    });
    await settleAll();

    expect(mockShowToast).toHaveBeenCalledWith(
      'Plate saved — you can change it when you check your car.',
    );
  });

  it('says the plate was UPDATED when the reading replaced one they typed', async () => {
    const view = await renderStep('XY34 ZZZ');
    await addPhoto();
    await settleAll();

    await act(async () => {
      fireEvent.press(view.getByText('Use this one') as never);
    });
    await settleAll();

    expect(mockShowToast).toHaveBeenCalledWith(
      'Plate updated — you can change it when you check your car.',
    );
  });

  it('does not replace a question the owner is still looking at', async () => {
    // The picker is a native screen, so photos can land while an unanswered
    // sheet is up. Swapping the reading underneath them changes the copy
    // mid-decision and loses the first reading's candidates from the blacklist.
    mockBlocksByCall = [[plateBlock('XY34 ZZZ')], [plateBlock('AB12 CDE')]];
    const view = await renderStep();

    await addPhoto('file://one.jpg');
    await settleAll();
    expect(view.getByText('XY34 ZZZ')).toBeTruthy();

    // A second photo arrives with the sheet still open.
    await addPhotos(['file://one.jpg', 'file://two.jpg']);
    await settleAll();

    expect(mockRecognise).toHaveBeenCalledTimes(1);
    expect(view.getByText('XY34 ZZZ')).toBeTruthy();

    // Turning it down blacklists the reading that was ACTUALLY on offer, and
    // only then reads the photo that was waiting.
    await act(async () => {
      fireEvent.press(view.getByText("That's not it") as never);
    });
    await settleAll();

    expect(rejections()).toEqual([['plate_scan_rejected', { candidates: 1 }]]);
    expect(mockRecognise).toHaveBeenCalledTimes(2);
    expect(view.getByText('AB12 CDE')).toBeTruthy();
  });
});
