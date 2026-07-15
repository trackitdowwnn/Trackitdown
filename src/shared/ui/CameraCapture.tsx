/**
 * WHAT:  CameraCapture — the in-app evidence camera: a viewfinder with a big
 *        shutter, a thumbnail strip of taken shots (tap to remove/retake),
 *        and a photo counter. Every capture atomically bundles the photo
 *        with a device timestamp and, when location permission is already
 *        granted, a best-effort GPS fix + accuracy — the "evidence result".
 * WHY:   Sightings (and later recovery/dispute evidence) must be taken
 *        in-app. // SAFETY: no gallery path exists in this component BY
 *        DESIGN (DOMAIN.md sighting rules — gallery uploads enable
 *        fabricated sightings); do not add one. ADR-0003's supplementary
 *        gallery photos, when built, live BESIDE this component in the
 *        photo-step UI — never inside it. The GPS fix is captured at
 *        the shutter moment so photo/place/time cannot be mixed from
 *        different moments; a failed or missing fix produces an UN-located
 *        evidence photo (never a blocked shutter, never a fabricated point).
 *        Camera permission is handled inside (primer → request → settings);
 *        LOCATION permission is the consumer's to prime — this component
 *        only reads the current grant.
 * LINKS: src/shared/ui/PermissionPrimer.tsx; src/features/sightings (first
 *        consumer); docs/DOMAIN.md (Sighting rules); docs/DESIGN_SYSTEM.md.
 */

import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, opacity, radii, shadows, sizes, spacing, typography } from '../theme';
import { AppImage } from './AppImage';
import { PermissionPrimer } from './PermissionPrimer';

/** One captured evidence photo: the image plus its capture-moment facts.
 *  lat/lng/accuracyM are all present or all absent — a located photo is
 *  located by its OWN fix, never a borrowed one. */
export interface EvidencePhoto {
  uri: string;
  /** Pixel dimensions from the camera (present on real captures) — lets the
   *  upload pipeline bound the long edge without re-reading the file. */
  width?: number;
  height?: number;
  /** ISO timestamp taken at the shutter moment (device clock). */
  capturedAt: string;
  lat?: number;
  lng?: number;
  /** GPS accuracy radius in metres, recorded as reported — poor accuracy is
   *  data, not a rejection reason. */
  accuracyM?: number;
}

export interface CameraCaptureProps {
  /** Controlled list of captured evidence photos. */
  photos: EvidencePhoto[];
  onChange: (photos: EvidencePhoto[]) => void;
  maxPhotos: number;
  /** Copy shown while the camera permission primer is up. */
  primerBody?: string;
}

/** How long to wait for a GPS fix at the shutter before shipping the photo
 *  un-located (the shutter must stay fast — the spotter may be walking away). */
const FIX_TIMEOUT_MS = 4000;

/** Best-effort fix: current position raced against a timeout, falling back to
 *  a recent last-known position. Null = un-located (an honest outcome). */
async function captureFix(): Promise<{ lat: number; lng: number; accuracyM?: number } | null> {
  try {
    const { granted } = await Location.getForegroundPermissionsAsync();
    if (!granted) return null;
    const position = await Promise.race([
      // A failed live fix resolves null (not rejects) so the last-known
      // fallback below still runs.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    const fix = position ?? (await Location.getLastKnownPositionAsync({ maxAge: 60_000 }));
    if (!fix) return null;
    return {
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracyM: fix.coords.accuracy ?? undefined,
    };
  } catch {
    return null;
  }
}

export function CameraCapture({ photos, onChange, maxPhotos, primerBody }: CameraCaptureProps) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);

  // Permission not yet resolved — render nothing rather than flash a primer.
  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <View style={styles.root}>
        <PermissionPrimer
          icon={<Feather name="camera" size={sizes.icon} color={colors.textPrimary} />}
          title="Allow the camera"
          body={
            primerBody ??
            'Photos are taken in the app so each one carries where and when it was taken.'
          }
          primaryLabel={blocked ? 'Open settings' : 'Allow camera'}
          onPrimary={() => {
            if (blocked) {
              void Linking.openSettings();
            } else {
              void requestPermission();
            }
          }}
        />
      </View>
    );
  }

  const full = photos.length >= maxPhotos;

  const onShutter = async () => {
    const camera = cameraRef.current;
    if (!camera || capturing || full) return;
    setCapturing(true);
    try {
      // Timestamp + photo + fix all belong to THIS shutter press.
      const capturedAt = new Date().toISOString();
      const [picture, fix] = await Promise.all([
        camera.takePictureAsync({ quality: 0.7 }),
        captureFix(),
      ]);
      if (picture?.uri) {
        onChange([
          ...photos,
          {
            uri: picture.uri,
            width: picture.width,
            height: picture.height,
            capturedAt,
            ...(fix ?? {}),
          },
        ]);
      }
    } catch {
      // A failed capture is silent — the viewfinder simply stays live.
    } finally {
      setCapturing(false);
    }
  };

  const removeAt = (index: number) => {
    onChange(photos.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.root}>
      <View style={styles.viewfinder}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
        <View style={styles.counter} pointerEvents="none">
          <Text style={styles.counterText}>
            {photos.length} / {maxPhotos}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.thumbStrip}>
          {photos.map((photo, index) => (
            <Pressable
              key={photo.uri}
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${index + 1}`}
              onPress={() => removeAt(index)}
              style={styles.thumb}
            >
              <AppImage uri={photo.uri} style={styles.thumbImage} />
              <View style={styles.thumbRemove}>
                <Feather name="x" size={sizes.iconSm} color={colors.textOnPrimary} />
              </View>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={full ? 'Photo limit reached' : 'Take photo'}
          disabled={capturing || full}
          onPress={() => void onShutter()}
          style={({ pressed }) => [
            styles.shutter,
            (pressed || capturing) && styles.shutterPressed,
            full && styles.shutterDisabled,
          ]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </View>
  );
}

const SHUTTER_SIZE = 72;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  viewfinder: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceInverse,
  },
  counter: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  counterText: {
    ...typography.caption,
    color: colors.textOnPrimary,
  },
  controls: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  thumbStrip: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: sizes.avatarMd,
  },
  thumb: {
    width: sizes.avatarMd,
    height: sizes.avatarMd,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbRemove: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: colors.overlay,
    borderBottomLeftRadius: radii.sm,
    padding: spacing.xs,
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: radii.full,
    borderWidth: sizes.grabberHeight,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lifted,
  },
  shutterInner: {
    width: SHUTTER_SIZE - 16,
    height: SHUTTER_SIZE - 16,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
  },
  shutterPressed: {
    opacity: opacity.disabled,
  },
  shutterDisabled: {
    opacity: opacity.disabled,
  },
});
