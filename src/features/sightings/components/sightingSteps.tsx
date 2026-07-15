/**
 * WHAT:  The four report-sighting wizard step components: the safety gate
 *        (SafetyNotice hero + Call 999), the evidence step (camera-first
 *        full-screen capture over a PhotoGridPicker review grid), the
 *        optional context step (chips + note), and the confirm step
 *        (photos, captured-point map, time, context).
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
 *        src/shared/ui (CameraCapture, PhotoGridPicker, PermissionPrimer,
 *        SafetyNotice, ChoiceChipsMulti, TextField, AppMap); docs/DOMAIN.md;
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTimeAgo } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  Button,
  CameraCapture,
  ChoiceChipsMulti,
  type EvidencePhoto,
  PermissionPrimer,
  PhotoGridPicker,
  SafetyNotice,
  TextField,
} from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';
import type { WizardStepProps } from '@/shared/wizard';

import { firstLocatedPhoto } from '../lib/areaLabel';
import {
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
  MIN_SIGHTING_PHOTOS,
  type ReportSightingAnswers,
  type SightingContextFlag,
} from '../types';

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
        icon={<Feather name="map-pin" size={sizes.icon} color={colors.textPrimary} />}
        title="Add where you are"
        body="Each photo can carry the spot it was taken — the strongest lead you can give the owner."
        primaryLabel="Allow location"
        onPrimary={() => {
          void Location.requestForegroundPermissionsAsync().then(({ granted }) => {
            log.info('location_permission', { granted });
            setLocationReady(true);
          });
        }}
        secondaryLabel="Continue without location"
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
              primerBody="Photos are taken here in the app so each one carries where and when it was taken — that’s what makes your report count."
            />
          </View>
          <Button label="Done" onPress={() => setCameraOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

// --- 3 · Context (all optional) --------------------------------------------------

const CONTEXT_OPTIONS: { value: SightingContextFlag; label: string }[] = [
  { value: 'parked', label: 'Parked' },
  { value: 'driving', label: 'Driving' },
  { value: 'people_nearby', label: 'People nearby' },
  { value: 'plate_changed', label: 'Plate changed or missing' },
];

export function ContextStep({ answers, setAnswers }: StepProps) {
  return (
    <View style={styles.stack}>
      <ChoiceChipsMulti
        options={CONTEXT_OPTIONS}
        value={answers.contextFlags ?? []}
        onChange={(contextFlags) => setAnswers({ contextFlags })}
      />
      <TextField
        label="Anything else? (optional)"
        value={answers.note ?? ''}
        onChangeText={(note) => setAnswers({ note })}
        helperText="Direction, what you noticed — a line is plenty."
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
  const flags = answers.contextFlags ?? [];
  const flagLabels = CONTEXT_OPTIONS.filter((option) => flags.includes(option.value)).map(
    (option) => option.label,
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
          No location on this report — your photos still help. · {takenAgo}
        </Text>
      )}

      {flagLabels.length > 0 ? <Text style={styles.confirmLine}>{flagLabels.join(' · ')}</Text> : null}
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
    height: 160,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSubtle,
  },
  pin: {
    width: 16,
    height: 16,
    borderRadius: radii.full,
    backgroundColor: colors.primary,
    borderWidth: 2,
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
