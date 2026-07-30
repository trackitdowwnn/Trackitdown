/**
 * WHAT:  The four report-sighting wizard step components (2026-07-30
 *        rebuild): the safety gate (SafetyNotice hero + Call 999), the
 *        camera-AS-the-step photos step (in-place viewfinder, no modal, the
 *        ADR-0003 gallery button beside the shutter), the optional context
 *        step (state tap-cards whose parked/driving follow-up opens a
 *        BottomSheet, everything else — condition/marks/people option rows +
 *        note — behind one "Add more detail" expander, prominent Skip), and
 *        the confirm step (photo grid with Library badges, captured-point
 *        map, time, the full context summary).
 * WHY:   Speed-flow screens: big targets, minimal reading, nothing optional
 *        standing between the spotter and Send — one question at first
 *        glance, the follow-up in the thumb zone, the drawer for the rest.
 *        SAFETY decisions live here: ≥1 LIVE in-app capture is required
 *        (gallery photos are supplementary, labelled, and never
 *        location-bearing — ADR-0003, re-enforced by the RPC), removing a
 *        photo removes its WHOLE evidence unit, the confirm map is
 *        display-only (the CAPTURED point is the evidence — no manual
 *        editing, ever), and a missing GPS fix never blocks the flow (an
 *        un-located report is still valuable).
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the config);
 *        src/features/sightings/components/CompassPicker.tsx;
 *        src/features/sightings/lib/contextLabels.ts (the shared vocabulary);
 *        src/shared/ui (CameraCapture, PhotoGridPicker, PermissionPrimer,
 *        SafetyNotice, ChoiceChips, ChoiceChipsMulti, TextField, AppMap);
 *        docs/DOMAIN.md (Sighting rules — structured context);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { CarFront, SquareParking, Truck } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { useTimeAgo } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import { colors, motion, opacity, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  BottomSheet,
  type BottomSheetRef,
  CameraCapture,
  CardSelect,
  type CardSelectOption,
  type EvidencePhoto,
  PermissionPrimer,
  type PermissionPrimerContent,
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
            <Feather name="image" size={sizes.icon} color={colors.textPrimary} />
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

// --- 3 · Context (all optional) --------------------------------------------------

/** The three mutually exclusive vehicle STATES — big tap-cards (the rebuild's
 *  one-glance question; storage stays the shared context_flags array). */
