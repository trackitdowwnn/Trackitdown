/**
 * WHAT:  The owner's unfinished draft LISTING on the server, looked up while
 *        the + button waits (findServerDraft) so it can ask "Finish your
 *        draft?" in a sheet before opening a new report.
 * WHY:   Device check, 2026-10-29: a listing that reached the payment step is
 *        a draft post on the server, and the phone's own copy is cleared at
 *        that moment (PostACarScreen) — so tapping + again started from
 *        nothing and never mentioned the draft (owner chose: ask, Continue or
 *        Start a new one). Any failure means "no draft known" — the owner can
 *        still post.
 * LINKS: src/features/garage/hooks/useStartReport.ts (looks it up);
 *        src/features/garage/components/FinishDraftSheet.tsx (asks);
 *        ../api/myPostsApi.ts; ../post/lib/postDraftStorage.ts (the phone copy).
 */

import { listMyPosts } from '../api/myPostsApi';

export interface ServerDraft {
  id: string;
  /** "Ford Fiesta · Blue" — the owner's own car, on their own phone. */
  label: string;
}

const capitalise = (word: string) => (word ? word[0].toUpperCase() + word.slice(1) : word);

/** The newest draft listing, or null. Never throws. */
export async function findServerDraft(): Promise<ServerDraft | null> {
  try {
    const draft = (await listMyPosts()).find((post) => post.status === 'draft');
    if (!draft) return null;
    const car = `${draft.make} ${draft.model}`.trim();
    return { id: draft.id, label: draft.colour ? `${car} · ${capitalise(draft.colour)}` : car };
  } catch {
    return null;
  }
}
