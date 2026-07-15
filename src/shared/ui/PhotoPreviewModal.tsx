/**
 * WHAT:  PhotoPreviewModal — the full-screen photo viewer PhotoGridPicker
 *        opens when a tile is tapped: the photo letter-boxed on a near-black
 *        backdrop, a position label ("Photo 2 of 3"), and one labelled close
 *        button. View-only by design.
 * WHY:   Owners checking their listing photos and spotters checking evidence
 *        shots both need to SEE a photo properly before deciding to keep or
 *        remove it — a 160pt grid tile can't show whether the plate is
 *        readable. Kept view-only: destructive actions stay on the grid
 *        (tile ⋯ sheet / accessibility actions), so a fat-finger inside the
 *        preview can never delete evidence. Extracted from PhotoGridPicker
 *        to keep that file's growth in check.
 * LINKS: src/shared/ui/PhotoGridPicker.tsx (only consumer);
 *        src/shared/ui/AppImage.tsx; docs/DESIGN_SYSTEM.md (overlay, radii).
 */

import { Feather } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, sizes, spacing, typography } from '../theme';
import { AppImage } from './AppImage';

export interface PhotoPreviewModalProps {
  /** The photo to show; null renders nothing (modal closed). */
  uri: string | null;
  /** Position line, e.g. "Photo 2 of 3". */
  label?: string;
  onClose: () => void;
}

export function PhotoPreviewModal({ uri, label, onClose }: PhotoPreviewModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={uri !== null}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
      // Android back button + iOS accessibility escape both land on onClose
      // via onRequestClose; the explicit button below is the visible path.
    >
      <View style={styles.backdrop}>
        {uri !== null ? (
          <AppImage uri={uri} contentFit="contain" style={styles.photo} />
        ) : null}

        <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
          {label ? (
            // Solid pill, not text on the photo: a tall photo runs under the
            // top bar and its pixels are arbitrary — the pill guarantees AA
            // (same treatment as PhotoGridPicker's status pill).
            <View style={styles.labelPill}>
              <Text style={styles.label} accessibilityLiveRegion="polite">
                {label}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
            hitSlop={spacing.sm}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
            testID="photo-preview-close"
          >
            <Feather name="x" size={sizes.icon} color={colors.textOnPrimary} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // The one full-bleed dark surface in the app: photos read best on
    // near-black, and surfaceInverse keeps it on-palette.
    backgroundColor: colors.surfaceInverse,
    justifyContent: 'center',
  },
  photo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  topBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  labelPill: {
    backgroundColor: colors.textPrimary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textOnPrimary,
  },
  close: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    borderRadius: radii.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: {
    backgroundColor: colors.surfaceInversePressed,
  },
});
