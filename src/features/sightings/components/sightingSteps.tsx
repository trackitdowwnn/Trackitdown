/**
 * WHAT:  The four report-sighting wizard step components: the safety gate
 *        (SafetyNotice hero + Call 999), the evidence step (camera-first
 *        full-screen capture over a PhotoGridPicker review grid), the
 *        optional context step (single-select vehicle state with conditional
 *        likelihood/compass follow-ups, condition chips, confirmable-marks
 *        checkmarks, the 3-way people question with its inline safety
 *        register, and the note), and the confirm step (photos,
 *        captured-point map, time, the full context summary).
 * WHY:   Speed-flow screens: big targets, minimal reading, nothing optional
 *        standing between the spotter and Send. The photo step lands
 *        STRAIGHT in the viewfinder when there is no evidence yet (the car
 *        may drive off); once something is captured the grid is the resting
 *        state — per-tile preview/remove, add tile reopening the camera.
 *        SAFETY decisions live here: the camera is the ONLY photo source
 *        (grid runs source="capture" — no gallery; DOMAIN sighting rules /
 *        ADR-0003), a removed tile removes its WHOLE evidence unit, the
 *        confirm map is display-only (the CAPTURED point is the evidence —
 *        no manual editing, ever), and a missing GPS fix never blocks the
 *        flow (an un-located report is still valuable).
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the config);
 *        src/features/sightings/components/CompassPicker.tsx;
 *        src/features/sightings/lib/contextLabels.ts (the shared vocabulary);
 *        src/shared/ui (CameraCapture, PhotoGridPicker, PermissionPrimer,
 *        SafetyNotice, ChoiceChips, ChoiceChipsMulti, TextField, AppMap);
 *        docs/DOMAIN.md (Sighting rules — structured context);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTimeAgo } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import { colors, motion, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  Button,
  CameraCapture,
  ChoiceChips,
  ChoiceChipsMulti,
  type EvidencePhoto,
  PermissionPrimer,
  type PermissionPrimerContent,
  PhotoGridPicker,
  SafetyNotice,
  TextField,
} from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';
import type { WizardStepProps } from '@/shared/wizard';

import { firstLocatedPhoto } from '../lib/areaLabel';
import { contextSummary } from '../lib/contextLabels';
import {
  CONDITION_FLAGS,
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  VEHICLE_STATE_FLAGS,
  type ConditionFlag,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type VehicleStateFlag,
} from '../types';
import { CompassPicker } from './CompassPicker';

const log = createLogger('sightings');

type StepProps = WizardStepProps<ReportSightingAnswers>;

// --- 1 · Safety gate ----------------------------------------------------------

/** Not skippable but readable in three seconds: the notice is the hero, the
 *  999 path is one tap, and Continue lives in the wizard footer. */
export function SafetyStep(_props: StepProps) {
  return (
    <View style={styles.stack}>
      <SafetyNotice />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Call 999"
        onPress={() => void Linking.openURL('tel:999')}
        style={({ pressed }) => [styles.call999, pressed && styles.call999Pressed]}
      >
        <Feather name="phone-call" size={sizes.iconSm} color={colors.textOnPrimary} />
        <Text style={styles.call999Label}>Call 999</Text>
      </Pressable>
      <Text style={styles.quiet}>
        If it’s safe to continue, the next step takes the photos.
      </Text>
    </View>
  );
}

// --- 2 · Photos (the evidence step) --------------------------------------------

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
  body: 'Photos are taken here in the app, stamped with the moment — that’s what makes your report count. Nothing from your photo library is touched.',
  allowLabel: 'Allow camera',
  denied: {
    headline: 'Camera access is off',
    body: 'No problem — you can turn it on any time in Settings. A sighting needs an in-app photo, so this step waits for the camera.',
  },
};

/** Location priming happens HERE (once, before the camera) so the first
 *  shutter press can carry a fix; a decline continues to the camera — the
 *  report is simply un-located. The camera itself owns camera permission.
 *  Camera-FIRST: with no evidence yet the full-screen camera opens the
 *  moment the primer clears (speed: the car may drive off); the grid is the
 *  resting state once something is captured. */
