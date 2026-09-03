/**
 * WHAT:  Save-and-exit for the post-a-car wizard: one draft per device, held in
 *        AsyncStorage, restored on the next open and cleared on submit.
 * WHY:   Review finding #19. A nine-step flow that ends in a Stripe charge had
 *        NO persistence of any kind — `useWizardController` said so at the exit
 *        prompt: "discard is the only exit". An owner whose car was taken this
 *        morning, working through it, loses everything to a phone call, a flat
 *        battery or a mistapped back gesture. That is the worst moment this app
 *        has to fail someone, on its most important flow.
 *
 * ⚠️ AN EXPLICIT WHITELIST, NOT THE ANSWERS OBJECT. `PostACarAnswers` is the
 *        wizard's whole state and it grows: blanket-serialising it means the
 *        next field anyone adds is persisted by default, whatever it holds.
 *        PERSISTED_KEYS names what is written, so adding a field is a decision
 *        rather than an accident — the same instinct as the `.strict()` schemas
 *        on every payload boundary in this codebase.
 *
 * ⚠️ PHOTOS ARE DELIBERATELY NOT SAVED, and the resume prompt says so. They are
 *        local `file://` uris into the app's cache, and a cache the OS has
 *        cleared leaves a uri that points at nothing: restoring it would show
 *        broken tiles and then fail at upload, which is a worse experience than
 *        asking for them again. There is no expo-file-system in this project to
 *        check a uri with, so "keep it and hope" would be exactly that.
 *        Distinctive features go with them — each one IS a photo plus a caption.
 *        The eight tedious steps survive; the one that is quick to redo does not.
 *
 * ⚠️ IT HOLDS A LOCATION, and that is a considered choice. `location` is where
 *        the car was last seen — on a driveway theft, the owner's home. It is
 *        their own data, about their own theft, on their own device, and the
 *        post makes it public within minutes anyway. SECURITY_AND_TRUST's
 *        plaintext-AsyncStorage rule is about SESSION TOKENS (credentials that
 *        unlock an account), and SecureStore is not an alternative here: iOS
 *        caps a value at ~2KB, which this object exceeds. The mitigations are
 *        the expiry and the clears below, not the storage medium.
 * LINKS: src/shared/wizard/useWizardController.ts (the seam this fills — it has
 *          carried a TODO(draft-persistence) since the framework was written);
 *        src/features/vehicles/post/screens/PostACarScreen.tsx (restores it);
 *        src/features/vehicles/post/types.ts (PostACarAnswers).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { createLogger } from '@/shared/lib/logger';

import type { PostACarAnswers } from '../types';

const log = createLogger('vehicles');

/** Versioned: a shape change must not try to read the old one. */
const KEY = 'trackitdown.post-draft.v1';

/**
 * A draft older than this is dropped on read.
 *
 * ⚠️ NOT arbitrary politeness. A stolen car is either recovered or reported
 * within days; a fortnight-old draft resurfacing is far more likely to be an
 * abandoned attempt than a resumed one, and offering to restore it puts stale
 * details — a last-seen location that is no longer true — in front of someone
 * who has moved on. It also bounds how long the location sits on the device.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * What is written, named one by one.
 *
 * ⚠️ `photos` and `distinctiveFeatures` are ABSENT ON PURPOSE — see the header.
 * Anything added here should be able to survive an app restart and be something
 * the owner would want back.
 */
const PERSISTED_KEYS = [
  'make',
  'model',
  'colour',
  'colourNote',
  'year',
  'bodyType',
  'lastSeenAt',
  'location',
  'lastSeenArea',
  'lastSeenLocality',
  'stolenFrom',
  'keysTaken',
  'descDrives',
  'descRecognise',
  'pricingMode',
  'bountyAmountPence',
  'fromVehicleId',
] as const satisfies readonly (keyof PostACarAnswers)[];

export type PersistedDraftAnswers = Partial<Pick<PostACarAnswers, (typeof PERSISTED_KEYS)[number]>>;

interface StoredDraft {
  savedAt: string;
  answers: PersistedDraftAnswers;
}

/** Copy across only the whitelisted keys that actually have a value. */
function pickPersisted(answers: Partial<PostACarAnswers>): PersistedDraftAnswers {
  const out: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) {
    const value = answers[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as PersistedDraftAnswers;
}

/**
 * Save the in-progress answers. Never throws: losing a draft is a
 * disappointment, but a storage failure taking down the exit the owner just
 * asked for would be a trap.
 */
export async function savePostDraft(answers: Partial<PostACarAnswers>): Promise<void> {
  try {
    const draft: StoredDraft = {
      savedAt: new Date().toISOString(),
      answers: pickPersisted(answers),
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
    // ⚠️ COUNTS ONLY. The draft holds a location and a car; nothing about it
    // may reach a log line (docs/LOGGING.md).
    log.info('post_draft_saved', { fields: Object.keys(draft.answers).length });
  } catch {
    log.warn('post_draft_save_failed');
  }
}

/**
 * The saved draft, or null when there is none, it is too old, or it is
 * unreadable. Every failure is null — a corrupt draft must never break the
 * screen that offers it.
 */
export async function loadPostDraft(): Promise<PersistedDraftAnswers | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredDraft;
    const savedAt = Date.parse(parsed?.savedAt ?? '');
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_AGE_MS) {
      // Drop it rather than leave it to be re-read and re-rejected forever.
      await clearPostDraft();
      return null;
    }
    if (typeof parsed.answers !== 'object' || parsed.answers === null) {
      await clearPostDraft();
      return null;
    }
    // ⚠️ RE-FILTERED ON READ, not trusted. The stored blob is whatever a
    // previous build wrote; a key this build does not persist must not come
    // back into the answers object just because it is on disk.
    return pickPersisted(parsed.answers as Partial<PostACarAnswers>);
  } catch {
    log.warn('post_draft_load_failed');
    return null;
  }
}

/** Remove it. Called on submit, on discard, and on a failed read. */
export async function clearPostDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    log.warn('post_draft_clear_failed');
  }
}
