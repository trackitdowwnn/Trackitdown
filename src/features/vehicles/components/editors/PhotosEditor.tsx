/**
 * WHAT:  PhotosEditor — edits the post's hero photos (3–6). DRAFT ONLY (photos
 *        are identity; changing them on a verified post would need re-moderation).
 *        Prefills from the current photos (kept as remote URLs; only newly-picked
 *        local files upload).
 * WHY:   Reuses the wizard's PhotosStep (PhotoGridPicker). Save is gated on the
 *        3–6 count (server re-validates PHOTO_COUNT).
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (PhotosStep);
 *        src/features/vehicles/post/api/editSectionApi.ts (savePhotos).
 */

import { useState } from 'react';

import { savePhotos } from '@/features/vehicles/post/api/editSectionApi';
import { PhotosStep } from '@/features/vehicles/post/components/postSteps';
import type { PostACarAnswers } from '@/features/vehicles/post';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

/** Kept (already-uploaded) photos never resize/re-upload — placeholder dims. */
const KEPT_PHOTO_DIMS = { width: 1600, height: 1200 };

export function PhotosEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setLocal] = useState<Partial<PostACarAnswers>>({
    photos: post.photos.map((photo) => ({ uri: photo.uri, ...KEPT_PHOTO_DIMS })),
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  const count = answers.photos?.length ?? 0;

  return (
    <PostSectionEditor
      title="Photos"
      onClose={onClose}
      onSaved={onSaved}
      canSave={count >= 3 && count <= 6}
      onSave={() => savePhotos(post.id, answers.photos ?? [])}
    >
      <PhotosStep answers={answers} setAnswers={setAnswers} />
    </PostSectionEditor>
  );
}