const STATE_CARDS: CardSelectOption<VehicleStateFlag>[] = [
  { value: 'parked', label: 'Parked', description: 'Sitting unattended', icon: SquareParking },
  { value: 'driving', label: 'Driving', description: 'On the move right now', icon: CarFront },
  {
    value: 'being_loaded',
    label: 'Being loaded or towed',
    description: 'On or going onto another vehicle',
    icon: Truck,
  },
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

/** The step's ONE option grammar (the pills read as clutter at this density):
 *  a full-width row with a leading indicator — SQUARE check = pick many,
 *  CIRCLE check = pick one — matching the marks rows, so every group in the
 *  drawer shares an aligned left edge and a calm vertical rhythm. */
function OptionRow({
  label,
  kind,
  selected,
  onPress,
  testID,
}: {
  label: string;
  kind: 'single' | 'multi';
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const iconName =
    kind === 'multi'
      ? selected
        ? 'check-square'
        : 'square'
      : selected
        ? 'check-circle'
        : 'circle';
  return (
    <Pressable
      accessibilityRole={kind === 'multi' ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.markRow, pressed && styles.markRowPressed]}
      testID={testID}
    >
      <Feather
        name={iconName}
        size={sizes.iconSm}
        color={selected ? colors.primary : colors.textSecondary}
      />
      <Text style={styles.markLabel}>{label}</Text>
    </Pressable>
  );
}

export function ContextStep({ answers, setAnswers, onSkip }: StepProps) {
  const flags = answers.contextFlags ?? [];
  const state = VEHICLE_STATE_FLAGS.find((flag) => flags.includes(flag)) ?? null;
  const conditions = flags.filter((flag): flag is ConditionFlag =>
    (CONDITION_FLAGS as readonly string[]).includes(flag),
  );
  const marks = answers.confirmableFeatures ?? [];
  const confirmedIds = answers.confirmedFeatureIds ?? [];
  // The rebuild's lightness move: ONE question at first glance; everything
  // else waits behind "Add more detail". Auto-open when detail already
  // exists (returning to the step must show what was said).
  const [more, setMore] = useState(
    conditions.length > 0 ||
      confirmedIds.length > 0 ||
      answers.peoplePresence !== undefined ||
      Boolean(answers.note?.trim()),
  );

  // The follow-up SHEET: tapping Parked or Driving slides its one follow-up
  // question up from the thumb zone; picking auto-dismisses, swiping away
  // answers nothing (everything stays optional). The chosen answer then
  // lives as a quiet editable row under the cards.
  const sheetRef = useRef<BottomSheetRef>(null);
  const [sheetFor, setSheetFor] = useState<'parked' | 'driving' | null>(null);
  const openFollowUp = (which: 'parked' | 'driving') => {
    setSheetFor(which);
    sheetRef.current?.open();
  };

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
    if (cleared === 'parked' || cleared === 'driving') openFollowUp(cleared);
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
      {/* The PROMINENT skip — everything here is optional, and the flow's
          job is speed. The wizard's onSkip advances without the Next gate. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip this step"
        onPress={onSkip}
        style={styles.skipRow}
        hitSlop={spacing.sm}
      >
        <Text style={styles.skipLabel}>Skip</Text>
        <Feather name="arrow-right" size={sizes.iconSm} color={colors.textPrimary} />
      </Pressable>

      <View>
        <Text style={styles.subheading}>What’s it doing?</Text>
        <CardSelect
          options={STATE_CARDS}
          value={state}
          onSelect={selectState}
        />
        {state === 'parked' || state === 'driving' ? (
          <Reveal>
            {/* The follow-up's ANSWER, editable — the question itself lives
                in the sheet that opened when the card was tapped. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                state === 'parked'
                  ? `Likely to stay: ${
                      answers.parkedLikelihood
                        ? (PARKED_LIKELIHOOD_OPTIONS.find(
                            (option) => option.value === answers.parkedLikelihood,
                          )?.label ?? '')
                        : 'not answered'
                    }. Opens options.`
                  : `Heading: ${answers.direction ?? 'not answered'}. Opens the compass.`
              }
              onPress={() => openFollowUp(state)}
              style={({ pressed }) => [styles.followUpRow, pressed && styles.moreRowPressed]}
              testID="follow-up-row"
            >
              <Text style={styles.followUpLabel}>
                {state === 'parked' ? 'Likely to stay?' : 'Which way was it heading?'}
              </Text>
              <View style={styles.followUpValueWrap}>
                <Text
                  style={[
                    styles.followUpValue,
                    !(state === 'parked' ? answers.parkedLikelihood : answers.direction) &&
                      styles.followUpValueEmpty,
                  ]}
                >
                  {state === 'parked'
                    ? (PARKED_LIKELIHOOD_OPTIONS.find(
                        (option) => option.value === answers.parkedLikelihood,
                      )?.label ?? 'Add')
                    : (answers.direction ?? 'Add')}
                </Text>
                <Feather name="chevron-right" size={sizes.iconSm} color={colors.textSecondary} />
              </View>
            </Pressable>
          </Reveal>
        ) : null}
      </View>

      {/* Everything else, one quiet door. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={more ? 'Hide extra detail' : 'Add more detail'}
        accessibilityState={{ expanded: more }}
        onPress={() => setMore((current) => !current)}
        style={({ pressed }) => [styles.moreRow, pressed && styles.moreRowPressed]}
      >
        <Text style={styles.moreLabel}>Add more detail</Text>
        <Feather
          name={more ? 'chevron-up' : 'chevron-down'}
          size={sizes.iconSm}
          color={colors.textSecondary}
        />
      </Pressable>

      {more ? (
        <Reveal>
          <View style={styles.moreBody}>
            <View>
              <Text style={styles.subheading}>Condition at a glance</Text>
              {CONDITION_OPTIONS.map((option) => (
                <OptionRow
                  key={option.value}
                  kind="multi"
                  label={option.label}
                  selected={conditions.includes(option.value)}
                  onPress={() =>
                    setAnswers({
                      contextFlags: [
                        ...(state ? [state] : []),
                        ...(conditions.includes(option.value)
                          ? conditions.filter((flag) => flag !== option.value)
                          : [...conditions, option.value]),
                      ],
                    })
                  }
                />
              ))}
            </View>

            {marks.length > 0 ? (
              <View>
                <Text style={styles.subheading}>Could you see…?</Text>
                {marks.map((mark) => (
                  <OptionRow
                    key={mark.id}
                    kind="multi"
                    label={mark.description}
                    selected={confirmedIds.includes(mark.id)}
                    onPress={() => toggleMark(mark.id)}
                    testID={`confirm-mark-${mark.id}`}
                  />
                ))}
              </View>
            ) : null}

            <View>
              <Text style={styles.subheading}>Anyone around?</Text>
              {PEOPLE_OPTIONS.map((option) => (
                <OptionRow
                  key={option.value}
                  kind="single"
                  label={option.label}
                  selected={answers.peoplePresence === option.value}
                  onPress={() =>
                    setAnswers({
                      peoplePresence:
                        option.value === answers.peoplePresence ? undefined : option.value,
                    })
                  }
                />
              ))}
              {answers.peoplePresence === 'nearby' || answers.peoplePresence === 'in_vehicle' ? (
                <Reveal>
                  {/* SAFETY: fixed copy, not a prop — the register reinforces
                      the gate's rule exactly where the temptation to linger
                      lives. Firm and unmissable, announced on reveal. */}
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
        </Reveal>
      ) : null}

      {/* The follow-up sheet: one focused question in the thumb zone.
          Picking dismisses; swiping away answers nothing (all optional). */}
      <BottomSheet
        ref={sheetRef}
        title={sheetFor === 'parked' ? 'Likely to stay?' : 'Which way was it heading?'}
      >
        <View style={styles.sheetBody}>
          {sheetFor === 'parked' ? (
            <View>
              {PARKED_LIKELIHOOD_OPTIONS.map((option) => (
                <OptionRow
                  key={option.value}
                  kind="single"
                  label={option.label}
                  selected={answers.parkedLikelihood === option.value}
                  onPress={() => {
                    setAnswers({
                      parkedLikelihood:
                        option.value === answers.parkedLikelihood ? undefined : option.value,
                    });
                    sheetRef.current?.close();
                  }}
                />
              ))}
            </View>
          ) : (
            <CompassPicker
              value={answers.direction}
              onChange={(direction) => {
                setAnswers({ direction });
                if (direction !== undefined) sheetRef.current?.close();
              }}
            />
          )}
          <Text style={styles.quiet}>Not sure? Just swipe this away — it’s optional.</Text>
        </View>
      </BottomSheet>
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
      {/* The grid treatment, as review: what's being sent, provenance shown
          honestly (a library photo is never presented as a live capture). */}
      <View style={styles.confirmPhotos}>
        {photos.map((photo) => (
          <View key={photo.uri} style={styles.confirmPhotoCell}>
            <AppImage uri={photo.uri} style={styles.confirmPhoto} />
            {photo.source === 'gallery' ? (
              <View style={styles.confirmPhotoBadge}>
                <Feather name="image" size={sizes.iconSm} color={colors.textOnPrimary} />
                <Text style={styles.confirmPhotoBadgeText}>Library</Text>
              </View>
            ) : null}
          </View>
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
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryButtonPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  galleryButtonDisabled: {
    opacity: opacity.disabled,
  },
  skipRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizes.touchTarget,
  },
  skipLabel: {
    ...typography.label,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  moreRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
  },
  moreRowPressed: {
    backgroundColor: colors.surfaceSubtlePressed,
  },
  moreLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  moreBody: {
    gap: spacing.xl,
  },
  followUpRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSubtle,
  },
  followUpLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  followUpValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  followUpValue: {
    ...typography.label,
    color: colors.textPrimary,
  },
  followUpValueEmpty: {
    color: colors.textSecondary,
  },
  sheetBody: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  confirmPhotos: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  confirmPhotoCell: {
    flex: 1,
  },
  confirmPhoto: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.md,
  },
  confirmPhotoBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.overlay,
    borderTopRightRadius: radii.sm,
    borderBottomLeftRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  confirmPhotoBadgeText: {
    ...typography.caption,
    color: colors.textOnPrimary,
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
