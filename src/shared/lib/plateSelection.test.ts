/**
 * WHAT:  Tests for choosePlate — one test per rule that keeps a wrong plate
 *        from being suggested.
 * WHY:   Measured, the old choice was wrong 45% of the time it suggested
 *        anything, and a listing's plate can never change. Each rule here
 *        removed a measured class of wrong suggestion; these pin them.
 * LINKS: ./plateSelection.ts; docs/plate-scan-decisions.md.
 */

import { choosePlate } from './plateSelection';

/** A line of text, `height` px tall, in a 1000px-tall photo. */
const line = (text: string, height: number) => ({
  text,
  box: { x: 0, y: 0, width: height * 4.6, height },
});
const PHOTO = 1000;
const pick = (lines: ReturnType<typeof line>[]) => choosePlate(lines, PHOTO)?.display ?? null;

it('suggests a clean, plate-sized read', () => {
  expect(pick([line('AB12 CDE', 60)])).toBe('AB12 CDE');
});

it('ignores lines with lowercase letters: plates are capitals, signs are not', () => {
  expect(pick([line('Ab12 Cde', 60)])).toBeNull();
});

it("⚠️ never turns a badge into a plate ('ST LINE' was suggested as S71 INE)", () => {
  expect(pick([line('ST LINE', 60)])).toBeNull();
});

it('allows ONE corrected character on a structured plate, not two', () => {
  expect(pick([line('AB1Z CDE', 60)])).toBe('AB12 CDE');
  // Two corrections in every shape it could be (current: 8→B, I→1, Z→2; prefix: I→1, Z→2).
  expect(pick([line('A8IZ CDE', 60)])).toBeNull();
});

it('allows no correction on the loose dateless and suffix shapes', () => {
  expect(pick([line('ABC 123', 60)])).toBe('ABC 123');
  // Only fits the dateless ABC 123 shape by correcting Z→2: not allowed.
  expect(pick([line('ABC 1Z3', 60)])).toBeNull();
});

it('says nothing about a plate too small to be the car in the photo', () => {
  expect(pick([line('AB12 CDE', 15)])).toBeNull(); // 1.5% of the height
  expect(pick([line('AB12 CDE', 20)])).toBe('AB12 CDE'); // 2%
});

it('picks the largest plate, the car the photo is about', () => {
  expect(pick([line('XY34 ZZZ', 30), line('AB12 CDE', 80)])).toBe('AB12 CDE');
});

it('says nothing when two plates are nearly the same size (two cars in shot)', () => {
  expect(pick([line('XY34 ZZZ', 60), line('AB12 CDE', 70)])).toBeNull();
});

it('one plate read twice is still one plate, not two cars', () => {
  expect(pick([line('AB12 CDE', 70), line('AB12CDE', 65)])).toBe('AB12 CDE');
});

it('a line with no box cannot show its size, so it is never suggested', () => {
  expect(choosePlate([{ text: 'AB12 CDE' }], PHOTO)).toBeNull();
});
