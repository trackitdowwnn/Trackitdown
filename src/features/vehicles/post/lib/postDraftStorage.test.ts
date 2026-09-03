/**
 * WHAT:  Tests for the post-a-car draft — what is written, what is refused, and
 *        the two ways a bad draft must fail safe.
 * WHY:   Review #19. The wizard had no persistence at all, so an owner whose
 *        car was taken that morning lost nine steps to a phone call. What this
 *        file guards is the shape of the fix rather than its existence:
 *
 *        1. **The whitelist.** `PostACarAnswers` is the wizard's whole state
 *           and it grows. If a future field is persisted by default, the first
 *           anyone notices is a `file://` uri or something sensitive sitting in
 *           plaintext AsyncStorage. The assertion is written from the failing
 *           side: photos must NOT come back.
 *        2. **Never throwing.** Save is called from an exit the owner has
 *           already asked for. A storage failure that propagated would turn
 *           "leave" into "stuck".
 *        3. **Failing to null.** A corrupt or ancient draft must read as "no
 *           draft", not as an exception on the screen that offers it — and it
 *           must be REMOVED, or every open re-reads and re-rejects it.
 * LINKS: ./postDraftStorage.ts; ../screens/PostACarScreen.tsx;
 *        src/shared/wizard/useWizardController.ts (the exit prompt).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PostACarAnswers } from '../types';
import { clearPostDraft, loadPostDraft, savePostDraft } from './postDraftStorage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => {}),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const mockStorage = AsyncStorage as unknown as {
  setItem: jest.Mock;
  getItem: jest.Mock;
  removeItem: jest.Mock;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The answers a half-finished wizard actually holds. */
function answers(): Partial<PostACarAnswers> {
  return {
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    year: 2019,
    lastSeenArea: 'Manchester',
    location: { latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester' },
    stolenFrom: 'driveway',
    pricingMode: 'bounty',
    bountyAmountPence: 30000,
    photos: [{ uri: 'file:///cache/a.jpg', width: 4000, height: 3000 }],
    distinctiveFeatures: [
      { photo: { uri: 'file:///cache/mark.jpg', width: 100, height: 100 }, description: 'Dent' },
    ],
  };
}

/** What setItem was handed, parsed. */
function written(): { savedAt: string; answers: Record<string, unknown> } {
  return JSON.parse(mockStorage.setItem.mock.calls[0][1] as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.setItem.mockResolvedValue(undefined);
  mockStorage.getItem.mockResolvedValue(null);
  mockStorage.removeItem.mockResolvedValue(undefined);
});

describe('savePostDraft', () => {
  it('keeps the steps that are tedious to redo', async () => {
    await savePostDraft(answers());

    expect(written().answers).toMatchObject({
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      location: { latitude: 53.48, longitude: -2.24, addressLabel: 'Manchester' },
      stolenFrom: 'driveway',
      bountyAmountPence: 30000,
    });
  });

  it('⚠️ does NOT write photos, in either place they appear', async () => {
    // They are local cache uris. A cache the OS has cleared leaves a uri
    // pointing at nothing — restoring it shows broken tiles and then fails at
    // upload, which is worse than asking for the photos again. There is no
    // expo-file-system here to check a uri with, so keeping them would be hope.
    await savePostDraft(answers());
    const stored = written().answers;

    expect(stored).not.toHaveProperty('photos');
    expect(stored).not.toHaveProperty('distinctiveFeatures');
    expect(JSON.stringify(stored)).not.toContain('file://');
  });

  it('⚠️ writes ONLY whitelisted keys, whatever it is handed', async () => {
    // The guard against a future field being persisted by accident. An answers
    // object with something unexpected on it must not carry that to disk.
    await savePostDraft({
      ...answers(),
      // @ts-expect-error — deliberately not part of PostACarAnswers
      somethingAddedLater: 'should never be written',
    });

    expect(JSON.stringify(written().answers)).not.toContain('should never be written');
  });

  it('omits keys with no value rather than writing undefined', async () => {
    await savePostDraft({ make: 'BMW' });

    expect(written().answers).toEqual({ make: 'BMW' });
  });

  it('⚠️ never throws — the owner has already asked to leave', async () => {
    mockStorage.setItem.mockRejectedValue(new Error('disk full'));

    await expect(savePostDraft(answers())).resolves.toBeUndefined();
  });
});

describe('loadPostDraft', () => {
  it('returns the saved answers', async () => {
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({ savedAt: new Date().toISOString(), answers: { make: 'BMW' } }),
    );

    await expect(loadPostDraft()).resolves.toEqual({ make: 'BMW' });
  });

  it('returns null when there is nothing saved', async () => {
    await expect(loadPostDraft()).resolves.toBeNull();
  });

  it('⚠️ drops a draft older than a fortnight, and REMOVES it', async () => {
    // A stolen car is reported within days. A fortnight-old draft resurfacing
    // is an abandoned attempt, and offering it puts a last-seen location that
    // is no longer true in front of someone who has moved on.
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: new Date(Date.now() - 15 * DAY_MS).toISOString(),
        answers: { make: 'BMW' },
      }),
    );

    await expect(loadPostDraft()).resolves.toBeNull();
    // Removed, or every open re-reads and re-rejects the same dead draft.
    expect(mockStorage.removeItem).toHaveBeenCalled();
  });

  it('keeps one saved just inside the window', async () => {
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: new Date(Date.now() - 13 * DAY_MS).toISOString(),
        answers: { make: 'BMW' },
      }),
    );

    await expect(loadPostDraft()).resolves.toEqual({ make: 'BMW' });
  });

  it('⚠️ survives a corrupt draft rather than breaking the screen', async () => {
    mockStorage.getItem.mockResolvedValue('{not json');

    await expect(loadPostDraft()).resolves.toBeNull();
  });

  it('survives a draft with no timestamp', async () => {
    mockStorage.getItem.mockResolvedValue(JSON.stringify({ answers: { make: 'BMW' } }));

    await expect(loadPostDraft()).resolves.toBeNull();
    expect(mockStorage.removeItem).toHaveBeenCalled();
  });

  it('⚠️ re-filters on READ, so an old build’s extra keys cannot come back', async () => {
    // The blob on disk was written by whatever version last ran. A key this
    // build does not persist must not re-enter the answers object just because
    // it is sitting there — photos especially.
    mockStorage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: new Date().toISOString(),
        answers: { make: 'BMW', photos: [{ uri: 'file:///gone.jpg' }] },
      }),
    );

    await expect(loadPostDraft()).resolves.toEqual({ make: 'BMW' });
  });
});

describe('clearPostDraft', () => {
  it('removes it, and never throws', async () => {
    await clearPostDraft();
    expect(mockStorage.removeItem).toHaveBeenCalled();

    mockStorage.removeItem.mockRejectedValue(new Error('nope'));
    await expect(clearPostDraft()).resolves.toBeUndefined();
  });
});
