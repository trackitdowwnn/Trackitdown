/**
 * WHAT:  Two of the report-sighting wizard's step components (2026-07-30
 *        rebuild; the safety gate moved out to ReportSafetySheet on
 *        2026-09-30, shown before the flow opens): the
 *        camera-AS-the-step photos step (in-place viewfinder, no modal, the
 *        ADR-0003 gallery button beside the shutter), the optional context
 *        step (redesigned 2026-10-01: one page of chip questions, each with
 *        "Not sure", inline follow-ups, the owner's marks with their photos,
 *        and a real note box; the footer says Skip until something's added).
 *        The last step, "Check and send", is its own file (ConfirmStep.tsx,
 *        2026-10-02).
 * WHY:   Speed-flow screens: big targets, minimal reading, nothing optional
 *        standing between the spotter and Send. The context step's reasons
 *        are in its section comment.
 *        SAFETY decisions live here: ≥1 LIVE in-app capture is required
 *        (gallery photos are supplementary, labelled, and never
 *        location-bearing — ADR-0003, re-enforced by the RPC), removing a
 *        photo removes its WHOLE evidence unit, and a missing GPS fix never
 *        blocks the flow (an un-located report is still valuable). The
 *        display-only confirm map's SAFETY note moved with it.
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the config);
 *        src/features/sightings/components/ConfirmStep.tsx (the last step);
 *        src/features/sightings/components/CompassPicker.tsx;
 *        src/features/sightings/lib/contextLabels.ts (the shared vocabulary);
 *        src/shared/ui (CameraCapture, PermissionPrimer, ChoiceChips,
 *        ChoiceChipsMulti, TextField, AppImage);
 *        src/features/sightings/components/ReportSafetySheet.tsx (the gate);
 *        docs/DOMAIN.md (Sighting rules — structured context);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig, ReduceMotion } from 'react-native-reanimated';

import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  AppImage,
  CameraCapture,
  ChoiceChips,
  ChoiceChipsMulti,
  type EvidencePhoto,
  PermissionPrimer,
  type PermissionPrimerContent,
  SAFETY_PRESENCE_LINE,
  TextField,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import {
  CONDITION_OPTIONS,
  FLAG_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  PEOPLE_PRESENCE_LABELS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  contextDetailCount,
  directionLabel,
} from '../lib/contextLabels';
import {
  CONDITION_FLAGS,
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type ContextQuestion,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type VehicleStateFlag,
} from '../types';
import { CompassPicker } from './CompassPicker';

const log = createLogger('sightings');

type StepProps = WizardStepProps<ReportSightingAnswers>;

// The safety gate that was step 1 is now ReportSafetySheet, shown over the
// listing before this flow opens (2026-09-30).

// --- 1 · Photos (the evidence step) --------------------------------------------

/** Primer copy for this flow — benefit-led headlines, reassurance lines
 *  verified against docs/SECURITY_AND_TRUST.md ("GPS is captured only at the
 *  moment of reporting a sighting — no background location tracking anywhere
 *  in the app"; in-app capture with no gallery path). Exported so tests can
 *  pin the copy word-for-word, like onboardingSlides. */
export const SIGHTING_LOCATION_PRIMER: PermissionPrimerContent = {
  emoji: '📍',
  headline: 'Pin it to the exact spot',
  body: 'Your report carries the spot where you’re standing — the strongest lead you can give the owner. Your location is used only at this moment, never in the background.',
  allowLabel: 'Allow location',
  secondaryLabel: 'Continue without location',
  // No denied copy: when the OS is blocked this primer never shows — the
  // report proceeds un-located (a settings detour must not stall a sighting).
};

export const SIGHTING_CAMERA_PRIMER: PermissionPrimerContent = {
  emoji: '📸',
  headline: 'Capture it in the moment',
  body: 'Photos taken here are stamped with the moment — that’s what makes your report count. You can add extra shots from your library too, clearly labelled.',
  allowLabel: 'Allow camera',
  denied: {
    headline: 'Camera access is off',
    body: 'No problem — you can turn it on any time in Settings. A sighting needs an in-app photo, so this step waits for the camera.',
  },
};

