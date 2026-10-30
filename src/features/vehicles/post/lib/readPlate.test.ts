/**
 * WHAT:  Tests for readPlateFromPhoto — the two reads, where the crop is cut,
 *        and that a plate counts only when both reads agree.
 * WHY:   The second read is what took wrong suggestions from 28% to 16% on the
 *        80-photo set; a crop cut in the wrong place (or reads allowed to
 *        disagree) would quietly undo that.
 * LINKS: ./readPlate.ts; src/shared/lib/plateSelection.ts (the rules, tested there).
 */

import { readPlateFromPhoto } from './readPlate';

// The first read is 2000 wide; the full-size original is 4000: crops scale ×2.
const mockCrops: unknown[] = [];
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const ops: { resize?: unknown; crop?: unknown } = {};
      return {
        resize: (r: unknown) => (ops.resize = r),
        crop: (c: unknown) => (ops.crop = c),
        renderAsync: async () => ({
          saveAsync: async () => {
            if (ops.crop) {
              mockCrops.push(ops.crop);
              return { uri: `file://crop-${mockCrops.length}.jpg`, width: 1200, height: 460 };
            }
            return ops.resize
              ? { uri: 'file://first.jpg', width: 2000, height: 1500 }
              : { uri: 'file://original.jpg', width: 4000, height: 3000 };
          },
        }),
      };
    },
  },
}));

type Read = { status: 'ok'; blocks: { text: string; box?: object }[] } | { status: 'unavailable' };
const mockReads: Read[] = [];
jest.mock('@/shared/lib/ocr/textRecognition', () => ({
  recogniseText: async () => mockReads.shift() ?? { status: 'ok', blocks: [] },
}));

const line = (text: string, x: number, y: number, height: number) => ({
  text,
  box: { x, y, width: height * 4.6, height },
});

beforeEach(() => {
  mockCrops.length = 0;
  mockReads.length = 0;
});

it('suggests a plate when the crop reads the same, with the crop to show', async () => {
  mockReads.push(
    { status: 'ok', blocks: [line('AB12 CDE', 100, 200, 60)] },
    { status: 'ok', blocks: [line('AB12 CDE', 10, 10, 300)] },
  );
  const reading = await readPlateFromPhoto('file://photo.jpg');

  expect(reading).toEqual({
    kind: 'likely',
    plates: [expect.objectContaining({ canon: 'AB12CDE', cropUri: 'file://crop-1.jpg' })],
  });
});

it('cuts the crop from the FULL-SIZE photo around the line, with padding', async () => {
  mockReads.push(
    { status: 'ok', blocks: [line('AB12 CDE', 100, 200, 60)] }, // 276 x 60 at 2000 wide
    { status: 'ok', blocks: [line('AB12 CDE', 10, 10, 300)] },
  );
  await readPlateFromPhoto('file://photo.jpg');

  // ×2 to the original; 25% padding either side (276 × 1.5 × 2 = 828), 80% above
  // and below (60 × 2.6 × 2 = 312).
  expect(mockCrops[0]).toEqual({ originX: 62, originY: 304, width: 828, height: 312 });
});

it('⚠️ says nothing when the crop reads a DIFFERENT plate', async () => {
  mockReads.push(
    { status: 'ok', blocks: [line('AB12 CDE', 100, 200, 60)] },
    { status: 'ok', blocks: [line('AB12 CDF', 10, 10, 300)] },
  );
  expect(await readPlateFromPhoto('file://photo.jpg')).toEqual({ kind: 'none' });
});

it('offers both when two cars are equally in shot', async () => {
  mockReads.push(
    { status: 'ok', blocks: [line('AB12 CDE', 100, 200, 60), line('XY34 ZZZ', 900, 200, 55)] },
    { status: 'ok', blocks: [line('AB12 CDE', 10, 10, 300)] },
    { status: 'ok', blocks: [line('XY34 ZZZ', 10, 10, 300)] },
  );
  const reading = await readPlateFromPhoto('file://photo.jpg');

  expect(reading.kind).toBe('pair');
  expect('plates' in reading && reading.plates.map((p) => p.canon)).toEqual(['AB12CDE', 'XY34ZZZ']);
});

it('reads nothing again when the first read has no plate-shaped line', async () => {
  mockReads.push({ status: 'ok', blocks: [line('High Street', 100, 200, 60)] });
  expect(await readPlateFromPhoto('file://photo.jpg')).toEqual({ kind: 'none' });
  expect(mockCrops).toHaveLength(0);
});

it('reports an error, never throws, when the recogniser is unavailable', async () => {
  mockReads.push({ status: 'unavailable' });
  expect(await readPlateFromPhoto('file://photo.jpg')).toEqual({ kind: 'error' });
});
