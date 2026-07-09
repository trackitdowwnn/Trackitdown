/**
 * WHAT:  PhotoGridPicker — Airbnb-listing-style photo selection grid: a
 *        full-width cover tile over a two-column grid, gallery multi-select
 *        with a secondary camera add, long-press drag-to-reorder (plus a ⋯
 *        sheet with Make cover / Move / Remove for the no-drag path), a
 *        dismissible tips card, and a configurable min/max.
 * WHY:   Owners add EXISTING photos of their stolen car — the car is gone, so
 *        gallery multi-select is deliberately the primary path (unlike
 *        sighting capture, which is in-app camera only; docs/DOMAIN.md). The
 *        ordered value is the post's public image list and index 0 becomes
 *        the VehicleCard cover, so ordering operations live in
 *        photoGridModel.ts where tests pin the cover-at-0 invariant. The
 *        component SELECTS only — it never uploads (the posting feature
 *        uploads on submit) — but each tile accepts a status overlay
 *        (uploading progress / error + retry) so the same grid can be reused
 *        during submission. Selected photos are resized to ~2000px longest
 *        edge (upload weight only — EXIF is stripped server-side per
 *        docs/SECURITY_AND_TRUST.md, client resize is size not privacy;
 *        resize failure keeps the original, never blocks). Consumers:
 *        posting wizard photo step (min 3 / max 6), V5C verification upload
 *        (min 1 / max 1 — cover chrome hides), future profile photos.
 * LINKS: src/shared/ui/photoGridModel.ts (ordering/geometry maths + schema);
 *        src/shared/ui/AppImage.tsx, BottomSheet.tsx (composed);
 *        src/shared/wizard/types.ts (photoListSchema gates Next);
 *        docs/DESIGN_SYSTEM.md; docs/DOMAIN.md; docs/SECURITY_AND_TRUST.md.
 *
 * Usage:
 *   <PhotoGridPicker
 *     photos={answers.photos ?? []}
 *     onChangePhotos={(photos) => setAnswers({ photos })}
 *     minPhotos={3}
 *     maxPhotos={6}
 *     tipsVisible={!tipsDismissed}
 *     onDismissTips={() => setTipsDismissed(true)}
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
  type LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { colors, motion, opacity, radii, shadows, sizes, spacing, typography } from '../theme';
import { AppImage } from './AppImage';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';
import {
  displayIndexDuringDrag,
  gridCellForIndex,
  gridHeightForSlots,
  gridSlotForPoint,
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

export { photoListSchema, type PickedPhoto } from './photoGridModel';

/** Overlay state a consumer can pin on a tile while it uploads the photo. */
export type PhotoTileStatus =
  | { kind: 'uploading'; progress?: number } // progress 0–1; omitted = indeterminate
  | { kind: 'error' };

/** The step-specific copy slots, so second consumers (V5C, profile) reword
 *  the user-facing story. Generic operational strings (sheet actions, upload
 *  status) stay fixed until a consumer needs them varied. */
export interface PhotoGridCopy {
  /** Tips card body; the card hides when tips is undefined. */
  tips?: string;
  coverPill: string;
  coverHint: string;
  addLabel: string;
  /** Sub-line on the add tile while below the minimum. */
  addMore: (remaining: number) => string;
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
  tips: 'Clear photos help spotters recognise your car — include the plate if you have a shot of it, plus any dents, stickers or unique details.',
  coverPill: 'Cover photo',
  coverHint: 'This is the first photo spotters will see.',
  addLabel: 'Add photos',
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

export interface PhotoGridPickerProps {
  /** Controlled, ordered list; index 0 is the cover. */
  photos: PickedPhoto[];
  /** Fires once per completed operation (a picked batch arrives together). */
  onChangePhotos: (photos: PickedPhoto[]) => void;
  minPhotos: number;
  maxPhotos: number;
  /** Overrides merged over defaultOwnerPhotoCopy. */
  copy?: Partial<PhotoGridCopy>;
  /** Consumer-controlled tips dismissal; card shows while true (default). */
  tipsVisible?: boolean;
  onDismissTips?: () => void;
  /** Per-tile upload overlays, keyed by photo uri. Wiring is the consumer's. */
  status?: Record<string, PhotoTileStatus>;
  /** Retry tap on a tile whose status is an error. */
  onRetry?: (photo: PickedPhoto) => void;
  /** Secondary "take a photo" path (spare keys, documents). Default true. */
  allowCamera?: boolean;
  disabled?: boolean;
  testID?: string;
}

/** Grid gap between tiles. */
const GAP = spacing.sm;
/** Longest edge after processing — upload weight, NOT privacy (see header). */
const PROCESS_MAX_EDGE = 2000;
/** JPEG quality for processed photos. */
const PROCESS_COMPRESS = 0.85;

export function PhotoGridPicker({
  photos,
  onChangePhotos,
  minPhotos,
  maxPhotos,
  copy: copyOverrides,
  tipsVisible = true,
  onDismissTips,
  status,
  onRetry,
  allowCamera = true,
  disabled = false,
  testID,
}: PhotoGridPickerProps) {
  // React Compiler opt-out: shared values are mutated from gesture worklets.
  'use no memo';
  const copy = useMemo(
    () => ({ ...defaultOwnerPhotoCopy, ...copyOverrides }),
    [copyOverrides],
  );
  const reduceMotion = useReducedMotion();

  const [gridWidth, setGridWidth] = useState(0);
  const gridWidthSv = useSharedValue(0);
  // Index being dragged (-1 = none) and the slot it currently hovers.
  const dragFrom = useSharedValue(-1);
  const dragOver = useSharedValue(-1);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const [pendingCount, setPendingCount] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // The ⋯ sheet tracks its photo by URI, not index — photos can reorder or
  // shrink while the sheet is open (e.g. upload status driving the consumer),
  // and acting on a stale index would hit the wrong photo.
  const [menuUri, setMenuUri] = useState<string | null>(null);
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
    const cap = remainingSlots(photosRef.current.length + pendingRef.current, maxPhotos);
    const capped = assets.slice(0, cap);
    if (capped.length === 0) {
      return;
    }
    bumpPending(capped.length);
    try {
      const processed = await Promise.all(capped.map(processAsset));
      onChangePhotosRef.current(mergePhotos(photosRef.current, processed, maxPhotos));
    } finally {
      bumpPending(-capped.length);
    }
  };

