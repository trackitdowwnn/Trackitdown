/**
 * WHAT:  The report-sighting wizard's photos step (2026-07-30 rebuild; the
 *        safety gate moved out to ReportSafetySheet on 2026-09-30, shown
 *        before the flow opens): the camera-AS-the-step (in-place
 *        viewfinder, no modal, the ADR-0003 gallery button beside the
 *        shutter). The optional context questions, one per step since
 *        2026-10-20, are contextSteps.tsx; "Check and send" is
 *        ConfirmStep.tsx.
 * WHY:   Speed-flow screens: big targets, minimal reading, nothing optional
 *        standing between the spotter and Send.
 *        SAFETY decisions live here: ≥1 LIVE in-app capture is required
 *        (gallery photos are supplementary, labelled, and never
 *        location-bearing — ADR-0003, re-enforced by the RPC), removing a
 *        photo removes its WHOLE evidence unit, and a missing GPS fix never
 *        blocks the flow (an un-located report is still valuable). The
 *        display-only confirm map's SAFETY note moved with it.
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the config);
 *        src/features/sightings/components/contextSteps.tsx (the context);
 *        src/features/sightings/components/ConfirmStep.tsx (the last step);
 *        src/shared/ui (CameraCapture, PermissionPrimer);
 *        src/features/sightings/components/ReportSafetySheet.tsx (the gate);
 *        docs/decisions/ADR-0003-gallery-supplementary-evidence.md.
 */

import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { createLogger } from '@/shared/lib/logger';
import {
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
  CameraCapture,
  type EvidencePhoto,
  PermissionPrimer,
  type PermissionPrimerContent,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { MAX_SIGHTING_PHOTOS, type ReportSightingAnswers } from '../types';

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

const makeStyles = (c: Palette) => StyleSheet.create({
  quiet: {
    ...typography.caption,
    color: c.textSecondary,
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
});
