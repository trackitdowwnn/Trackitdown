/**
 * WHAT:  PhotoGridPicker — Airbnb-listing-style photo grid: a full-width
 *        cover tile over a two-column grid, gallery multi-select with a
 *        secondary camera add, long-press drag-to-reorder (plus a ⋯ sheet
 *        with Make cover / Move / Remove for the no-drag path), a how-to card
 *        at the top of the step (which photo is the cover; press and hold to
 *        move one — the two things a tile can't show), tap-to-preview full
 *        screen, an optional dismissible tips card, and a configurable
 *        min/max. Loading is
 *        visible end to end: "Adding photo(s)…" on the add tile while the
 *        picker hands the picks back, then a spinner on each placeholder
 *        while it is resized. A second SOURCE mode, `source="capture"`,
 *        turns it into the evidence-review grid: a uniform two-column grid
 *        (no cover concept, no reorder — capture order is the order), whose
 *        add tile fires `onRequestCapture` (the consumer opens its camera)
 *        and whose only gallery path is NONE.
 * WHY:   Owners add EXISTING photos of their stolen car — the car is gone, so
 *        gallery multi-select is deliberately the primary path there. Spotter
 *        EVIDENCE is the opposite: photos exist only via the in-app camera
 *        (docs/DOMAIN.md sighting rules, ADR-0003), so capture mode contains
 *        no gallery code path at all — the grid is generic over the photo
 *        type (T extends GridPhoto) so evidence bundles (GPS + timestamp)
 *        ride through add/remove untouched, and removing a tile removes the
 *        WHOLE evidence unit. The ordered value is the post's public image
 *        list and index 0 becomes the VehicleCard cover, so ordering
 *        operations live in photoGridModel.ts where tests pin the
 *        cover-at-0 invariant. The component SELECTS only — it never uploads
 *        — but each tile accepts a status overlay (uploading / error +
 *        retry) so the same grid can be reused during submission. Gallery
 *        picks are resized to ~2000px longest edge (upload weight only).
 *        EXIF is NOT this file's job and NOT stripped server-side: the
 *        upload's re-encode (src/shared/api/photoUpload.ts) strips it on
 *        the device — a convention, not a boundary; see the open gap in
 *        docs/SECURITY_AND_TRUST.md. `source` is fixed for a mount: the
 *        capture-mode guards read it per tap, so switching it mid-pick is
 *        unsupported.
 *        Consumer today: the vehicle PhotosStep (min 3 / max 6), which the
 *        posting wizard, Edit photos and the garage all mount. The
 *        single-photo mode (max 1 — cover chrome hides; built for a V5C
 *        upload) and capture mode (built for sighting evidence) are
 *        implemented and tested but have no live consumer: the sighting
 *        flow has its own camera step.
 * LINKS: src/shared/ui/photoGridModel.ts (ordering/geometry maths + schema);
 *        src/shared/ui/AppImage.tsx, BottomSheet.tsx, PhotoPreviewModal.tsx
 *        (composed); src/shared/wizard/types.ts (photoListSchema gates Next);
 *        src/features/vehicles/post/components/postSteps.tsx (PhotosStep,
 *        the consumer); docs/DESIGN_SYSTEM.md; docs/DOMAIN.md.
 *
 * Usage (gallery, the default):
 *   <PhotoGridPicker
 *     photos={answers.photos ?? []}
 *     onChangePhotos={(photos) => setAnswers({ photos })}
 *     minPhotos={3}
 *     maxPhotos={6}
 *     tipsVisible={!tipsDismissed}
 *     onDismissTips={() => setTipsDismissed(true)}
 *   />
 *
 * Usage (capture — evidence review):
 *   <PhotoGridPicker<EvidencePhoto>
 *     source="capture"
 *     onRequestCapture={() => setCameraOpen(true)}
 *     photos={answers.photos ?? []}
 *     onChangePhotos={(photos) => setAnswers({ photos })}
 *     minPhotos={1}
 *     maxPhotos={3}
 *   />
 */

/* eslint-disable react-hooks/immutability -- Reanimated SharedValues are
   mutable-by-design boxes written from gesture worklets and handlers; the
   compiler's immutability model doesn't apply to them. Components below opt
   out of the React Compiler ('use no memo') for the same reason. */

import { Feather } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AccessibilityActionEvent,
  AccessibilityInfo,
  ActivityIndicator,
  type LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  motion,
  opacity,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';
import { easeOut } from '@/shared/theme/motionEasing';
import { AppImage } from './AppImage';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';
import {
  displayIndexDuringDrag,
  gridCellForIndex,
  gridHeightForSlots,
  gridSlotForPoint,
  type GridPhoto,
  makeCover,
  mergePhotos,
  movePhoto,
  type PickedPhoto,
  remainingSlots,
  remainingToMin,
  removalNeedsConfirm,
  removePhoto,
  resizeTargetFor,
  tileAccessibilityLabel,
} from './photoGridModel';
import { PhotoPreviewModal } from './PhotoPreviewModal';

export { type GridPhoto, photoListSchema, type PickedPhoto } from './photoGridModel';

/** Overlay state a consumer can pin on a tile while it works on the photo. */
export type PhotoTileStatus =
  | { kind: 'uploading'; progress?: number } // progress 0–1; omitted = indeterminate
  | { kind: 'error' }
  /**
   * This ONE tile is being worked on — the consumer supplies the words, so the
   * grid stays ignorant of why. Used by the garage to show which photo a plate
   * scan is currently reading; the label is the caller's because "looking for a
   * number plate" is a garage sentence and this component must not learn it.
   */
  | { kind: 'busy'; label: string };

/** The step-specific copy slots, so second consumers (V5C, profile) reword
 *  the user-facing story. Generic operational strings (sheet actions, upload
 *  status) stay fixed until a consumer needs them varied. */
