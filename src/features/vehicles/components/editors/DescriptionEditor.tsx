/**
 * WHAT:  DescriptionEditor — edits the "About this car" free-text description
 *        (desc_recognise). SAFE + money-neutral, so editable on a draft AND a
 *        paid (pending_verification) post. Prefills from the post.
 * WHY:   A plain multiline TextField (the EditProfile pattern). An empty
 *        description is valid (clearing it is a real edit), so Save is always
 *        available.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/api/editSectionApi.ts (saveDescription);
 *        src/shared/ui (TextField).
 */

import { useState } from 'react';

import { saveDescription } from '../../post/api/editSectionApi';
import { TextField } from '@/shared/ui';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

export function DescriptionEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(post.descRecognise ?? '');

  return (
    <PostSectionEditor
      title="About this car"
      onClose={onClose}
      onSaved={onSaved}
      canSave
      onSave={() => saveDescription(post.id, text)}
    >
      <TextField
        label="Details"
        variant="multiline"
        placeholder="Anything else spotters should know — like what's usually inside it or if the plates may have been swapped."
        value={text}
        onChangeText={setText}
        maxLength={1000}
      />
    </PostSectionEditor>
  );
}
