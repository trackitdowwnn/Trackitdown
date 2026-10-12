/**
 * WHAT:  CarDetailsEditor — edits the car's identity: make, model, colour (+ its
 *        note or finish), body type, and year, on a draft or a live post (the server
 *        has allowed live edits since 20260731110000_edit_car_details_when_live).
 *        Prefills from the post.
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

import { saveCarDetails } from '../../post/api/editSectionApi';
import {
  BodyTypeStep,
  ColourStep,
  MakeStep,
  ModelStep,
  YearStep,
} from '../../post/components/postSteps';
import type { PostACarAnswers } from '../../post';
import { colourIsComplete } from '@/shared/lib';
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
    colourFinish: post.colourFinish ?? null,
    year: post.year ?? null,
    bodyType: post.bodyType ?? null,
  });
  const setAnswers = (patch: Partial<PostACarAnswers>) =>
    setLocal((current) => ({ ...current, ...patch }));

  // The same rule as the wizard's colour step: "Other" needs its description
  // (colourIsComplete, 2026-10-12) — this editor reuses ColourStep but has
  // its own gate, so it must ask too.
  const complete = Boolean(
    answers.make?.trim() &&
      answers.model?.trim() &&
      answers.colour?.trim() &&
      colourIsComplete(answers.colour, answers.colourNote),
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
          // Sent on every save — the RPC replaces it, so leaving it out
          // would wipe it.
          colourFinish: answers.colourFinish ?? null,
          year: answers.year ?? null,
          bodyType: answers.bodyType ?? null,
        })
      }
    >
      <View style={{ gap: spacing.xl }}>
        <MakeStep answers={answers} setAnswers={setAnswers} />
        <ModelStep answers={answers} setAnswers={setAnswers} />
        {/* No Next here, so the finish is a row under the grid that opens
            the same sheet the wizard asks on Next. */}
        <ColourStep answers={answers} setAnswers={setAnswers} finishAsRow />
        <BodyTypeStep answers={answers} setAnswers={setAnswers} />
        <YearStep answers={answers} setAnswers={setAnswers} />
      </View>
    </PostSectionEditor>
  );
}