/** The CAMERA IS THE STEP (rebuild, 2026-07-30): no modal, no grid hand-off
 *  — the viewfinder mounts in place with its own thumbnail rail, and the
 *  ADR-0003 gallery button sits beside the shutter (the gallery PATH lives
 *  here in the step; CameraCapture stays live-only by design). Location
 *  priming happens once before the camera so the first shutter press can
 *  carry a fix; a decline continues — the report is simply un-located. */
export function PhotosStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [locationReady, setLocationReady] = useState<boolean | null>(null);
  const [picking, setPicking] = useState(false);
  const photos = answers.photos ?? [];
  const full = photos.length >= MAX_SIGHTING_PHOTOS;
  const liveCount = photos.filter((photo) => photo.source !== 'gallery').length;

  useEffect(() => {
    let cancelled = false;
    void Location.getForegroundPermissionsAsync().then(({ granted, canAskAgain }) => {
      if (cancelled) return;
      // Ask only when we truly can; a hard "denied" never blocks the camera.
      setLocationReady(granted || !canAskAgain);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCameraChange = (next: EvidencePhoto[]) => {
    if (next.length > photos.length) {
      const added = next[next.length - 1];
      log.info('photo_added', { source: added.source ?? 'live', count: next.length });
    }
    setAnswers({ photos: next });
  };

  /** ADR-0003 supplementary gallery photos: flagged source:'gallery', NEVER
   *  location-bearing (their EXIF is stripped at upload and never read as
   *  evidence). The ≥1-live rule gates Continue and is re-enforced by the
   *  RPC — gallery photos alone can't submit. */
  const pickFromGallery = async () => {
    if (picking || full) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: MAX_SIGHTING_PHOTOS - photos.length,
        exif: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const added: EvidencePhoto[] = result.assets
        .slice(0, MAX_SIGHTING_PHOTOS - photos.length)
        .map((asset) => ({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          // The moment it was ADDED — a gallery photo's own EXIF time is
          // never read as evidence (ADR-0003 payout blindness).
          capturedAt: new Date().toISOString(),
          source: 'gallery' as const,
        }));
      log.info('photo_added', { source: 'gallery', count: photos.length + added.length });
      setAnswers({ photos: [...photos, ...added] });
    } catch {
      // A failed pick is silent — the step simply stays put.
    } finally {
      setPicking(false);
    }
  };

  if (locationReady === null) {
    // The camera area mounts dark either way — reserve it so the primer or
    // viewfinder lands without a layout pop.
    return <View style={styles.cameraStep} />;
  }

  if (!locationReady) {
    return (
      <PermissionPrimer
        content={SIGHTING_LOCATION_PRIMER}
        // The wizard already announces the step question as the header.
        announceAsHeader={false}
        onPrimary={() => {
          void Location.requestForegroundPermissionsAsync().then(({ granted }) => {
            log.info('location_permission', { granted });
            setLocationReady(true);
          });
        }}
        onSecondary={() => {
          log.info('location_permission', { granted: false, skipped: true });
          setLocationReady(true);
        }}
      />
    );
  }

  return (
    <View style={styles.cameraStep}>
      <CameraCapture
        photos={photos}
        onChange={handleCameraChange}
        maxPhotos={MAX_SIGHTING_PHOTOS}
        primerContent={SIGHTING_CAMERA_PRIMER}
        shutterAccessory={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={full ? 'Photo limit reached' : 'Add from photo library'}
            disabled={picking || full}
            onPress={() => void pickFromGallery()}
            style={({ pressed }) => [
              styles.galleryButton,
              pressed && styles.galleryButtonPressed,
              (picking || full) && styles.galleryButtonDisabled,
            ]}
          >
            <Feather name="image" size={sizes.icon} color={palette.textPrimary} />
          </Pressable>
        }
      />
      {/* Honest requirement line: the ONE rule, stated once, quietly. */}
      <Text style={styles.quiet}>
        {liveCount === 0
          ? 'One photo taken here is required — library photos are welcome extras.'
          : full
            ? 'That’s the full set of 3.'
            : 'Add up to 3 — from the camera or your library.'}
      </Text>
    </View>
  );
}

// --- 2 · Context (all optional) --------------------------------------------------
//
// THE 2026-10-01 REDESIGN, after research (GOV.UK question pages, NN/g,
// Baymard, eyewitness-memory studies). What changed and why:
//   - ONE PAGE, ALL VISIBLE. Every question is a short row of chips. No sheet
//     springing up on a tap, no "Add more detail" drawer hiding the people
//     question, the owner's marks and the safety line.
//   - "NOT SURE" ON EVERY QUESTION, nothing pre-selected. People guess less
//     and are more accurate when "not sure" is a real, equal answer. It sends
//     nothing: to the owner it is simply unanswered.
//   - DESCRIBE, DON'T PREDICT. "Did it look like it was staying?", not
//     "Likely to stay?".
//   - ONE CONTROL GRAMMAR: chips (single = radios, condition = checkboxes),
//     the compass only for direction, bordered photo rows for the marks.
//   - ONE WAY ON. The footer reads "Skip" until something is added, then
//     "Continue" (reportSightingFlow's ctaLabel); the in-body Skip link went.
//   - THE WORDS ARE contextLabels': what the spotter taps is what the owner
//     reads.

/** The "Not sure" chip's value: never stored, only remembered (contextUnsure). */
const UNSURE = '__unsure__';
type MaybeUnsure<V extends string> = V | typeof UNSURE;
const UNSURE_OPTION = { value: UNSURE, label: 'Not sure' } as const;

/** The people answers that bring up the safety line. "Not sure" counts: a
 *  spotter who can't tell is the one tempted to step closer and check. */
const showsSafetyLine = (people: PeoplePresence | undefined, unsure: boolean) =>
  people === 'nearby' || people === 'in_vehicle' || unsure;

/** A follow-up, revealed with the tokens' in-place fade (reduced motion: just
 *  present) and indented under the answer it belongs to. */
function FollowUp({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
      style={styles.followUp}
    >
      {children}
    </Animated.View>
  );
}

/** An inline line revealed with the same fade, not indented (the safety line). */
function Reveal({ children }: { children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
      style={styles.revealBlock}
    >
      {children}
    </Animated.View>
  );
}

/** A question's title (a header, so it's on the headings rotor) and an
 *  optional quiet hint under it. */
function QuestionHead({ title, hint }: { title: string; hint?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.questionHead}>
      <Text accessibilityRole="header" style={styles.questionTitle}>
        {title}
      </Text>
      {hint ? <Text style={styles.questionHint}>{hint}</Text> : null}
    </View>
  );
}

/** One of the owner's marks: their photo, the description, and a check. */
function MarkTile({
  description,
  photoUrl,
  selected,
  onPress,
  testID,
}: {
  description: string;
  photoUrl?: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={description}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.markTile,
        selected && styles.markTileSelected,
        pressed && styles.markTilePressed,
      ]}
    >
      {photoUrl ? (
        <AppImage uri={photoUrl} style={styles.markThumb} testID={`${testID}-photo`} />
      ) : (
        // No photo: an empty thumb keeps every row's text on the same line.
        <View
          style={[styles.markThumb, styles.markThumbEmpty]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          <Feather name="image" size={sizes.iconSm} color={palette.textSecondary} />
        </View>
      )}
      <Text style={styles.markLabel}>{description}</Text>
      <Feather
        name={selected ? 'check-circle' : 'circle'}
        size={sizes.icon}
        // textSecondary, not borderStrong (~2.6:1): a control's state needs 3:1.
        color={selected ? palette.primary : palette.textSecondary}
      />
    </Pressable>
  );
}

