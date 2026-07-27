/**
 * WHAT:  DistinctiveFeaturesEditor — edits the owner's distinctive-features
 *        evidence (photo + description pairs). SAFE + money-neutral, so editable
 *        on a draft AND a paid (pending_verification / live) post. Prefills from
 *        the features already on the post (kept as remote URLs; only newly-picked
 *        ones upload).
 * WHY:   Reuses the controlled DistinctiveFeaturesField (value/onChange) directly
 *        rather than the wizard step (which carries a wizard-only "None to add"
 *        skip). 0–8 pairs are all valid and the field only emits COMPLETE pairs,
 *        so Save is always available (clearing them all is a valid edit).
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/DistinctiveFeaturesField.tsx;
 *        src/features/vehicles/post/api/editSectionApi.ts (saveDistinctiveFeatures).
 */

import { useState } from 'react';

import { saveDistinctiveFeatures } from '@/features/vehicles/post/api/editSectionApi';
import { DistinctiveFeaturesField } from '@/features/vehicles/post/components/DistinctiveFeaturesField';
import type { DistinctiveFeature } from '@/features/vehicles/post/lib/distinctiveFeatures';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

/** Placeholder dimensions for a kept (already-uploaded) feature photo — never
 *  re-uploaded/resized, so only their positivity matters (the photo schema). */
const KEPT_PHOTO_DIMS = { width: 1600, height: 1200 };

export function DistinctiveFeaturesEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [features, setFeatures] = useState<DistinctiveFeature[]>(() =>
    post.distinctiveFeatures.map((feature) => ({
      photo: { uri: feature.photoUrl, ...KEPT_PHOTO_DIMS },
      description: feature.description,
    })),
  );

  return (
    <PostSectionEditor
      title="Distinctive features"
      onClose={onClose}
      onSaved={onSaved}
      canSave
      onSave={() => saveDistinctiveFeatures(post.id, features)}
    >
      <DistinctiveFeaturesField value={features} onChange={setFeatures} />
    </PostSectionEditor>
  );
}
