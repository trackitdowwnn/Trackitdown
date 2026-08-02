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

import { act, render } from '@testing-library/react-native';

import { PhotosWithPlateScanStep } from './PhotosWithPlateScanStep';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Records whether the sheet was ever opened. Named mockOpened so jest's
// hoisted factory below may reference it (the `mock` prefix is the escape
// hatch for its out-of-scope-variable check).
const mockOpened = { current: false };
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  class TrackingModal extends React.Component {
    present = () => {
      mockOpened.current = true;
    };
    dismiss = () => {};
    render() {
      return null;
    }
  }
  return {
    ...mock,
    BottomSheetModal: TrackingModal,
    BottomSheetScrollView: (props: object) =>
      React.createElement(ReactNative.ScrollView, props),
  };
});

// The shared photos step, reduced to the one thing this wrapper cares about:
// it hands photos back through setAnswers.
let emit: ((photos: unknown) => void) | null = null;
jest.mock('@/features/vehicles', () => ({
  PhotosStep: ({ setAnswers }: { setAnswers: (patch: unknown) => void }) => {
    emit = (photos) => setAnswers({ photos });
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
jest.mock('@/shared/lib/ocr/textRecognition', () => ({
  recogniseText: async () =>
    mockStatus === 'ok' ? { status: 'ok', blocks: mockBlocks } : { status: 'unavailable' },
}));

const plateBlock = (text: string) => ({
  text,
  box: { x: 0, y: 0, width: 460, height: 100 },
});

const addPhoto = async (uri = 'file://a.jpg') => {
  await act(async () => {
    emit?.([{ uri, width: 100, height: 100 }]);
  });
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

beforeEach(() => {
  jest.clearAllMocks();
  setAnswers = jest.fn();
  emit = null;
  mockOpened.current = false;
  mockStatus = 'ok';
  mockBlocks = [plateBlock('AB12 CDE')];
});

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
});