/** The optional "Anything else that helps?" step: every context question on
 *  one page, written straight into the wizard's answers. */
export function ContextStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const flags = answers.contextFlags ?? [];
  const state = VEHICLE_STATE_FLAGS.find((flag) => flags.includes(flag)) ?? null;
  const conditions = flags.filter((flag): flag is ConditionFlag =>
    (CONDITION_FLAGS as readonly string[]).includes(flag),
  );
  const marks = answers.confirmableFeatures ?? [];
  const confirmedIds = answers.confirmedFeatureIds ?? [];
  const unsure = answers.contextUnsure ?? [];
  const details = contextDetailCount(answers);
  const safetyLine = showsSafetyLine(answers.peoplePresence, unsure.includes('people'));

  /** `unsure` with these questions set to not-sure (true) or cleared (false). */
  const withUnsure = (changes: Partial<Record<ContextQuestion, boolean>>): ContextQuestion[] => {
    const next = new Set(unsure);
    for (const [question, on] of Object.entries(changes) as [ContextQuestion, boolean][]) {
      if (on) next.add(question);
      else next.delete(question);
    }
    return [...next];
  };

  /** What a single-answer question's chips show as chosen. */
  const shown = <V extends string>(question: ContextQuestion, stored: V | undefined | null) =>
    (stored ?? (unsure.includes(question) ? UNSURE : null)) as MaybeUnsure<V> | null;

  /**
   * The vehicle's state. Tap again clears; a new state clears the OLD state's
   * follow-up so "Parked · looks parked up" can't linger under "Moving".
   * NOTE: contextFlags is rebuilt as state ∪ conditions, so any OTHER flag
   * seeded into the answers (a legacy people_nearby) would be dropped on the
   * first tap; fine for the wizard's always-fresh answers.
   */
  const selectState = (picked: MaybeUnsure<VehicleStateFlag>) => {
    const current = shown('state', state);
    const cleared = picked === current;
    const next = cleared || picked === UNSURE ? null : picked;
    setAnswers({
      contextFlags: [...(next ? [next] : []), ...conditions],
      parkedLikelihood: next === 'parked' ? answers.parkedLikelihood : undefined,
      direction: next === 'driving' ? answers.direction : undefined,
      contextUnsure: withUnsure({
        state: picked === UNSURE && !cleared,
        // A follow-up's "not sure" belongs to the state it followed.
        ...(next !== 'parked' ? { staying: false } : {}),
        ...(next !== 'driving' ? { direction: false } : {}),
      }),
    });
  };

  const selectStaying = (picked: MaybeUnsure<ParkedLikelihood>) => {
    const cleared = picked === shown('staying', answers.parkedLikelihood);
    setAnswers({
      parkedLikelihood: cleared || picked === UNSURE ? undefined : picked,
      contextUnsure: withUnsure({ staying: picked === UNSURE && !cleared }),
    });
  };

  const selectPeople = (picked: MaybeUnsure<PeoplePresence>) => {
    const cleared = picked === shown('people', answers.peoplePresence);
    const people = cleared || picked === UNSURE ? undefined : picked;
    const peopleUnsure = picked === UNSURE && !cleared;
    setAnswers({ peoplePresence: people, contextUnsure: withUnsure({ people: peopleUnsure }) });
    // SAFETY: say it out loud as it appears. iOS has no live regions, and a
    // live region that mounts with its text isn't reliably read on Android
    // either, so announce on both (the WizardScreen / TextField pattern).
    // Queued (iOS), so VoiceOver saying the chip's "selected" can't cut the
    // sentence off; Android ignores the option.
    if (!safetyLine && showsSafetyLine(people, peopleUnsure)) {
      AccessibilityInfo.announceForAccessibilityWithOptions(SAFETY_PRESENCE_LINE, { queue: true });
    }
  };

  /** "Looks intact" is exclusive: it can't stand beside damage, stripping or a
   *  changed plate, so picking it clears them and picking any of them clears it. */
  const changeConditions = (next: ConditionFlag[]) => {
    const added = next.find((flag) => !conditions.includes(flag));
    const resolved =
      added === 'looks_intact'
        ? (['looks_intact'] as ConditionFlag[])
        : added
          ? next.filter((flag) => flag !== 'looks_intact')
          : next;
    setAnswers({ contextFlags: [...(state ? [state] : []), ...resolved] });
  };

  const toggleMark = (id: string) => {
    setAnswers({
      confirmedFeatureIds: confirmedIds.includes(id)
        ? confirmedIds.filter((existing) => existing !== id)
        : [...confirmedIds, id],
    });
  };

  const noteLength = answers.note?.length ?? 0;

  return (
    // skipEntering: follow-ups already answered (coming Back to the step) are
    // simply there; only a reveal AFTER mount fades in. A first-mount
    // `entering` can finish on a stale frame on device (WizardScreen's X fix,
    // 2026-09-30).
    <LayoutAnimationConfig skipEntering>
      <View style={styles.contextStack}>
        {/* Always rendered, so the page never jumps when the first chip is
            tapped. Not a live region: each chip already says checked or not,
            and the safety line should be the only thing that speaks. */}
        <Text style={styles.count} testID="context-count">
          {details === 0
            ? 'Nothing added yet'
            : details === 1
              ? '1 detail added'
              : `${details} details added`}
        </Text>

        <View>
          <QuestionHead title="What was it doing?" />
          <ChoiceChips
            options={[
              ...STATE_OPTIONS.map((value) => ({ value, label: FLAG_LABELS[value] })),
              UNSURE_OPTION,
            ]}
            value={shown('state', state)}
            onSelect={selectState}
            accessibilityLabel="What was it doing?"
            clearable
            testID="context-state"
          />

          {state === 'parked' ? (
            <FollowUp>
              <QuestionHead title="Did it look like it was staying?" />
              <ChoiceChips
                options={[
                  ...STAYING_OPTIONS.map((value) => ({
                    value,
                    label: PARKED_LIKELIHOOD_LABELS[value],
                  })),
                  UNSURE_OPTION,
                ]}
                value={shown('staying', answers.parkedLikelihood)}
                onSelect={selectStaying}
                accessibilityLabel="Did it look like it was staying?"
                clearable
                testID="context-staying"
              />
            </FollowUp>
          ) : null}

          {state === 'driving' ? (
            <FollowUp>
              {/* The hint is always there (so the grid never shifts under a
                  second tap) and names the pick once there is one. */}
              <QuestionHead
                title="Which way was it heading?"
                hint={answers.direction ? directionLabel(answers.direction) : 'Tap where it went.'}
              />
              <View style={styles.compass}>
                <CompassPicker
                  value={answers.direction}
                  onChange={(direction) =>
                    setAnswers({ direction, contextUnsure: withUnsure({ direction: false }) })
                  }
                  accessibilityLabel="Which way was it heading?"
                />
                {/* Under the compass, centred with it: one control. A checkbox,
                    not a lone radio, because it toggles on its own. */}
                <ChoiceChipsMulti
                  // Says what it's unsure OF: on its own, "Not sure" under a
                  // compass is just "Not sure, checkbox".
                  options={[{ ...UNSURE_OPTION, accessibilityLabel: 'Not sure which way it went' }]}
                  value={unsure.includes('direction') ? [UNSURE] : []}
                  onChange={(next) => {
                    const on = next.length > 0;
                    setAnswers({
                      direction: on ? undefined : answers.direction,
                      contextUnsure: withUnsure({ direction: on }),
                    });
                  }}
                  testID="context-direction-unsure"
                />
              </View>
            </FollowUp>
          ) : null}
        </View>

        <View>
          <QuestionHead title="Anyone in or near it?" />
          <ChoiceChips
            options={[
              ...PEOPLE_OPTIONS.map((value) => ({ value, label: PEOPLE_PRESENCE_LABELS[value] })),
              UNSURE_OPTION,
            ]}
            value={shown('people', answers.peoplePresence)}
            onSelect={selectPeople}
            accessibilityLabel="Anyone in or near it?"
            clearable
            testID="context-people"
          />
          {safetyLine ? (
            <Reveal>
              {/* SAFETY: fixed, imported copy (SAFETY_PRESENCE_LINE), not a
                  prop — the register reinforces the gate's rule exactly where
                  the temptation to linger lives. Firm and unmissable: question
                  weight, with SafetyNotice's rule glyph; announced by
                  selectPeople as it appears. */}
              <View style={styles.safetyRow} accessible accessibilityLabel={SAFETY_PRESENCE_LINE}>
                <Feather
                  name="slash"
                  size={sizes.iconSm}
                  color={palette.textPrimary}
                  style={styles.safetyGlyph}
                />
                <Text style={styles.safetyInline}>{SAFETY_PRESENCE_LINE}</Text>
              </View>
            </Reveal>
          ) : null}
        </View>

        <View>
          <QuestionHead title="Its condition" hint="Any that apply." />
          <ChoiceChipsMulti
            options={CONDITION_OPTIONS.map((value) => ({ value, label: FLAG_LABELS[value] }))}
            value={conditions}
            onChange={changeConditions}
            accessibilityLabel="Its condition"
            testID="context-condition"
          />
        </View>

        {marks.length > 0 ? (
          <View>
            <QuestionHead
              title="Could you see any of these?"
              hint="The owner’s marks. Tick any you could see from where you were."
            />
            <View style={styles.markTiles}>
              {marks.map((mark) => (
                <MarkTile
                  key={mark.id}
                  description={mark.description}
                  photoUrl={mark.photoUrl}
                  selected={confirmedIds.includes(mark.id)}
                  onPress={() => toggleMark(mark.id)}
                  testID={`confirm-mark-${mark.id}`}
                />
              ))}
            </View>
          </View>
        ) : null}

        <TextField
          label="A note for the owner (optional)"
          variant="multiline"
          value={answers.note ?? ''}
          onChangeText={(note) => setAnswers({ note })}
          helperText="What you noticed. A line is plenty."
          counter={`${noteLength}/${MAX_NOTE_LENGTH}`}
          // The counter is hidden from screen readers (TextField's contract);
          // the limit goes here instead, read once on focus.
          accessibilityHint={`Up to ${MAX_NOTE_LENGTH} characters`}
          maxLength={MAX_NOTE_LENGTH}
        />
      </View>
    </LayoutAnimationConfig>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  quiet: {
    ...typography.caption,
    color: c.textSecondary,
  },
  revealBlock: {
    marginTop: spacing.md,
  },
  // flex: 1 takes the row's spare room, so the check always sits trailing.
  markLabel: {
    ...typography.body,
    color: c.textPrimary,
    flex: 1,
  },
  // Safety copy is the one place we are firm and unmissable — never the
  // quietest style on the screen: question weight, ink (never `danger`), with
  // SafetyNotice's rule glyph.
  // Top-aligned, the glyph centred on the FIRST line: at large text the line
  // wraps, and a centred glyph would float mid-block (SafetyNotice's fix).
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  safetyGlyph: {
    marginTop: (typography.cardTitle.lineHeight - sizes.iconSm) / 2,
  },
  safetyInline: {
    ...typography.cardTitle,
    color: c.textPrimary,
    flexShrink: 1,
  },
  // The camera-as-step: viewfinder + controls own a fixed, generous canvas
  // (a flex child inside the wizard's scroll must claim its height).
  cameraStep: {
    height: sizes.cameraStep,
    gap: spacing.md,
  },
  galleryButton: {
    width: sizes.control,
    height: sizes.control,
    borderRadius: radii.full,
    backgroundColor: c.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryButtonPressed: {
    backgroundColor: c.surfaceSubtlePressed,
  },
  galleryButtonDisabled: {
    opacity: opacity.disabled,
  },
  // --- The context step (2026-10-01 redesign) ---------------------------------
  // One question = a title, an optional quiet hint, then its chips. Questions
  // sit `xxl` apart so each reads as its own block on a long page.
  contextStack: {
    gap: spacing.xxl,
  },
  questionTitle: {
    ...typography.cardTitle,
    color: c.textPrimary,
  },
  questionHint: {
    ...typography.caption,
    color: c.textSecondary,
  },
  questionHead: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  // A follow-up indents under its parent answer, with a 2pt rule down its
  // left edge, so it reads as "about the Parked you just chose".
  followUp: {
    marginTop: spacing.lg,
    paddingLeft: spacing.lg,
    borderLeftWidth: sizes.followUpRule,
    borderLeftColor: c.border,
  },
  // The compass and its "Not sure", centred together as one control (the
  // grid centres itself; this centres the chip under it).
  compass: {
    alignItems: 'center',
    gap: spacing.md,
  },
  count: {
    ...typography.label,
    color: c.textSecondary,
  },
  // The owner's marks: a bordered row each (CardSelect's border and check
  // cue, at the compact `md` radius of the SelectScreen tiles), the owner's
  // photo on the left so the spotter knows what to look for.
  markTile: {
    minHeight: sizes.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    paddingRight: spacing.lg,
    borderRadius: radii.md,
    borderWidth: sizes.selectBorder,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  markTileSelected: {
    borderColor: c.primary,
  },
  markTilePressed: {
    backgroundColor: c.surfaceSubtle,
  },
  markThumb: {
    width: sizes.markThumb,
    height: sizes.markThumb,
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  markThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markTiles: {
    gap: spacing.sm,
  },
});
