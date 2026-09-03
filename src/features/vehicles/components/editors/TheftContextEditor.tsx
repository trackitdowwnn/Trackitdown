/**
 * WHAT:  TheftContextEditor — edits the "How it was taken" section (stolen-from,
 *        keys-taken, how-it-drives note). A SAFE, money-neutral section, so it's
 *        editable on a draft AND a paid (pending_verification) post.
 * WHY:   Reuses the wizard's TheftContextStep by feeding it a local answers slice
 *        (the step is a controlled adapter over answers/setAnswers), so the input
 *        chrome is identical to posting. All three fields are optional → Save is
 *        always available.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (TheftContextStep);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveTheftContext).
 */

import { useState } from 'react';

import { saveTheftContext } from '../../post/api/editSectionApi';
import { TheftContextStep } from '../../post/components/postSteps';
import type { PostACarAnswers } from '../../post';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

export function TheftContextEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setLocal] = useState<Partial<PostACarAnswers>>({
    stolenFrom: post.stolenFrom,
    keysTaken: post.keysTaken,
    descDrives: post.descDrives ?? '',
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  return (
    <PostSectionEditor
      title="How it was taken"
      onClose={onClose}
      onSaved={onSaved}
      canSave
      onSave={() =>
        saveTheftContext(post.id, {
          stolenFrom: answers.stolenFrom ?? null,
          keysTaken: answers.keysTaken ?? null,
          descDrives: answers.descDrives ?? '',
        })
      }
    >
      <TheftContextStep answers={answers} setAnswers={setAnswers} />
    </PostSectionEditor>
  );
}
