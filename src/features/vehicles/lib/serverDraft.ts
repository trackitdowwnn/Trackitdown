/**
 * WHAT:  The owner's unfinished draft LISTING on the server, looked up while
 *        the + button waits (primeServerDraft) and taken once by the report
 *        screen (takePrimedServerDraft), which then asks "Finish your draft?".
 * WHY:   Device check, 2026-10-29: a listing that reached the payment step is
 *        a draft post on the server, and the phone's own copy is cleared at
 *        that moment (PostACarScreen) — so tapping + again started from
 *        nothing and never mentioned the draft (owner chose: ask, Continue or
 *        Start a new one). Looked up BEFORE the slide like the phone draft
 *        and the garage, so the question is the screen's first frame.
 *        Taken once: a later visit asks again only if + primes it again. Any
 *        failure means "no draft known" — the owner can still post.
 * LINKS: src/features/garage/hooks/useStartReport.ts (primes it);
 *        src/features/garage/screens/StartReportScreen.tsx (asks);
 *        ../api/myPostsApi.ts; ../post/lib/postDraftStorage.ts (the phone copy).
 */

import { listMyPosts } from '../api/myPostsApi';

export interface ServerDraft {
  id: string;
  /** "Ford Fiesta · Blue" — the owner's own car, on their own phone. */
  label: string;
}

let primed: ServerDraft | null = null;

const capitalise = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** Look up the newest draft listing. Never throws. */
export async function primeServerDraft(): Promise<void> {
  primed = null;
  try {
    const draft = (await listMyPosts()).find((post) => post.status === 'draft');
    if (draft) {
      const car = `${draft.make} ${draft.model}`.trim();
      primed = { id: draft.id, label: draft.colour ? `${car} · ${capitalise(draft.colour)}` : car };
    }
  } catch {
    primed = null;
  }
}

/** The primed draft, once; null when there is none or nothing was primed. */
export function takePrimedServerDraft(): ServerDraft | null {
  const draft = primed;
  primed = null;
  return draft;
}