  const addFromLibrary = async () => {
    if (disabled) {
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      // canAskAgain: the system dialog just handled it — stay quiet. Once the
      // OS stops asking, surface the inline settings path instead.
      if (!permission.canAskAgain) {
        setPermissionDenied(true);
      }
      return;
    }
    setPermissionDenied(false); // iOS limited access counts as granted
    const limit = remainingSlots(photosRef.current.length + pendingRef.current, maxPhotos);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit,
      quality: 1,
      exif: false,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    await ingest(result.assets);
  };

  const addFromCamera = async () => {
    if (disabled) {
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return; // secondary path — no inline state, the gallery remains primary
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    });
    if (result.canceled || !result.assets?.length) {
      return;
    }
    await ingest(result.assets);
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

  type TileAction = 'cover' | 'up' | 'down' | 'remove';

  /** Runs an action against the CURRENT position of a photo. Returns true
   *  when the action completed (false = a confirm step took over). */
  const performAction = (index: number, action: TileAction): boolean => {
    if (index < 0 || index >= photos.length) {
      return true; // the photo is gone — nothing to act on
    }
    if (action === 'remove') {
      if (removalNeedsConfirm(index, count)) {
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
    const cell = gridCellForIndex(slot, gridWidth, GAP);
    return { left: cell.x, top: cell.y, width: cell.width, height: cell.height };
  };

  const gridHeight = gridWidth > 0 ? gridHeightForSlots(slotCount, gridWidth, GAP) : 0;
  const needMore = remainingToMin(count, minPhotos);

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
              <Feather name="x" size={typography.body.lineHeight} color={colors.textSecondary} />
            </Pressable>
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
                showCoverChrome={!singlePhotoMode}
                coverPill={copy.coverPill}
                status={status?.[photo.uri]}
                onRetry={onRetry}
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
              </View>
            ))
          : null}

        {gridWidth > 0 && showAddTile ? (
          <Pressable
            style={[styles.tile, styles.addTile, cellFor(count + pendingCount)]}
            onPress={addFromLibrary}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={
              needMore > 0 ? `${copy.addLabel}. ${copy.addMore(needMore)}` : copy.addLabel
            }
            testID={testID ? `${testID}-add` : undefined}
          >
            <Feather name="plus" size={typography.title.lineHeight} color={colors.textSecondary} />
            <Text style={styles.addLabel}>{copy.addLabel}</Text>
            {needMore > 0 ? <Text style={styles.addMore}>{copy.addMore(needMore)}</Text> : null}
          </Pressable>
        ) : null}
      </View>

      {count > 0 && !singlePhotoMode ? (
        <Text style={styles.coverHint}>{copy.coverHint}</Text>
      ) : null}

      {allowCamera && remaining > 0 && !permissionDenied ? (
        <Pressable
          style={({ pressed }) => [styles.cameraRow, pressed && styles.cameraRowPressed]}
          onPress={addFromCamera}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={copy.cameraLabel}
          testID={testID ? `${testID}-camera` : undefined}
        >
          <Feather name="camera" size={typography.body.lineHeight} color={colors.primary} />
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
            {menuIndex !== null && menuIndex > 0 ? (
              <SheetAction icon="star" label="Make cover photo" onPress={() => menuAction('cover')} />
            ) : null}
            {menuIndex !== null && menuIndex > 0 ? (
              <SheetAction icon="arrow-up" label="Move up" onPress={() => menuAction('up')} />
            ) : null}
            {menuIndex !== null && menuIndex >= 0 && menuIndex < count - 1 ? (
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
    </View>
  );
}

// ---- Tiles ----------------------------------------------------------------

interface GridTileProps {
  photo: PickedPhoto;
  index: number;
  count: number;
  gridWidthSv: SharedValue<number>;
  dragFrom: SharedValue<number>;
  dragOver: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  reduceMotion: boolean;
  disabled: boolean;
  showCoverChrome: boolean;
  coverPill: string;
  status?: PhotoTileStatus;
  onRetry?: (photo: PickedPhoto) => void;
  onCommitMove: (from: number, to: number) => void;
  onOpenMenu: (index: number) => void;
  onTileAction: (index: number, action: 'cover' | 'up' | 'down' | 'remove') => boolean;
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
  const settleMs = reduceMotion ? 0 : motion.fast;

  // Whether THIS tile owns the in-flight drag: with one detector per tile, a
  // second finger could start a second pan; only the first may drive the
  // shared drag state, or commits/cleanup corrupt each other.
  const ownsDrag = useSharedValue(false);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled && count > 1)
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
          const cell = gridCellForIndex(index, gridWidthSv.value, GAP);
          dragOver.value = gridSlotForPoint(
            cell.x + cell.width / 2 + event.translationX,
            cell.y + cell.height / 2 + event.translationY,
            count,
            gridWidthSv.value,
            GAP,
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
    [disabled, count, index, onCommitMove, ownsDrag, dragFrom, dragOver, dragX, dragY, gridWidthSv],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const width = gridWidthSv.value;
    if (width <= 0) {
      return { opacity: 0 };
    }
    const timing = { duration: settleMs, easing: Easing.out(Easing.cubic) };
    if (dragFrom.value === index) {
      // The lifted tile rides the finger from its rest cell.
      const cell = gridCellForIndex(index, width, GAP);
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
    const cell = gridCellForIndex(display, width, GAP);
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

  const canDrag = !disabled && count > 1;
  // The tile is one accessibility element (children are flattened), so every
  // per-photo operation is exposed as an accessibility action here — this is
  // ALSO the no-drag reorder path for switch/screen-reader users.
  const accessibilityActions = [
    ...(index > 0
      ? [
          { name: 'makeCover', label: 'Make cover photo' },
          { name: 'moveUp', label: 'Move up' },
        ]
      : []),
    ...(index < count - 1 ? [{ name: 'moveDown', label: 'Move down' }] : []),
    { name: 'removePhoto', label: 'Remove' },
  ];
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) {
      return;
    }
    const map: Record<string, 'cover' | 'up' | 'down' | 'remove'> = {
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
        accessibilityLabel={tileAccessibilityLabel(index, count, showCoverChrome)}
        accessibilityHint={
          canDrag
            ? 'Double-tap and hold, then drag to reorder. Reorder and remove are also available as actions.'
            : 'Reorder and remove are available as actions.'
        }
        accessibilityActions={accessibilityActions}
        onAccessibilityAction={handleAccessibilityAction}
        testID={testID}
      >
        <View style={styles.tileContent}>
          <AppImage uri={photo.uri} style={styles.tileImage} />

          {index === 0 && showCoverChrome ? (
            <View style={styles.coverPillWrap}>
              <Text style={styles.coverPillText}>{coverPill}</Text>
            </View>
          ) : null}

          {status ? (
            <View style={styles.statusOverlay}>
              {status.kind === 'uploading' ? (
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
        </View>

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
            color={colors.textPrimary}
          />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

/** Calm skeleton pulse while a picked photo is resized off the UI thread. */
function ProcessingShimmer({ reduceMotion }: { reduceMotion: boolean }) {
  'use no memo';
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
        color={destructive ? colors.danger : colors.textPrimary}
      />
      <Text style={[styles.sheetActionLabel, destructive && styles.sheetActionDestructive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  tipsText: {
    ...typography.caption,
    color: colors.textSecondary,
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
    backgroundColor: colors.surfaceSubtle,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  coverPillWrap: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  coverPillText: {
    ...typography.caption,
    color: colors.textPrimary,
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
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
  },
  addTile: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  addMore: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  coverHint: {
    ...typography.caption,
    color: colors.textSecondary,
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
    backgroundColor: colors.surfaceSubtle,
  },
  cameraLabel: {
    ...typography.label,
    color: colors.primary,
  },
  permissionCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  permissionTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  permissionBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  statusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  statusPill: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusText: {
    ...typography.label,
    color: colors.textOnPrimary,
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
    color: colors.textSecondary,
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
    backgroundColor: colors.surfaceSubtle,
  },
  sheetActionLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  sheetActionDestructive: {
    color: colors.danger,
  },
});
