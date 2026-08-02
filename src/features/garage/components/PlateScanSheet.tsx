/**
 * WHAT:  PlateScanSheet — "Is this your registration?" The sheet that shows
 *        what OCR read and lets the owner confirm it, pick a different
 *        candidate, or fall back to typing.
 * WHY:   A scanned plate is NEVER written straight into the field. OCR misreads
 *        plates (O/0, I/1, S/5 are near-identical in the plate typeface) and
 *        there is no DVLA lookup in this app to catch a bad read — so the
 *        person who owns the car is the only check there is, and they must be
 *        shown the result before it counts. That single confirmation is what
 *        makes the whole feature safe to ship without verification behind it.
 *
 *        The highest-ranked candidate starts selected, because it is right most
 *        of the time and one tap should finish the job.
 *
 *        `PlateChip` is display-only by contract, so each option is a Pressable
 *        WRAPPING a chip rather than a modified chip — the shared component
 *        keeps its single job.
 * LINKS: src/shared/lib/plateCandidates.ts (where candidates come from);
 *        src/shared/ui/BottomSheet.tsx, PlateChip.tsx;
 *        ./garageSteps.tsx (the consumer);
 *        docs/DESIGN_SYSTEM.md (sheet anatomy, tone of voice).
 */

import { useState } from 'react';
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PlateCandidate } from '@/shared/lib/plateCandidates';
import { spellPlate } from '@/shared/ui';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { BottomSheet, Button, PlateChip, type BottomSheetRef } from '@/shared/ui';

export interface PlateScanSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** Ranked best-first. Empty renders the "couldn't read it" state. */
  candidates: readonly PlateCandidate[];
  /**
   * Camera or photo permission was refused. Handled HERE rather than with a
   * toast so the step needs no ToastProvider — a wizard step that requires a
   * provider makes every consumer and every test carry it, and this sheet is
   * already the "that didn't work, here's what to do" surface.
   */
  blocked?: boolean;
  /**
   * What the owner already typed, if anything. Its presence changes the
   * QUESTION: with an empty field this is a discovery ("is this it?"), but
   * against a typed plate it is a disagreement ("which is right?"), and the
   * sheet must show what they typed as a choice rather than quietly implying
   * the machine is correct. They may well be right and the photo misread.
   */
  existingPlate?: string | null;
  /** The canonical plate the user accepted. */
  onConfirm: (canon: string) => void;
  /** They chose to type instead, or dismissed the sheet. */
  onDismiss?: () => void;
}

export function PlateScanSheet({
  ref,
  candidates,
  blocked = false,
  existingPlate = null,
  onConfirm,
  onDismiss,
}: PlateScanSheetProps) {
  const [selected, setSelected] = useState(0);

  // A new scan is a new question — never carry the previous answer's index
  // across, or a second scan opens with the wrong chip highlighted.
  //
  // Render-phase adjustment, not an effect (the house pattern — see
  // VehicleCard's carousel reset). An effect here sets state after paint, which
  // both flashes the stale selection for a frame and trips the compiler's
  // cascading-render rule.
  const [scanShown, setScanShown] = useState(candidates);
  if (candidates !== scanShown) {
    setScanShown(candidates);
    setSelected(0);
  }

  const found = !blocked && candidates.length > 0;
  const chosen = candidates[selected];

  const disagreeing = found && Boolean(existingPlate);

  const title = blocked
    ? 'Photo access is off'
    : !found
      ? "Couldn't read it"
      : disagreeing
        ? 'Which one is right?'
        : 'Is this your registration?';

  return (
    <BottomSheet ref={ref} title={title} onDismiss={onDismiss}>
      <View style={styles.content} testID="plate-scan-sheet">
        {blocked ? (
          <>
            <Text style={styles.body}>
              To scan a plate we need access to your camera or photos. You can turn that
              on in Settings — or just type the plate in.
            </Text>
            <Button label="Type it instead" onPress={() => onDismiss?.()} />
          </>
        ) : !found ? (
          <>
            <Text style={styles.body}>
              We couldn&apos;t read a plate clearly. Try a straighter shot with the plate
              filling more of the frame — or just type it in.
            </Text>
            <Button label="Type it instead" onPress={() => onDismiss?.()} />
          </>
        ) : (
          <>
            {disagreeing ? (
              <Text style={styles.body}>
                Your photos look like{' '}
                {candidates.length > 1 ? 'one of these' : candidates[0].display}, but you
                typed {existingPlate}. Yours may well be right — a plate is easy to
                misread from a photo.
              </Text>
            ) : candidates.length > 1 ? (
              <Text style={styles.body}>Tap the right one.</Text>
            ) : null}

            <View
              style={styles.options}
              accessibilityRole={candidates.length > 1 ? 'radiogroup' : undefined}
            >
              {candidates.map((candidate, index) => {
                const isSelected = index === selected;
                return (
                  <Pressable
                    key={candidate.canon}
                    onPress={() => setSelected(index)}
                    accessibilityRole={candidates.length > 1 ? 'radio' : undefined}
                    // Spelled out — "AB12 CDE" read aloud as a word is useless.
                    accessibilityLabel={spellPlate(candidate.display)}
                    accessibilityState={
                      candidates.length > 1 ? { checked: isSelected } : undefined
                    }
                    style={[styles.option, isSelected && styles.optionSelected]}
                    testID={`plate-candidate-${candidate.canon}`}
                  >
                    <PlateChip plate={candidate.display} />
                  </Pressable>
                );
              })}
            </View>

            <Button
              label={disagreeing ? 'Use this one' : "Yes, that's it"}
              onPress={() => chosen && onConfirm(chosen.canon)}
            />
            {/* Dismissing KEEPS what they typed. The wording says so, because
                "No" next to a machine's confident guess should not feel like
                admitting a mistake.
                With an empty field there is nothing to keep, so it simply
                disagrees: "That's not it" mirrors "Yes, that's it" and puts the
                error on the READING, which is where it belongs. It used to say
                "No, I'll type it" — that made saying no sound like volunteering
                for work, when declining a bad guess should cost nothing. */}
            <Button
              label={disagreeing ? `Keep ${existingPlate}` : "That's not it"}
              variant="ghost"
              onPress={() => onDismiss?.()}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  options: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  option: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 2,
    // Transparent rather than absent, so selecting does not shift the layout.
    borderColor: 'transparent',
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceSubtle,
  },
});
