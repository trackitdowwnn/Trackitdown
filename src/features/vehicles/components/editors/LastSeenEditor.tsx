/**
 * WHAT:  LastSeenEditor — edits when + where the car was last seen (and the
 *        coarse area derived from the point). DRAFT ONLY (the point drives the
 *        feed/map matching). Prefills from the post's exact stored point (the
 *        owner sees uncoarsened coords).
 * WHY:   Reuses the wizard's LastSeenWhenStep + LastSeenWhereStep. Save is gated
 *        on a chosen time AND a settled location. The precise address label was
 *        never stored (privacy) — the coarse area seeds the picker's label.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (LastSeen steps);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveLastSeen).
 */

import { useState } from 'react';
import { View } from 'react-native';

import { saveLastSeen } from '@/features/vehicles/post/api/editSectionApi';
import { LastSeenWhenStep, LastSeenWhereStep } from '@/features/vehicles/post/components/postSteps';
import type { PostACarAnswers } from '@/features/vehicles/post';
import { deriveLocalityForCoord } from '@/shared/lib/location/placeLabels';
import { spacing } from '@/shared/theme';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

export function LastSeenEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasPoint = post.lat != null && post.lng != null;
  const [answers, setLocal] = useState<Partial<PostACarAnswers>>({
    lastSeenAt: post.lastSeenAt ?? undefined,
    location: hasPoint
      ? {
          latitude: post.lat as number,
          longitude: post.lng as number,
          addressLabel: post.lastSeenArea ?? '',
        }
      : null,
    lastSeenArea: post.lastSeenArea ?? '',
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  return (
    <PostSectionEditor
      title="Last seen"
      onClose={onClose}
      onSaved={onSaved}
      canSave={Boolean(answers.lastSeenAt) && Boolean(answers.location)}
      onSave={async () => {
        const location = answers.location!;
        // update_post_last_seen FULL-REPLACES the section, and this editor
        // renders the step components directly rather than through the wizard
        // (so the flow's onContinue never runs). Re-derive the district-grain
        // locality here or saving an unrelated tweak would silently blank it —
        // and the spotter alert would fall back to "your area".
        const lastSeenLocality = await deriveLocalityForCoord(location);
        await saveLastSeen(post.id, {
          lastSeenAt: answers.lastSeenAt as string,
          location,
          lastSeenArea: answers.lastSeenArea ?? '',
          lastSeenLocality,
        });
      }}
    >
      <View style={{ gap: spacing.xl }}>
        <LastSeenWhenStep answers={answers} setAnswers={setAnswers} />
        <LastSeenWhereStep answers={answers} setAnswers={setAnswers} />
      </View>
    </PostSectionEditor>
  );
}
