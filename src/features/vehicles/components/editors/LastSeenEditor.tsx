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
import { StyleSheet, Text, View } from 'react-native';

import { saveLastSeen } from '../../post/api/editSectionApi';
import { LastSeenWhenStep, LastSeenWhereStep } from '../../post/components/postSteps';
import { LAST_SEEN_QUESTIONS } from '../../post/lib/lastSeenTime';
import type { PostACarAnswers } from '../../post';
import { deriveLocalityForCoord } from '@/shared/lib/location/placeLabels';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

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
  const styles = useThemedStyles(makeStyles);
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
      {/* Each part under its own question (UI review, 2026-10-22): with the
          time as six cards, the map sits a scroll below — the headings say
          what each part asks. No advanceSoon: here a card only selects. */}
      <View style={styles.parts}>
        <View style={styles.part}>
          <Text accessibilityRole="header" style={styles.heading}>
            {LAST_SEEN_QUESTIONS.when}
          </Text>
          <LastSeenWhenStep answers={answers} setAnswers={setAnswers} />
        </View>
        <View style={styles.part}>
          <Text accessibilityRole="header" style={styles.heading}>
            {LAST_SEEN_QUESTIONS.where}
          </Text>
          <LastSeenWhereStep answers={answers} setAnswers={setAnswers} />
        </View>
      </View>
    </PostSectionEditor>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    parts: {
      gap: spacing.xl,
    },
    part: {
      gap: spacing.md,
    },
    // The wizard's question, a step down: these are parts of one editor.
    heading: {
      ...typography.heading,
      color: c.textPrimary,
    },
  });
