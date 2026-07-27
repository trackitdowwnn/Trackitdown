/**
 * WHAT:  CarDetailsEditor — edits the car's identity: make, model, colour (+ its
 *        note), body type, and year. DRAFT ONLY (identity edits on a verified
 *        post would need re-moderation). Prefills from the post.
 * WHY:   Reuses the wizard's Make/Model/Colour/BodyType/Year steps stacked (each
 *        a controlled adapter). Save is gated on make/model/colour present
 *        (server re-validates MISSING_REQUIRED). Changing the make clears the
 *        model (the step's makeChangePatch), so the user re-picks it — matching
 *        the wizard.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditor.tsx;
 *        src/features/vehicles/post/components/postSteps.tsx (Make/Model/Colour/Year);
 *        src/features/vehicles/post/api/editSectionApi.ts (saveCarDetails).
 */

import { useState } from 'react';
import { View } from 'react-native';

import { saveCarDetails } from '@/features/vehicles/post/api/editSectionApi';
import {
  BodyTypeStep,
  ColourStep,
  MakeStep,
  ModelStep,
  YearStep,
} from '@/features/vehicles/post/components/postSteps';
import type { PostACarAnswers } from '@/features/vehicles/post';
import { spacing } from '@/shared/theme';

import type { PostDetail } from '../../types';
import { PostSectionEditor } from './PostSectionEditor';

export function CarDetailsEditor({
  post,
  onClose,
  onSaved,
}: {
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [answers, setLocal] = useState<Partial<PostACarAnswers>>({
    make: post.make,
    model: post.model,
    colour: post.colour,
    colourNote: post.ownerNote ?? '',
    year: post.year ?? null,
    bodyType: post.bodyType ?? null,
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  const complete = Boolean(
    answers.make?.trim() && answers.model?.trim() && answers.colour?.trim(),
  );

  return (
    <PostSectionEditor
      title="Car details"
      onClose={onClose}
      onSaved={onSaved}
      canSave={complete}
      onSave={() =>
        saveCarDetails(post.id, {
          make: answers.make as string,
          model: answers.model as string,
          colour: answers.colour as string,
          colourNote: answers.colourNote ?? '',
          year: answers.year ?? null,
          bodyType: answers.bodyType ?? null,
        })
      }
    >
      <View style={{ gap: spacing.xl }}>
        <MakeStep answers={answers} setAnswers={setAnswers} />
        <ModelStep answers={answers} setAnswers={setAnswers} />
        <ColourStep answers={answers} setAnswers={setAnswers} />
        <BodyTypeStep answers={answers} setAnswers={setAnswers} />
        <YearStep answers={answers} setAnswers={setAnswers} />
      </View>
    </PostSectionEditor>
  );
}
