/**
 * WHAT:  Tests for markChecklist: the marks the spotter was ASKED about, in
 *        the listing's order, ticked where seen ("Seen N of M"); never "not
 *        seen" for a mark that wasn't offered (added later, an older report,
 *        a wizard whose marks didn't load); the seen ones alone, with no
 *        total, while either list is unknown.
 * WHY:   The owner reads the spotter's answer through this list — a mark
 *        called "not seen" that the spotter was never shown misreports the
 *        evidence (code review, 2026-10-19).
 * LINKS: src/features/sightings/lib/markChecklist.ts.
 */

import { markChecklist } from './markChecklist';

const dent = { id: 'm1', description: 'Dent on the rear door' };
const roofBox = { id: 'm2', description: 'Roof box' };
const sticker = { id: 'm3', description: 'Bee sticker' };

const read = ({ checks }: ReturnType<typeof markChecklist>) =>
  checks.map(({ mark, seen }) => `${mark.id}:${seen ? 'seen' : 'not'}`);

it('lists every offered mark, in the listing’s order, ticked where seen — complete', () => {
  const list = markChecklist([dent, roofBox, sticker], [sticker], ['m1', 'm2', 'm3']);
  expect(read(list)).toEqual(['m1:not', 'm2:not', 'm3:seen']);
  expect(list.complete).toBe(true);
});

it('lists them all, none ticked, when the spotter saw none — an answer too', () => {
  expect(read(markChecklist([dent, roofBox], [], ['m1', 'm2']))).toEqual(['m1:not', 'm2:not']);
});

it('⚠️ never calls a mark "not seen" that the spotter wasn’t asked about', () => {
  // The owner added the sticker after this report.
  expect(read(markChecklist([dent, roofBox, sticker], [dent], ['m1', 'm2']))).toEqual([
    'm1:seen',
    'm2:not',
  ]);
});

it('a report that showed no marks lists nothing as "not seen"', () => {
  const list = markChecklist([dent, roofBox], [], []);
  expect(read(list)).toEqual([]);
  expect(list.complete).toBe(true);
});

it.each([
  ['the report predates asking (unknown)', [dent, roofBox], null],
  ['an older payload (absent)', [dent, roofBox], undefined],
  ['the listing isn’t read yet', null, ['m1', 'm2']],
] as const)('⚠️ shows the seen ones alone, claiming no total, when %s', (_, listing, offered) => {
  const list = markChecklist(listing, [dent], offered);
  expect(read(list)).toEqual(['m1:seen']);
  expect(list.complete).toBe(false);
});

it('keeps a seen mark the listing read doesn’t have, ticked, last', () => {
  expect(read(markChecklist([roofBox], [dent], ['m1', 'm2']))).toEqual(['m2:not', 'm1:seen']);
});

it('takes the LISTING’s copy of a mark (it carries the photo)', () => {
  const withPhoto = { ...dent, photoUrl: 'https://x/m1.jpg' };
  expect(markChecklist([withPhoto], [dent], ['m1']).checks[0].mark.photoUrl).toBe(
    'https://x/m1.jpg',
  );
});
