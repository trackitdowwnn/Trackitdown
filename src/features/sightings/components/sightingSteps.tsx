/**
 * WHAT:  The four report-sighting wizard step components: the safety gate
 *        (SafetyNotice hero + Call 999), the evidence camera (CameraCapture
 *        with a location primer), the optional context step (chips + note),
 *        and the confirm step (photos, captured-point map, time, context).
 * WHY:   Speed-flow screens: big targets, minimal reading, nothing optional
 *        standing between the spotter and Send. SAFETY decisions live here:
 *        the camera is the ONLY photo source (no gallery — DOMAIN sighting
 *        rules), the confirm map is display-only (the CAPTURED point is the
 *        evidence — no manual editing, ever), and a missing GPS fix never
 *        blocks the flow (an un-located report is still valuable).
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the config);
 *        src/shared/ui (CameraCapture, PermissionPrimer, SafetyNotice,
 *        ChoiceChipsMulti, TextField, AppMap); docs/DOMAIN.md.
 */

import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import { createLogger } from '@/shared/lib/logger';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  CameraCapture,
  ChoiceChipsMulti,
  PermissionPrimer,
  SafetyNotice,
  TextField,
} from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';
import type { WizardStepProps } from '@/shared/wizard';

import { firstLocatedPhoto } from '../lib/areaLabel';
import {
  MAX_NOTE_LENGTH,
  MAX_SIGHTING_PHOTOS,
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
 *  report is simply un-located. The camera itself owns camera permission. */
export function PhotosStep({ answers, setAnswers }: StepProps) {
  const [locationReady, setLocationReady] = useState<boolean | null>(null);

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
    <View style={styles.cameraWrap}>
      <CameraCapture
        photos={answers.photos ?? []}
        onChange={(photos) => setAnswers({ photos })}
        maxPhotos={MAX_SIGHTING_PHOTOS}
        primerBody="Photos are taken here in the app so each one carries where and when it was taken — that’s what makes your report count."
      />
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
  cameraWrap: {
    // The camera needs real height inside the wizard's scroll content.
    height: 460,
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