export interface PhotoGridCopy {
  /** Optional tips card body; the card hides when tips is undefined (the
   *  owner step's default has none). */
  tips?: string;
  coverPill: string;
  /** First line of the how-to card at the top of the step (gallery mode),
   *  shown from the start — so it explains the cover before there is one. */
  coverHint: string;
  /** Second line of that card: how to reorder. Hidden when undefined. */
  reorderHint?: string;
  addLabel: string;
  /** The add tile's label while a picker hands several picks back… */
  addingLabel: string;
  /** …and while it hands back one (the camera, or one slot left). */
  addingOneLabel: string;
  /** Sub-line on the add tile while below the minimum. */
  addMore: (remaining: number) => string;
  /** Optional sub-line once the minimum is met but slots remain ("Up to 2
   *  more") — the capture flow's remaining-count copy. Hidden when unset. */
  addRemaining?: (remaining: number) => string;
  cameraLabel: string;
  permissionTitle: string;
  permissionBody: string;
  permissionAction: string;
  /** Cover-removal confirm (only ever shown when another photo remains). */
  removeCoverConfirmBody: string;
  removeCoverConfirmAction: string;
  removeCoverConfirmCancel: string;
}

/** The posting wizard photo step's wording (docs/DOMAIN.md: owner photos). */
export const defaultOwnerPhotoCopy: PhotoGridCopy = {
  // No tips card (owner's call, 2026-10-07): the step leads with the how-to
  // card instead — the two things the grid itself can't show.
  coverPill: 'Cover photo',
  // Shown before any photo exists, so it names the cover rather than
  // pointing at one ("This is…" pointed at nothing above an empty grid).
  coverHint: 'Your first photo is the cover — spotters see it first.',
  reorderHint: 'Press and hold a photo to move it.',
  addLabel: 'Add photos',
  addingLabel: 'Adding photos…',
  addingOneLabel: 'Adding photo…',
  addMore: (remaining) => `Add at least ${remaining} more`,
  cameraLabel: 'Take a photo instead',
  permissionTitle: 'Allow photo access',
  permissionBody:
    'To add photos of your car we need access to your photo library. You can allow this in Settings.',
  permissionAction: 'Open settings',
  removeCoverConfirmBody:
    'The next photo becomes your cover — the first photo spotters will see.',
  removeCoverConfirmAction: 'Remove photo',
  removeCoverConfirmCancel: 'Keep it',
};

export interface PhotoGridPickerProps<T extends GridPhoto = PickedPhoto> {
  /** Controlled, ordered list; index 0 is the cover (gallery mode). */
  photos: T[];
  /** Fires once per completed operation (a picked batch arrives together). */
  onChangePhotos: (photos: T[]) => void;
  minPhotos: number;
  maxPhotos: number;
  /** Where photos come from. 'gallery' (default): the add tile multi-selects
   *  from the photo library, with a secondary in-picker camera. 'capture':
   *  the add tile fires onRequestCapture and the CONSUMER owns the camera —
   *  // SAFETY: no gallery path exists in capture mode (DOMAIN.md sighting
   *  rules / ADR-0003: evidence photos are live in-app captures only). The
   *  grid is uniform (no cover) and order is fixed to capture order. */
  source?: 'gallery' | 'capture';
  /** Capture mode's add-tile action — open the consumer's camera. */
  onRequestCapture?: () => void;
  /** Overrides merged over defaultOwnerPhotoCopy. */
  copy?: Partial<PhotoGridCopy>;
  /** Consumer-controlled tips dismissal; card shows while true (default). */
  tipsVisible?: boolean;
  onDismissTips?: () => void;
  /** Per-tile upload overlays, keyed by photo uri. Wiring is the consumer's. */
  status?: Record<string, PhotoTileStatus>;
  /** Retry tap on a tile whose status is an error. */
  onRetry?: (photo: T) => void;
  /** Secondary "take a photo" path (spare keys, documents). Default true;
   *  gallery mode only. */
  allowCamera?: boolean;
  disabled?: boolean;
  testID?: string;
  /**
   * The width the grid will most likely have, for its FIRST frame (2026-10-08).
   * The grid can't place tiles until it is measured, so it used to render 0
   * high and then pop its photos in a frame later — on a wizard step, in the
   * middle of the slide. A width remembered from an earlier mount wins over
   * this; the real measurement always corrects both.
   */
  estimatedWidth?: number;
}

/** A photo on the device (picked or captured), not one downloaded. */
function isLocalUri(uri: string): boolean {
  return /^(file|ph|content|assets-library):/.test(uri);
}

/** The last measured grid width, for the next mount's first frame. */
let lastGridWidth = 0;

/** Test-only: forget the remembered width. */
export function resetPhotoGridWidthMemory(): void {
  lastGridWidth = 0;
}

/** Grid gap between tiles. */
const GAP = spacing.sm;
/** Longest edge after processing — upload weight, NOT privacy (see header). */
const PROCESS_MAX_EDGE = 2000;
/** JPEG quality for processed photos. */
const PROCESS_COMPRESS = 0.85;

