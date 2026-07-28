/**
 * WHAT:  Tests for the SavedVehicle → wizard-answers mapping and the two derived
 *        facts (summary line, enough-photos-to-post).
 * WHY:   This mapping is what a prefilled stolen-car report is built from, so a
 *        field silently dropped here becomes a detail missing from a real
 *        listing at the worst possible moment. The colour NOTE is the one most
 *        easily lost — "matte black wrap over silver" is the detail that
 *        actually identifies a wrapped car, and it lives in its own field.
 *        Photos must map as REMOTE uris so the save path passes them through
 *        without re-uploading (the speed win).
 * LINKS: src/features/garage/lib/vehicleAnswers.ts, docs/TESTING.md.
 */

import type { SavedVehicle } from '../types';
import {
  hasEnoughPhotosToPost,
  toAnswers,
  vehicleDisplayName,
  vehicleSummaryLine,
} from './vehicleAnswers';

function vehicle(overrides: Partial<SavedVehicle> = {}): SavedVehicle {
  return {
    id: 'v1',
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: null,
    year: 2019,
    bodyType: 'Saloon',
    nickname: null,
    verificationState: 'unverified',
    photos: [
      { url: 'https://x/post-photos/u1/0.jpg', position: 0 },
      { url: 'https://x/post-photos/u1/1.jpg', position: 1 },
    ],
    distinctiveFeatures: [
      { photoUrl: 'https://x/post-photos/u1/m0.jpg', description: 'Cracked mirror', position: 0 },
    ],
    isCurrentlyPosted: false,
    activePostId: null,
    createdAt: '2026-07-08T12:00:00Z',
    ...overrides,
  };
}

describe('toAnswers', () => {
  it('carries every identity field across', () => {
    const answers = toAnswers(vehicle());

    expect(answers).toMatchObject({
      plate: 'AB12 CDE',
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      bodyType: 'Saloon',
    });
  });

  it('keeps the colour note — the detail that identifies a wrapped car', () => {
    const answers = toAnswers(
      vehicle({ colour: 'Multicolour / wrapped', colourNote: 'matte black wrap over silver' }),
    );

    expect(answers.colourNote).toBe('matte black wrap over silver');
  });

  it('maps photos as REMOTE uris so they are never re-uploaded', () => {
    const answers = toAnswers(vehicle());

    expect(answers.photos.map((p) => p.uri)).toEqual([
      'https://x/post-photos/u1/0.jpg',
      'https://x/post-photos/u1/1.jpg',
    ]);
    // Positive dimensions, so the photo schema accepts an already-uploaded file.
    expect(answers.photos.every((p) => p.width > 0 && p.height > 0)).toBe(true);
  });

  it('maps distinctive features into editable pairs', () => {
    const answers = toAnswers(vehicle());

    expect(answers.distinctiveFeatures).toEqual([
      { photo: { uri: 'https://x/post-photos/u1/m0.jpg', width: 1600, height: 1200 }, description: 'Cracked mirror' },
    ]);
  });

  it('turns absent optional fields into empty strings the wizard can edit', () => {
    const answers = toAnswers(vehicle({ plate: null, nickname: null, colourNote: null }));

    expect(answers.plate).toBe('');
    expect(answers.nickname).toBe('');
    expect(answers.colourNote).toBe('');
  });
});

describe('hasEnoughPhotosToPost', () => {
  it('is false below the posting minimum of 3', () => {
    expect(hasEnoughPhotosToPost(vehicle())).toBe(false); // 2 photos
  });

  it('is true at 3 — the prefilled post can summarise instead of asking', () => {
    const photos = [0, 1, 2].map((i) => ({ url: `https://x/${i}.jpg`, position: i }));
    expect(hasEnoughPhotosToPost(vehicle({ photos }))).toBe(true);
  });

  it('is false for a photo-less saved car (allowed in the garage)', () => {
    expect(hasEnoughPhotosToPost(vehicle({ photos: [] }))).toBe(false);
  });
});

describe('vehicleSummaryLine', () => {
  it('reads as the confirm line the owner sees under stress', () => {
    expect(vehicleSummaryLine(vehicle())).toBe('Blue BMW 320d · AB12 CDE · 2 photos');
  });

  it('omits the plate rather than printing an empty separator', () => {
    expect(vehicleSummaryLine(vehicle({ plate: null }))).toBe('Blue BMW 320d · 2 photos');
  });

  it('singularises one photo', () => {
    const photos = [{ url: 'https://x/0.jpg', position: 0 }];
    expect(vehicleSummaryLine(vehicle({ photos }))).toBe('Blue BMW 320d · AB12 CDE · 1 photo');
  });

  it('says zero photos honestly rather than hiding it', () => {
    expect(vehicleSummaryLine(vehicle({ photos: [] }))).toBe('Blue BMW 320d · AB12 CDE · 0 photos');
  });
});

describe('vehicleDisplayName', () => {
  it('prefers the owner nickname', () => {
    expect(vehicleDisplayName(vehicle({ nickname: "Mum's Golf" }))).toBe("Mum's Golf");
  });

  it('falls back to make + model, ignoring a blank nickname', () => {
    expect(vehicleDisplayName(vehicle({ nickname: '   ' }))).toBe('BMW 320d');
  });
});