export function PhotosStep({ answers, setAnswers }: StepProps) {
  const [locationReady, setLocationReady] = useState<boolean | null>(null);
  const insets = useSafeAreaInsets();
  const photos = answers.photos ?? [];
  // Initial value only: re-entering the step WITH photos rests on the grid.
  const [cameraOpen, setCameraOpen] = useState(photos.length === 0);

  const handleCameraChange = (next: EvidencePhoto[]) => {
    setAnswers({ photos: next });
    if (next.length >= MAX_SIGHTING_PHOTOS) {
      // Full — nothing left to take; land on the grid for review.
      setCameraOpen(false);
    }
  };

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

  if (locationReady === null) {
    return <View style={styles.stack} />;
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
    <View style={styles.stack}>
      {/* The review grid — the step's resting state. source="capture": the
          add tile reopens the camera; NO gallery path exists (DOMAIN
          sighting rules / ADR-0003). Removing a tile removes the whole
          evidence unit (photo + its GPS + timestamp together). */}
      <PhotoGridPicker<EvidencePhoto>
        source="capture"
        onRequestCapture={() => setCameraOpen(true)}
        photos={photos}
        onChangePhotos={(next) => setAnswers({ photos: next })}
        minPhotos={MIN_SIGHTING_PHOTOS}
        maxPhotos={MAX_SIGHTING_PHOTOS}
        tipsVisible={false}
        copy={{
          addLabel: photos.length === 0 ? 'Take photos' : 'Add another photo',
          addMore: () => 'Add at least one photo',
          addRemaining: (remaining) =>
            remaining === 1 ? 'Room for 1 more' : `Room for ${remaining} more`,
        }}
        testID="sighting-photo-grid"
      />

      {/* Full-screen evidence camera. Android back (onRequestClose) and Done
          both land on the grid; at 3/3 handleCameraChange closes it itself. */}
      <Modal
        visible={cameraOpen}
        animationType="slide"
        onRequestClose={() => setCameraOpen(false)}
        testID="sighting-camera-modal"
      >
        <View
          style={[
            styles.cameraModal,
            {
              paddingTop: insets.top + spacing.lg,
              // Full-screen Modal runs under the home indicator — keep the
              // Done button (the flow's only exit) clear of the swipe zone.
              paddingBottom: Math.max(insets.bottom, spacing.xl),
            },
          ]}
        >
          <View style={styles.cameraBody}>
            <CameraCapture
              photos={photos}
              onChange={handleCameraChange}
              maxPhotos={MAX_SIGHTING_PHOTOS}
              primerContent={SIGHTING_CAMERA_PRIMER}
            />
          </View>
          <Button label="Done" onPress={() => setCameraOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

// --- 3 · Context (all optional) --------------------------------------------------

/** The three mutually exclusive vehicle STATES — a single-select group (the
 *  storage stays the shared context_flags array). */
const STATE_OPTIONS: { value: VehicleStateFlag; label: string }[] = [
  { value: 'parked', label: 'Parked' },
  { value: 'driving', label: 'Driving' },
  { value: 'being_loaded', label: 'Being loaded/towed' },
];

const CONDITION_OPTIONS: { value: ConditionFlag; label: string }[] = [
  { value: 'plate_changed', label: 'Plate changed or missing' },
  { value: 'damage_visible', label: 'Damage visible' },
  { value: 'being_stripped', label: 'Being stripped' },
  { value: 'looks_intact', label: 'Looks intact' },
];

const PARKED_LIKELIHOOD_OPTIONS: { value: ParkedLikelihood; label: string }[] = [
  { value: 'settled', label: 'Looks settled' },
  { value: 'street', label: 'Street parked' },
  { value: 'moving', label: 'About to move' },
];

const PEOPLE_OPTIONS: { value: PeoplePresence; label: string }[] = [
  { value: 'nobody', label: 'Nobody around' },
  { value: 'nearby', label: 'People near it' },
  { value: 'in_vehicle', label: 'Someone in it' },
];

/** A conditional sub-question, revealed with the tokens' in-place fade.
 *  Reduced motion → simply present (ReduceMotion.System). */
function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
      style={styles.revealBlock}
    >
      {children}
    </Animated.View>
  );
}

export function ContextStep({ answers, setAnswers }: StepProps) {
  const flags = answers.contextFlags ?? [];
  const state = VEHICLE_STATE_FLAGS.find((flag) => flags.includes(flag)) ?? null;
  const conditions = flags.filter((flag): flag is ConditionFlag =>
    (CONDITION_FLAGS as readonly string[]).includes(flag),
  );
  const marks = answers.confirmableFeatures ?? [];
  const confirmedIds = answers.confirmedFeatureIds ?? [];

  /** Tap-again clears; switching state clears the OLD state's follow-up so a
   *  "Parked · likely to stay" answer can't linger under "Driving". NOTE:
   *  contextFlags is rebuilt as state ∪ conditions — any OTHER flag seeded
   *  into the answers (e.g. a legacy people_nearby) would be dropped on the
   *  first tap; fine for the wizard's always-fresh answers, a trap if anyone
   *  ever seeds answers from an existing sighting. */
  const selectState = (next: VehicleStateFlag) => {
    const cleared = next === state ? null : next;
    setAnswers({
      contextFlags: [...(cleared ? [cleared] : []), ...conditions],
      parkedLikelihood: cleared === 'parked' ? answers.parkedLikelihood : undefined,
      direction: cleared === 'driving' ? answers.direction : undefined,
    });
  };

  const toggleMark = (id: string) => {
    setAnswers({
      confirmedFeatureIds: confirmedIds.includes(id)
        ? confirmedIds.filter((existing) => existing !== id)
        : [...confirmedIds, id],
    });
  };

  return (
    <View style={styles.stack}>
      <View>
        <Text style={styles.subheading}>What’s it doing?</Text>
        <ChoiceChips options={STATE_OPTIONS} value={state} onSelect={selectState} />
        {state === 'parked' ? (
          <Reveal>
            <Text style={styles.subheading}>Likely to stay?</Text>
            <ChoiceChips
              options={PARKED_LIKELIHOOD_OPTIONS}
              value={answers.parkedLikelihood ?? null}
              onSelect={(next) =>
                setAnswers({
                  parkedLikelihood: next === answers.parkedLikelihood ? undefined : next,
                })
              }
            />
          </Reveal>
        ) : null}
        {state === 'driving' ? (
          <Reveal>
            <Text style={styles.subheading}>Which way was it heading?</Text>
            <CompassPicker
              value={answers.direction}
              onChange={(direction) => setAnswers({ direction })}
            />
          </Reveal>
        ) : null}
      </View>

      <View>
        <Text style={styles.subheading}>Condition at a glance</Text>
        <ChoiceChipsMulti
          options={CONDITION_OPTIONS}
          value={conditions}
          onChange={(next) =>
            setAnswers({ contextFlags: [...(state ? [state] : []), ...next] })
          }
        />
      </View>

      {marks.length > 0 ? (
        <View>
          <Text style={styles.subheading}>Could you see…?</Text>
          {marks.map((mark) => {
            const confirmed = confirmedIds.includes(mark.id);
            return (
              <Pressable
                key={mark.id}
                accessibilityRole="checkbox"
                accessibilityLabel={mark.description}
                accessibilityState={{ checked: confirmed }}
                onPress={() => toggleMark(mark.id)}
                style={({ pressed }) => [styles.markRow, pressed && styles.markRowPressed]}
                testID={`confirm-mark-${mark.id}`}
              >
                <Feather
                  name={confirmed ? 'check-square' : 'square'}
                  size={sizes.iconSm}
                  color={confirmed ? colors.primary : colors.textSecondary}
                />
                <Text style={styles.markLabel}>{mark.description}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View>
        <Text style={styles.subheading}>Anyone around?</Text>
        <ChoiceChips
          options={PEOPLE_OPTIONS}
          value={answers.peoplePresence ?? null}
          onSelect={(next) =>
            setAnswers({
              peoplePresence: next === answers.peoplePresence ? undefined : next,
            })
          }
        />
        {answers.peoplePresence === 'nearby' || answers.peoplePresence === 'in_vehicle' ? (
          <Reveal>
            {/* SAFETY: fixed copy, not a prop — the register reinforces the
                gate's rule exactly where the temptation to linger lives.
                Firm and unmissable (the safety-copy rule), and announced to
                screen readers when it reveals. */}
            <Text accessibilityLiveRegion="polite" style={styles.safetyInline}>
              Don’t approach — your report is enough.
            </Text>
          </Reveal>
        ) : null}
      </View>

      <TextField
        label="Anything else? (optional)"
        value={answers.note ?? ''}
        onChangeText={(note) => setAnswers({ note })}
        helperText="What you noticed — a line is plenty."
        maxLength={MAX_NOTE_LENGTH}
        multiline
      />
    </View>
  );
}

// --- 4 · Confirm & send ------------------------------------------------------------

/** ~0.6-mile span: enough to place the pin without implying precision. */
const CONFIRM_DELTA = 0.008;

export function ConfirmStep({ answers }: StepProps) {
  const photos = answers.photos ?? [];
  const located = firstLocatedPhoto(photos);
  const takenAgo = useTimeAgo(photos[0]?.capturedAt ?? new Date().toISOString());
  // EVERYTHING the spotter said, in the shared friendly vocabulary — the
  // confirm screen must review the whole report, not just the chips.
  const contextParts = contextSummary(answers);
  const confirmedMarks = (answers.confirmableFeatures ?? []).filter((mark) =>
    (answers.confirmedFeatureIds ?? []).includes(mark.id),
  );

  return (
    <View style={styles.stack}>
      <View style={styles.confirmPhotos}>
        {photos.map((photo) => (
          <AppImage key={photo.uri} uri={photo.uri} style={styles.confirmPhoto} />
        ))}
      </View>

      {located ? (
        <View>
          {/* SAFETY: display only — the CAPTURED point is the evidence. There
              is deliberately no way to move this pin or pick a location. */}
          <View style={styles.confirmMap} pointerEvents="none">
            <AppMap
              interactive={false}
              region={{
                latitude: located.lat as number,
                longitude: located.lng as number,
                latitudeDelta: CONFIRM_DELTA,
                longitudeDelta: CONFIRM_DELTA,
              }}
              animateDurationMs={0}
              onRegionChangeStart={() => {}}
              onRegionChangeComplete={() => {}}
            >
              <AppMapMarker
                coordinate={{ latitude: located.lat as number, longitude: located.lng as number }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.pin} />
              </AppMapMarker>
            </AppMap>
          </View>
          <Text style={styles.meta}>
            {answers.areaLabel ? `Reported near ${answers.areaLabel}` : 'Reported at the captured spot'}
            {' · '}
            {takenAgo}
          </Text>
        </View>
      ) : (
        <Text style={styles.meta}>
          No location on this report — your photos still help · {takenAgo}
        </Text>
      )}

      {contextParts.length > 0 ? (
        <Text style={styles.confirmLine}>{contextParts.join(' · ')}</Text>
      ) : null}
      {confirmedMarks.length > 0 ? (
        <Text style={styles.confirmLine}>
          You saw: {confirmedMarks.map((mark) => mark.description).join(' · ')}
        </Text>
      ) : null}
      {answers.note?.trim() ? <Text style={styles.confirmLine}>{answers.note.trim()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  quiet: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  subheading: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  revealBlock: {
    marginTop: spacing.lg,
  },
  markRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.sm,
  },
  markRowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  markLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  safetyInline: {
    // Safety copy is the one place we are firm and unmissable — never the
    // quietest style on the screen.
    ...typography.label,
    color: colors.textPrimary,
  },
  call999: {
    minHeight: sizes.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    // Danger is the sanctioned colour for the emergency path — this is the
    // one screen where it is not decoration.
    backgroundColor: colors.danger,
  },
  call999Pressed: {
    backgroundColor: colors.dangerPressed,
  },
  call999Label: {
    ...typography.label,
    color: colors.textOnPrimary,
  },
  cameraModal: {
    flex: 1,
    backgroundColor: colors.background,
    // 24px screen padding (DESIGN_SYSTEM Spacing) — the 16px exception is
    // scoped to image-led FEED surfaces, which this is not.
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  cameraBody: {
    // The viewfinder takes every point the Done button doesn't need.
    flex: 1,
  },
  confirmPhotos: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmPhoto: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radii.md,
  },
  confirmMap: {
    height: sizes.mapConfirmPreview,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  pin: {
    width: sizes.mapPinConfirm,
    height: sizes.mapPinConfirm,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderWidth: sizes.mapPinRing,
    borderColor: colors.surface,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  confirmLine: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
