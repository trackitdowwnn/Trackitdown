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
 *        ./PhotosWithPlateScanStep.tsx (the consumer);
 *        docs/DESIGN_SYSTEM.md (sheet anatomy, tone of voice).
 */

import { useState } from 'react';
import type { Ref } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { PlateCandidate } from '@/shared/lib/plateCandidates';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { BottomSheet, Button, PlateChip, spellPlate, type BottomSheetRef } from '@/shared/ui';

export interface PlateScanSheetProps {
  ref?: Ref<BottomSheetRef>;
  /**
   * Ranked best-first. Empty renders the "couldn't read it" state — which the
   * photos step never asks for, because a scan that reads nothing stays silent
   * rather than opening a sheet to say so. It is kept for the entry point that
   * would need it: a scan the owner ASKED for owes an answer either way, and
   * this sheet is where that answer would go. (The `blocked` permission state
   * was deleted rather than kept, because permission is the photo grid's
   * business now and no future caller here would own it.)
   */
  candidates: readonly PlateCandidate[];
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
  /**
   * They turned the reading down — the ghost button, or "type it instead".
   * A REQUEST to close, not the closing itself: the sheet does not tidy up
   * here, because it is still on screen for the length of the animation.
   */
  onDecline: () => void;
  /**
   * The sheet has FINISHED closing — however that happened, including a swipe
   * or a tap on the scrim. Kept separate from `onDecline` because one prop
   * meaning both fires twice for every button press, once with the question
   * already gone. This is the only safe place to clear a reading.
   */
  onDismiss?: () => void;
}

export function PlateScanSheet({
  ref,
  candidates,
  existingPlate = null,
  onConfirm,
  onDecline,
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

  const found = candidates.length > 0;
  const chosen = candidates[selected];

  const disagreeing = found && Boolean(existingPlate);

  const title = !found
    ? "Couldn't read it"
    : disagreeing
      ? 'Which one is right?'
      : 'Is this your registration?';

  return (
    <BottomSheet ref={ref} title={title} onDismiss={onDismiss}>
      <View style={styles.content} testID="plate-scan-sheet">
        {!found ? (
          <>
            <Text style={styles.body}>
              We couldn&apos;t read a plate clearly. Try a straighter shot with the plate
              filling more of the frame — or just type it in.
            </Text>
            <Button label="Type it instead" onPress={onDecline} />
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
              // Not "tap": a switch or a screen reader does not tap, and the
              // sentence is about WHICH plate, not about fingers.
              <Text style={styles.body}>Pick the one that matches your car.</Text>
            ) : null}

            {/* One reading is not a choice, so it is not a control. Wrapping it
                in a Pressable gave a 44pt target that swallowed taps and
                answered with nothing, announced as "double tap to activate"
                with no role and no state to change — and the wrapper's label
                hid PlateChip's own, better one. A plain View lets the chip
                speak for itself; the buttons below are the only choice on
                offer. */}
            {candidates.length === 1 ? (
              <View style={styles.options}>
                <View style={styles.option}>
                  <PlateChip plate={candidates[0].display} />
                </View>
              </View>
            ) : (
              <View style={styles.options} accessibilityRole="radiogroup">
                {candidates.map((candidate, index) => {
                  const isSelected = index === selected;
                  return (
                    <Pressable
                      key={candidate.canon}
                      onPress={() => setSelected(index)}
                      accessibilityRole="radio"
                      // Spelled out — "AB12 CDE" read aloud as a word is useless.
                      accessibilityLabel={spellPlate(candidate.display)}
                      accessibilityState={{ checked: isSelected }}
                      style={[styles.option, styles.choosable, isSelected && styles.optionSelected]}
                      testID={`plate-candidate-${candidate.canon}`}
                    >
                      <PlateChip plate={candidate.display} />
                    </Pressable>
                  );
                })}
              </View>
            )}

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
              onPress={onDecline}
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
    gap: spacing.md,
    alignItems: 'center',
  },
  option: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    // Constant width, colour-only change on select — the house rule for a
    // bordered selectable (see CardSelect), so nothing shifts when picked.
    borderWidth: sizes.selectBorder,
    // Transparent rather than absent, so the lone reading — which is not a
    // control — sits at the same size as a choosable one without wearing a ring.
    borderColor: 'transparent',
  },
  /** A row that IS a choice, so it must look like one before it is picked. */
  choosable: {
    borderColor: colors.border,
    // The whole row, not just the chip: centred options left the space either
    // side of a short plate dead, which is most of the row on a sheet.
    alignSelf: 'stretch',
  },
  optionSelected: {
    // Border colour alone. A surfaceSubtle fill here is the chip's OWN fill, so
    // picking a plate dissolved its edges into the selection at exactly the
    // moment it needed to read as a plate.
    borderColor: colors.primary,
  },
});