export function PhotoGridPicker<T extends GridPhoto = PickedPhoto>({
  photos,
  onChangePhotos,
  minPhotos,
  maxPhotos,
  source = 'gallery',
  onRequestCapture,
  copy: copyOverrides,
  tipsVisible = true,
  onDismissTips,
  status,
  onRetry,
  allowCamera = true,
  disabled = false,
  testID,
  estimatedWidth = 0,
}: PhotoGridPickerProps<T>) {
  // React Compiler opt-out: shared values are mutated from gesture worklets.
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const copy = useMemo(
    () => ({ ...defaultOwnerPhotoCopy, ...copyOverrides }),
    [copyOverrides],
  );
  const reduceMotion = useReducedMotion();
  // Capture mode: no cover concept (uniform grid), no reorder (capture order
  // is the order), no gallery/camera-in-picker paths. coverRow is kept a
  // SEPARATE flag (though today always !captureMode) because uniform-grid
  // gallery consumers are plausible later; geometry keys off coverRow,
  // policy keys off captureMode.
  const captureMode = source === 'capture';
  const coverRow = !captureMode;

  // A caller that knows its layout wins; the remembered width is the fallback.
  const [gridWidth, setGridWidth] = useState(() => estimatedWidth || lastGridWidth);
  const gridWidthSv = useSharedValue(estimatedWidth || lastGridWidth);
  // Index being dragged (-1 = none) and the slot it currently hovers.
  const dragFrom = useSharedValue(-1);
  const dragOver = useSharedValue(-1);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const [pendingCount, setPendingCount] = useState(0);
  // A picker is open or handing its photos back: 'one' or 'many' (the add
  // tile's wording), null otherwise. On Android the library copies (and, for
  // cloud photos, downloads) every pick before its promise settles — seconds,
  // for several photos — and the add tile is what answers in that gap.
  const [awaitingPicker, setAwaitingPicker] = useState<'one' | 'many' | null>(null);
  // One picker at a time, from the FIRST tap. Synchronous on purpose: the
  // tile's `disabled` only lands on the next commit, and the permission round
  // trip before a launch is a window two quick taps could both get through.
  const pickingRef = useRef(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // The ⋯ sheet and the preview both track their photo by URI, not index —
  // photos can reorder or shrink while either is open (e.g. upload status
  // driving the consumer), and acting on a stale index would hit the wrong
  // photo.
  const [menuUri, setMenuUri] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const sheetRef = useRef<BottomSheetRef>(null);
  const menuIndex = menuUri === null ? null : photos.findIndex((p) => p.uri === menuUri);

  // Latest values for async pipelines (picking + processing outlive renders).
  const photosRef = useRef(photos);
  const onChangePhotosRef = useRef(onChangePhotos);
  useEffect(() => {
    photosRef.current = photos;
    onChangePhotosRef.current = onChangePhotos;
  });

  const count = photos.length;
  const remaining = remainingSlots(count + pendingCount, maxPhotos);
  const showAddTile = remaining > 0 && !permissionDenied;
  const slotCount = count + pendingCount + (showAddTile ? 1 : 0);
  const singlePhotoMode = maxPhotos === 1;
  const awaiting = awaitingPicker !== null;
  const addingLabel = awaitingPicker === 'one' ? copy.addingOneLabel : copy.addingLabel;

  // Announce count changes so non-visual users hear progress toward the min.
  const previousCount = useRef(count);
  useEffect(() => {
    if (previousCount.current === count) {
      return;
    }
    previousCount.current = count;
    const need = remainingToMin(count, minPhotos);
    const message =
      `${count} ${count === 1 ? 'photo' : 'photos'} added.` +
      (need > 0 ? ` ${copy.addMore(need)}.` : '');
    AccessibilityInfo.announceForAccessibility(message);
  }, [count, minPhotos, copy]);

  const handleGridLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    lastGridWidth = width;
    setGridWidth(width);
    gridWidthSv.value = width;
  };

  // ---- Selection & processing -------------------------------------------

  const processAsset = async (asset: PickedPhoto): Promise<PickedPhoto> => {
    try {
      const target = resizeTargetFor(asset.width, asset.height, PROCESS_MAX_EDGE);
      if (!target) {
        return asset;
      }
      const context = ImageManipulator.manipulate(asset.uri);
      context.resize(target);
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: PROCESS_COMPRESS,
        format: SaveFormat.JPEG,
      });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    } catch {
      // Resize is an upload optimisation — never block a photo on it.
      return asset;
    }
  };

  // Pending is additive (ref = source of truth): a gallery pick can overlap a
  // slow camera ingest, and each batch must reserve its own slots.
  const pendingRef = useRef(0);
  const bumpPending = (delta: number) => {
    pendingRef.current = Math.max(0, pendingRef.current + delta);
    setPendingCount(pendingRef.current);
  };

  const ingest = async (assets: PickedPhoto[]) => {
    // SAFETY: structural guard, not just call-site discipline — gallery
    // ingestion must be unreachable in capture mode (evidence photos exist
    // only via the consumer's camera; DOMAIN sighting rules / ADR-0003).
    if (captureMode) {
      return;
    }
    const cap = remainingSlots(photosRef.current.length + pendingRef.current, maxPhotos);
    const capped = assets.slice(0, cap);
    if (capped.length === 0) {
      return;
    }
    // ⚠️ Before the first await: the add handlers clear their waiting state
    // just before calling ingest, in the same synchronous run, so the pending
    // tiles replace the "Adding" tile in one render — an await above this
    // line would bring back a frame showing neither.
    bumpPending(capped.length);
    try {
      // Gallery ingestion runs ONLY in source='gallery', where T is
      // PickedPhoto in practice (capture consumers add photos exclusively
      // through onRequestCapture) — hence the cast.
      const processed = (await Promise.all(capped.map(processAsset))) as unknown as T[];
      onChangePhotosRef.current(mergePhotos(photosRef.current, processed, maxPhotos));
    } finally {
      bumpPending(-capped.length);
    }
  };

  /** A permission answer; a request that THROWS (an OEM quirk) reads as "not
   *  granted, may ask again" — no inline settings card for a failure we
   *  can't explain, and nothing escapes the tap as an unhandled rejection. */
  const askPermission = async (
    request: () => Promise<{ granted: boolean; canAskAgain: boolean }>,
  ): Promise<{ granted: boolean; canAskAgain: boolean }> => {
    try {
      return await request();
    } catch {
      return { granted: false, canAskAgain: true };
    }
  };

  /** A picker's photos, or null for a cancel or a failure. A picker that
   *  throws (an OEM quirk, a permission revoked mid-flight) has picked
   *  nothing — swallowed here rather than escaping the tap as an unhandled
   *  rejection. */
  const launchForAssets = async (
    launch: () => Promise<ImagePicker.ImagePickerResult>,
  ): Promise<PickedPhoto[] | null> => {
    try {
      const result = await launch();
      return result.canceled || !result.assets?.length ? null : result.assets;
    } catch {
      return null;
    }
  };

  const addFromLibrary = async () => {
    if (disabled || captureMode || pickingRef.current) {
      return; // SAFETY: no gallery path in capture mode, by construction
    }
    pickingRef.current = true;
    let assets: PickedPhoto[] | null = null;
    try {
      const permission = await askPermission(ImagePicker.requestMediaLibraryPermissionsAsync);
      if (!permission.granted) {
        // canAskAgain: the system dialog just handled it — stay quiet. Once
        // the OS stops asking, surface the inline settings path instead.
        if (!permission.canAskAgain) {
          setPermissionDenied(true);
        }
        return;
      }
      setPermissionDenied(false); // iOS limited access counts as granted
      const limit = remainingSlots(photosRef.current.length + pendingRef.current, maxPhotos);
      setAwaitingPicker(limit > 1 ? 'many' : 'one');
      assets = await launchForAssets(() =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsMultipleSelection: limit > 1,
          selectionLimit: limit,
          quality: 1,
          exif: false,
        }),
      );
    } finally {
      pickingRef.current = false;
      setAwaitingPicker(null);
    }
    if (assets) {
      await ingest(assets); // same synchronous run as the clear above
    }
  };

  const addFromCamera = async () => {
    if (disabled || captureMode || pickingRef.current) {
      return; // SAFETY: capture mode's camera is the consumer's, never this
    }
    pickingRef.current = true;
    let assets: PickedPhoto[] | null = null;
    try {
      const permission = await askPermission(ImagePicker.requestCameraPermissionsAsync);
      if (!permission.granted) {
        return; // secondary path — no inline state, the gallery remains primary
      }
      setAwaitingPicker('one');
      assets = await launchForAssets(() =>
        ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1,
          exif: false,
        }),
      );
    } finally {
      pickingRef.current = false;
      setAwaitingPicker(null);
    }
    if (assets) {
      await ingest(assets); // same synchronous run as the clear above
    }
  };

  // ---- Reordering ---------------------------------------------------------

  const commitMove = useCallback(
    (from: number, to: number) => {
      onChangePhotosRef.current(movePhoto(photosRef.current, from, to));
    },
    [],
  );

  // ---- Tile actions (⋯ sheet AND accessibility actions) -------------------

  const openMenu = (index: number) => {
    setMenuUri(photos[index]?.uri ?? null);
    setConfirmingRemove(false);
    sheetRef.current?.open();
  };

  const closeMenu = () => {
    sheetRef.current?.close();
  };

  type TileAction = 'preview' | 'cover' | 'up' | 'down' | 'remove';

  /** Runs an action against the CURRENT position of a photo. Returns true
   *  when the action completed (false = a confirm step took over). */
  const performAction = (index: number, action: TileAction): boolean => {
    if (index < 0 || index >= photos.length) {
      return true; // the photo is gone — nothing to act on
    }
    // SAFETY: capture order is the evidence order — reordering/cover actions
    // are structurally inert in capture mode even if invoked directly.
    if (captureMode && action !== 'preview' && action !== 'remove') {
      return true;
    }
    if (action === 'preview') {
      setPreviewUri(photos[index].uri);
      return true;
    }
    if (action === 'remove') {
      // The cover-removal confirm exists only where a cover exists — capture
      // mode removes directly (the grid IS the review surface).
      if (!captureMode && removalNeedsConfirm(index, count)) {
        setMenuUri(photos[index].uri);
        setConfirmingRemove(true); // sheet (re)opens on the confirm
        sheetRef.current?.open();
        return false;
      }
      onChangePhotos(removePhoto(photos, index));
      return true;
    }
    if (action === 'cover') {
      onChangePhotos(makeCover(photos, index));
    } else {
      onChangePhotos(movePhoto(photos, index, action === 'up' ? index - 1 : index + 1));
    }
    return true;
  };

  const menuAction = (action: TileAction) => {
    if (menuIndex === null || menuIndex < 0) {
      closeMenu();
      return;
    }
    if (performAction(menuIndex, action)) {
      closeMenu();
    }
  };

  const confirmRemoveCover = () => {
    if (menuIndex !== null && menuIndex >= 0) {
      onChangePhotos(removePhoto(photos, menuIndex));
    }
    closeMenu();
  };

  // ---- Static cells for the non-photo tiles (JS side, no animation) ------

  const cellFor = (slot: number) => {
    const cell = gridCellForIndex(slot, gridWidth, GAP, coverRow);
    return { left: cell.x, top: cell.y, width: cell.width, height: cell.height };
  };

  const gridHeight = gridWidth > 0 ? gridHeightForSlots(slotCount, gridWidth, GAP, coverRow) : 0;
  const needMore = remainingToMin(count, minPhotos);
  const previewIndex = previewUri === null ? -1 : photos.findIndex((p) => p.uri === previewUri);

  return (
    <View style={[styles.container, disabled && styles.disabled]} testID={testID}>
      {copy.tips && tipsVisible ? (
        <View style={styles.tipsCard}>
          <Text style={styles.tipsText}>{copy.tips}</Text>
          {onDismissTips ? (
            <Pressable
              onPress={onDismissTips}
              disabled={disabled}
              hitSlop={spacing.md}
              accessibilityRole="button"
              accessibilityLabel="Dismiss tips"
              testID={testID ? `${testID}-dismiss-tips` : undefined}
            >
              <Feather name="x" size={typography.body.lineHeight} color={palette.textSecondary} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* THE HOW-TO CARD, at the top and from the start: the two things the
          grid itself can't show — which photo is the cover, and that a long
          press moves a photo. Body text in textPrimary on a surfaceSubtle
          card (owner's call, 2026-10-07: these were caption-grey lines under
          the grid that people missed). Always present in gallery mode, so
          adding photos never moves anything under the finger. */}
      {/* Not when photo access is refused with nothing added: the settings
          card below is the one thing to read then. */}
      {!singlePhotoMode && !captureMode && !(permissionDenied && count === 0) ? (
        <View style={styles.hints} testID={testID ? `${testID}-hints` : undefined}>
          <View style={styles.hintRow}>
            {/* An eye — "what spotters see" — not a star, which on its own
                reads as "favourite". Decorative: the sentence says it all. */}
            <Feather
              name="eye"
              size={sizes.iconSm}
              color={palette.textPrimary}
              style={styles.hintIcon}
              accessible={false}
              importantForAccessibility="no"
            />
            <Text style={styles.hintText}>{copy.coverHint}</Text>
          </View>
          {copy.reorderHint ? (
            // Drag-to-reorder needs a long press first, which nothing on a
            // tile shows. Hidden from screen readers: each tile's own hint
            // gives THEIR gesture ("double-tap and hold") and the Move
            // actions, and "press and hold" would be wrong for them.
            <View
              style={styles.hintRow}
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              testID={testID ? `${testID}-reorder-hint` : undefined}
            >
              <Feather name="move" size={sizes.iconSm} color={palette.textPrimary} style={styles.hintIcon} />
              <Text style={styles.hintText}>{copy.reorderHint}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View
        style={[styles.grid, { height: gridHeight }]}
        onLayout={handleGridLayout}
        testID={testID ? `${testID}-grid` : undefined}
      >
        {gridWidth > 0
          ? photos.map((photo, index) => (
              <GridTile
                key={photo.uri}
                photo={photo}
                index={index}
                count={count}
                gridWidthSv={gridWidthSv}
                dragFrom={dragFrom}
                dragOver={dragOver}
                dragX={dragX}
                dragY={dragY}
                reduceMotion={reduceMotion}
                disabled={disabled}
                captureMode={captureMode}
                coverRow={coverRow}
                showCoverChrome={!singlePhotoMode && !captureMode}
                coverPill={copy.coverPill}
                status={status?.[photo.uri]}
                // SAFETY(cast): GridTile only ever calls onRetry with an
                // entry from THIS photos: T[] list (never a synthesized
                // GridPhoto), so widening the parameter is runtime-safe.
                onRetry={onRetry as ((photo: GridPhoto) => void) | undefined}
                onCommitMove={commitMove}
                onOpenMenu={openMenu}
                onTileAction={performAction}
                testID={testID ? `${testID}-photo-${index}` : undefined}
              />
            ))
          : null}

        {gridWidth > 0
          ? Array.from({ length: pendingCount }, (_, n) => (
              <View
                key={`pending-${n}`}
                style={[styles.tile, styles.pendingTile, cellFor(count + n)]}
                accessible
                accessibilityLabel="Processing photo"
                accessibilityState={{ busy: true }}
                testID={testID ? `${testID}-pending-${n}` : undefined}
              >
                <ProcessingShimmer reduceMotion={reduceMotion} />
                {/* The pulse alone read as an empty grey tile, not as work in
                    progress (and is still under reduced motion), so a small
                    spinner sits on it — the sanctioned exception to "no
                    spinners on lists" (DESIGN_SYSTEM, Loading: an item being
                    processed). Decorative: the tile's label says
                    "Processing". */}
                <View style={styles.pendingSpinner}>
                  <ActivityIndicator
                    size="small"
                    color={palette.textSecondary}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                    testID={testID ? `${testID}-pending-${n}-spinner` : undefined}
                  />
                </View>
              </View>
            ))
          : null}

        {gridWidth > 0 && showAddTile ? (
          <Pressable
            style={[styles.tile, styles.addTile, cellFor(count + pendingCount)]}
            // Capture mode NEVER opens the library — the consumer's camera is
            // the only way in (DOMAIN.md sighting rules / ADR-0003).
            onPress={captureMode ? onRequestCapture : addFromLibrary}
            // Disabled while a pick is arriving so the tile LOOKS and reads
            // busy; the real one-picker guard is pickingRef, which also
            // covers the taps before this re-render lands.
            disabled={disabled || awaiting}
            accessibilityRole="button"
            accessibilityState={awaiting ? { busy: true, disabled: true } : undefined}
            accessibilityLabel={
              awaiting
                ? addingLabel
                : needMore > 0
                  ? `${copy.addLabel}. ${copy.addMore(needMore)}`
                  : copy.addRemaining
                    ? // Screen-reader users get the same remaining-capacity line
                      // sighted users see on the tile.
                      `${copy.addLabel}. ${copy.addRemaining(remaining)}`
                    : copy.addLabel
            }
            testID={testID ? `${testID}-add` : undefined}
          >
            {awaiting ? (
              // The tile they just tapped answers them: the photos are on
              // their way, even though no placeholder can show yet (we don't
              // know how many until the picker hands them over).
              <>
                <ActivityIndicator
                  size="small"
                  color={palette.textSecondary}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                  testID={testID ? `${testID}-add-spinner` : undefined}
                />
                <Text style={styles.addLabel}>{addingLabel}</Text>
              </>
            ) : (
              <>
                {/* textPrimary: the how-to card above is body ink, and the
                    action must still outweigh the instructions. */}
                <Feather name="plus" size={typography.title.lineHeight} color={palette.textPrimary} />
                <Text style={styles.addLabel}>{copy.addLabel}</Text>
                {needMore > 0 ? <Text style={styles.addMore}>{copy.addMore(needMore)}</Text> : null}
                {needMore === 0 && copy.addRemaining ? (
                  <Text style={styles.addMore}>{copy.addRemaining(remaining)}</Text>
                ) : null}
              </>
            )}
          </Pressable>
        ) : null}
      </View>

      {allowCamera && !captureMode && remaining > 0 && !permissionDenied ? (
        <Pressable
          style={({ pressed }) => [
            styles.cameraRow,
            pressed && styles.cameraRowPressed,
            // Disabled while a picker is out — and LOOKS it, or it reads as a
            // link that has stopped working.
            // Not on top of a consumer's `disabled`: the container already
            // dims, and the two multiplied fall below legible contrast.
            awaiting && !disabled && styles.cameraRowBusy,
          ]}
          onPress={addFromCamera}
          disabled={disabled || awaiting}
          accessibilityRole="button"
          accessibilityLabel={copy.cameraLabel}
          testID={testID ? `${testID}-camera` : undefined}
        >
          <Feather name="camera" size={typography.body.lineHeight} color={palette.primary} />
          <Text style={styles.cameraLabel}>{copy.cameraLabel}</Text>
        </Pressable>
      ) : null}

      {permissionDenied ? (
        <View style={styles.permissionCard} testID={testID ? `${testID}-permission` : undefined}>
          <Text style={styles.permissionTitle}>{copy.permissionTitle}</Text>
          <Text style={styles.permissionBody}>{copy.permissionBody}</Text>
          <Button
            label={copy.permissionAction}
            variant="ghost"
            fullWidth={false}
            onPress={() => {
              Linking.openSettings().catch(() => {
                // Settings unavailable (odd OEM builds) — nothing sensible to do.
              });
            }}
          />
        </View>
      ) : null}

      <BottomSheet
        ref={sheetRef}
        title={
          menuIndex !== null && menuIndex >= 0
            ? tileAccessibilityLabel(menuIndex, count, !singlePhotoMode)
            : undefined
        }
        onDismiss={() => {
          setMenuUri(null);
          setConfirmingRemove(false);
        }}
      >
        {confirmingRemove ? (
          <View style={styles.confirm}>
            <Text style={styles.confirmBody}>{copy.removeCoverConfirmBody}</Text>
            <Button
              label={copy.removeCoverConfirmAction}
              variant="danger"
              onPress={confirmRemoveCover}
            />
            <Button
              label={copy.removeCoverConfirmCancel}
              variant="ghost"
              onPress={() => setConfirmingRemove(false)}
            />
          </View>
        ) : (
          <View>
            <SheetAction icon="maximize" label="Preview" onPress={() => menuAction('preview')} />
            {!captureMode && menuIndex !== null && menuIndex > 0 ? (
              <SheetAction icon="star" label="Make cover photo" onPress={() => menuAction('cover')} />
            ) : null}
            {!captureMode && menuIndex !== null && menuIndex > 0 ? (
              <SheetAction icon="arrow-up" label="Move up" onPress={() => menuAction('up')} />
            ) : null}
            {!captureMode && menuIndex !== null && menuIndex >= 0 && menuIndex < count - 1 ? (
              <SheetAction icon="arrow-down" label="Move down" onPress={() => menuAction('down')} />
            ) : null}
            <SheetAction
              icon="trash-2"
              label="Remove"
              destructive
              onPress={() => menuAction('remove')}
            />
          </View>
        )}
      </BottomSheet>

      {/* previewIndex goes -1 if the photo vanishes while open (consumer
          shrinks the list) — the modal closes itself via the null uri. */}
      <PhotoPreviewModal
        uri={previewIndex >= 0 ? previewUri : null}
        label={previewIndex >= 0 ? `Photo ${previewIndex + 1} of ${count}` : undefined}
        onClose={() => setPreviewUri(null)}
      />
    </View>
  );
}

// ---- Tiles ----------------------------------------------------------------

interface GridTileProps {
  photo: GridPhoto;
  index: number;
  count: number;
  gridWidthSv: SharedValue<number>;
  dragFrom: SharedValue<number>;
  dragOver: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  reduceMotion: boolean;
  disabled: boolean;
  /** Evidence-review mode: no drag reorder, uniform geometry. */
  captureMode: boolean;
  /** Whether slot 0 is the full-width cover row (gallery mode). */
  coverRow: boolean;
  showCoverChrome: boolean;
  coverPill: string;
  status?: PhotoTileStatus;
  onRetry?: (photo: GridPhoto) => void;
  onCommitMove: (from: number, to: number) => void;
  onOpenMenu: (index: number) => void;
  onTileAction: (index: number, action: 'preview' | 'cover' | 'up' | 'down' | 'remove') => boolean;
  testID?: string;
}

function GridTile({
  photo,
  index,
  count,
  gridWidthSv,
  dragFrom,
  dragOver,
  dragX,
  dragY,
  reduceMotion,
  disabled,
  captureMode,
  coverRow,
  showCoverChrome,
  coverPill,
  status,
  onRetry,
  onCommitMove,
  onOpenMenu,
  onTileAction,
  testID,
}: GridTileProps) {
  // React Compiler opt-out: shared values are mutated from gesture worklets.
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const settleMs = reduceMotion ? 0 : motion.fast;

  // Whether THIS tile owns the in-flight drag: with one detector per tile, a
  // second finger could start a second pan; only the first may drive the
  // shared drag state, or commits/cleanup corrupt each other.
  const ownsDrag = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Capture mode never reorders: capture order IS the evidence order.
        .enabled(!disabled && count > 1 && !captureMode)
        .activateAfterLongPress(motion.longPress)
        .onStart(() => {
          if (dragFrom.value !== -1) {
            return; // another tile is already being dragged
          }
          ownsDrag.value = true;
          dragFrom.value = index;
          dragOver.value = index;
          dragX.value = 0;
          dragY.value = 0;
        })
        .onUpdate((event) => {
          if (!ownsDrag.value) {
            return;
          }
          dragX.value = event.translationX;
          dragY.value = event.translationY;
          const cell = gridCellForIndex(index, gridWidthSv.value, GAP, coverRow);
          dragOver.value = gridSlotForPoint(
            cell.x + cell.width / 2 + event.translationX,
            cell.y + cell.height / 2 + event.translationY,
            count,
            gridWidthSv.value,
            GAP,
            coverRow,
          );
        })
        .onEnd(() => {
          if (ownsDrag.value && dragOver.value !== dragFrom.value) {
            scheduleOnRN(onCommitMove, dragFrom.value, dragOver.value);
          }
        })
        .onFinalize(() => {
          if (!ownsDrag.value) {
            return;
          }
          ownsDrag.value = false;
          dragFrom.value = -1;
          dragOver.value = -1;
        }),
    [
      disabled,
      count,
      captureMode,
      coverRow,
      index,
      onCommitMove,
      ownsDrag,
      dragFrom,
      dragOver,
      dragX,
      dragY,
      gridWidthSv,
    ],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const width = gridWidthSv.value;
    if (width <= 0) {
      return { opacity: 0 };
    }
    const timing = { duration: settleMs, easing: easeOut };
    if (dragFrom.value === index) {
      // The lifted tile rides the finger from its rest cell.
      const cell = gridCellForIndex(index, width, GAP, coverRow);
      return {
        opacity: 1,
        left: cell.x + dragX.value,
        top: cell.y + dragY.value,
        width: cell.width,
        height: cell.height,
        zIndex: 2,
        transform: [{ scale: withTiming(motion.liftScale, timing) }],
        ...shadows.lifted,
      };
    }
    // Everyone else glides to wherever the in-flight order says they sit.
    const display = displayIndexDuringDrag(index, dragFrom.value, dragOver.value);
    const cell = gridCellForIndex(display, width, GAP, coverRow);
    return {
      opacity: 1,
      left: withTiming(cell.x, timing),
      top: withTiming(cell.y, timing),
      width: withTiming(cell.width, timing),
      height: withTiming(cell.height, timing),
      zIndex: 1,
      transform: [{ scale: withTiming(1, timing) }],
      ...shadows.soft,
    };
  });

  const canDrag = !disabled && count > 1 && !captureMode;
  // The tile is one accessibility element (children are flattened), so every
  // per-photo operation is exposed as an accessibility action here — this is
  // ALSO the no-drag reorder path for switch/screen-reader users.
  const accessibilityActions = [
    { name: 'previewPhoto', label: 'Preview' },
    ...(!captureMode && index > 0
      ? [
          { name: 'makeCover', label: 'Make cover photo' },
          { name: 'moveUp', label: 'Move up' },
        ]
      : []),
    ...(!captureMode && index < count - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []),
    { name: 'removePhoto', label: 'Remove' },
  ];
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) {
      return;
    }
    const map: Record<string, 'preview' | 'cover' | 'up' | 'down' | 'remove'> = {
      previewPhoto: 'preview',
      makeCover: 'cover',
      moveUp: 'up',
      moveDown: 'down',
      removePhoto: 'remove',
    };
    const action = map[event.nativeEvent.actionName];
    if (action) {
      onTileAction(index, action);
    }
  };
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.tile, animatedStyle]}
        accessible
        // The tile is ONE accessibility element and flattens its children, so
        // the status overlay's own text reaches nobody — it has to be folded
        // into this label, and the tile has to report that it is busy. Without
        // this a screen-reader user is told "Photo 2 of 3" while the tile says
        // "Upload failed".
        accessibilityLabel={[
          tileAccessibilityLabel(index, count, showCoverChrome),
          statusAccessibilityLabel(status),
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityState={status ? { busy: status.kind !== 'error' } : undefined}
        accessibilityHint={
          canDrag
            ? 'Double-tap to preview. Double-tap and hold, then drag to reorder. Reorder and remove are also available as actions.'
            : 'Double-tap to preview. Remove is available as an action.'
        }
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
        testID={testID}
      >
        {/* Tap = preview (never destructive); the pan above needs a long
            press first, so plain taps always reach this Pressable. */}
        <Pressable
          style={styles.tileContent}
          onPress={() => onTileAction(index, 'preview')}
          disabled={disabled}
          accessible={false}
          testID={testID ? `${testID}-preview` : undefined}
        >
          {/* No fade for a local file — a picked photo is already here, and a
              fade is just a flash each time the tile mounts. A REMOTE photo
              (the post editor's uploaded ones) keeps the usual fade. */}
          <AppImage
            uri={photo.uri}
            style={styles.tileImage}
            transition={isLocalUri(photo.uri) ? 0 : undefined}
          />

          {index === 0 && showCoverChrome ? (
            <View style={styles.coverPillWrap}>
              <Text style={styles.coverPillText}>{coverPill}</Text>
            </View>
          ) : null}

          {status ? (
            <View style={styles.statusOverlay}>
              {status.kind === 'busy' ? (
                // Spinner and words each get their OWN pill, for the same
                // reason the text does: a bare white spinner vanishes against a
                // photo of a white car, which is exactly the shot this appears
                // on. Mark centred, words directly beneath it.
                <>
                  <View style={styles.statusPill}>
                    <ActivityIndicator
                      size="small"
                      color={palette.textOnMedia}
                      // Decorative — the tile's own label carries the status.
                      importantForAccessibility="no"
                      accessibilityElementsHidden
                    />
                  </View>
                  <View style={[styles.statusPill, styles.statusPillWide]}>
                    {/* Wraps to two lines on a half-width tile; capped so a
                        long label or large Dynamic Type cannot outgrow it. */}
                    <Text style={styles.statusText} numberOfLines={2}>
                      {status.label}
                    </Text>
                  </View>
                </>
              ) : status.kind === 'uploading' ? (
                // Solid pill, not text on the scrim: the photo beneath is
                // arbitrary, so the scrim alone can't guarantee AA contrast.
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>
                    {status.progress !== undefined
                      ? `Uploading ${Math.round(status.progress * 100)}%`
                      : 'Uploading…'}
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusText}>Upload failed</Text>
                  </View>
                  {onRetry ? (
                    <Pressable
                      style={styles.retryButton}
                      onPress={() => onRetry(photo)}
                      accessibilityRole="button"
                      accessibilityLabel={`Retry uploading photo ${index + 1}`}
                      testID={testID ? `${testID}-retry` : undefined}
                    >
                      <View style={styles.statusPill}>
                        <Text style={[styles.statusText, styles.statusAction]}>Retry</Text>
                      </View>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          ) : null}
        </Pressable>

        <Pressable
          style={styles.menuButton}
          onPress={() => onOpenMenu(index)}
          disabled={disabled}
          hitSlop={spacing.sm}
          accessibilityRole="button"
          accessibilityLabel={`More options for photo ${index + 1}`}
          testID={testID ? `${testID}-menu` : undefined}
        >
          <Feather
            name="more-horizontal"
            size={typography.body.lineHeight}
            color={palette.textPrimary}
          />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * What a tile's status should ADD to its spoken label. Null when there is
 * nothing to say, so the label is left exactly as it was.
 */
function statusAccessibilityLabel(status?: PhotoTileStatus): string | null {
  if (!status) {
    return null;
  }
  if (status.kind === 'busy') {
    return status.label;
  }
  if (status.kind === 'error') {
    return 'Upload failed';
  }
  return status.progress !== undefined
    ? `Uploading ${Math.round(status.progress * 100)} percent`
    : 'Uploading';
}

/** Calm skeleton pulse while a picked photo is resized off the UI thread. */
function ProcessingShimmer({ reduceMotion }: { reduceMotion: boolean }) {
  'use no memo';
  const styles = useThemedStyles(makeStyles);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    pulse.value = withRepeat(
      withTiming(opacity.inactive, { duration: motion.loaderLoop / 2 }),
      -1,
      true,
    );
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.shimmerFill, style]} />;
}

function SheetAction({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <Pressable
      style={({ pressed }) => [styles.sheetAction, pressed && styles.sheetActionPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon}
        size={typography.body.lineHeight}
        color={destructive ? palette.danger : palette.textPrimary}
      />
      <Text style={[styles.sheetActionLabel, destructive && styles.sheetActionDestructive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      gap: spacing.md,
    },
    disabled: {
      opacity: opacity.disabled,
    },
    tipsCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
    },
    tipsText: {
      ...typography.caption,
      color: c.textSecondary,
      flex: 1,
    },
    grid: {
      width: '100%',
    },
    tile: {
      position: 'absolute',
      borderRadius: radii.lg,
    },
    tileContent: {
      flex: 1,
      borderRadius: radii.lg,
      overflow: 'hidden', // clip the image; the shadow lives on the outer view
      backgroundColor: c.surfaceSubtle,
    },
    tileImage: {
      width: '100%',
      height: '100%',
    },
    coverPillWrap: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.sm,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    coverPillText: {
      ...typography.caption,
      color: c.textPrimary,
    },
    menuButton: {
      position: 'absolute',
      // spacing.sm inset keeps the whole hitSlop inside the tile bounds (RN
      // clamps touch areas to the parent), preserving the full 48pt target.
      top: spacing.sm,
      right: spacing.sm,
      width: sizes.touchTarget - spacing.md, // pill-sized; hitSlop restores 44pt
      height: sizes.touchTarget - spacing.md,
      borderRadius: (sizes.touchTarget - spacing.md) / 2,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.soft,
    },
    pendingTile: {
      borderRadius: radii.lg,
      overflow: 'hidden',
    },
    shimmerFill: {
      flex: 1,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
    },
    pendingSpinner: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addTile: {
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
    },
    addLabel: {
      ...typography.label,
      color: c.textPrimary,
    },
    addMore: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // The how-to card: the tips card's quiet surface, but body-size text in
    // textPrimary, because these lines are instructions, not decoration.
    hints: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
      // md, not sm: a wrapped first line must not run into the second.
      gap: spacing.md,
    },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    // Centres the small icon on the FIRST line of body text, so it stays put
    // when a line wraps (and follows the tokens if either size changes).
    hintIcon: {
      marginTop: (typography.body.lineHeight - sizes.iconSm) / 2,
    },
    hintText: {
      ...typography.body,
      color: c.textPrimary,
      flex: 1,
      // Android's asymmetric font padding would sit the text off the icon.
      includeFontPadding: false,
    },
    cameraRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      minHeight: sizes.touchTarget,
      borderRadius: radii.md,
    },
    cameraRowPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    cameraRowBusy: {
      opacity: opacity.disabled,
    },
    cameraLabel: {
      ...typography.label,
      color: c.primary,
    },
    permissionCard: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    permissionTitle: {
      ...typography.heading,
      color: c.textPrimary,
    },
    permissionBody: {
      ...typography.body,
      color: c.textSecondary,
    },
    statusOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // mediaScrim, not overlay (2026-08-10). This sits on a PHOTO, and
      // `overlay` now means "scrim over the page" and deepens to 0.65 on dark —
      // which over a photo just buries it. The media tokens are identical in
      // both palettes precisely because a photo is as bright either way.
      backgroundColor: c.mediaScrim,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    statusPill: {
      // surfaceOverMedia, not textPrimary: an ink token used as a fill flips to
      // near-WHITE on dark, putting a white pill on a photo. It also made the
      // spinner beside it (textOnPrimary → #141414) invisible on the scrim.
      backgroundColor: c.surfaceOverMedia,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    statusText: {
      ...typography.label,
      color: c.textOnMedia,
      textAlign: 'center',
    },
    // Leaves a margin inside the tile so a wrapped label never runs to the edges.
    statusPillWide: {
      maxWidth: '86%',
    },
    statusAction: {
      textDecorationLine: 'underline',
    },
    retryButton: {
      minHeight: sizes.touchTarget,
      justifyContent: 'center',
    },
    confirm: {
      gap: spacing.md,
    },
    confirmBody: {
      ...typography.body,
      color: c.textSecondary,
    },
    sheetAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: sizes.touchTarget,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    sheetActionPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    sheetActionLabel: {
      ...typography.body,
      color: c.textPrimary,
    },
    sheetActionDestructive: {
      color: c.danger,
    },
  });
