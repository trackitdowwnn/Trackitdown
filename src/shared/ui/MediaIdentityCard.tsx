/**
 * WHAT:  A tall (4:5) cover photo with the subject's identity laid over its
 *        lower edge on an overlay strip — identity left, an underlined "Edit"
 *        on the strip's right — and a quiet caption beneath. Falls back to a
 *        calm placeholder frame with the identity BELOW it when there is no
 *        photo.
 * WHY:   The app's confirmation pattern. "Is this the car?" and "would a
 *        stranger recognise it from this?" are both answered by LOOKING, so
 *        the photo is the component (the reference's photography-first
 *        language at full strength). Extracted from the garage's
 *        VehicleSummaryStep on 2026-08-22 when the posting wizard's review
 *        step needed the same moment — one implementation, so the two cannot
 *        drift.
 *
 *        ⚠️ THE HERO IS DISPLAY-ONLY (no `onPress`) ON PURPOSE. Under a
 *        confirmation, a tappable artifact is a tap-to-affirm trap: people tap
 *        the thing to mean "yes", which would instead fire Edit and drop them
 *        back into the flow they were finishing. Confirming is the footer's
 *        primary; changing anything is the explicit link.
 *
 *        ⚠️ PHOTO CHROME USES `mediaScrim` / `textOnMedia`, NEVER `overlay` /
 *        `textOnPrimary`. The latter track the PAGE and flip with the colour
 *        scheme; a photograph is exactly as bright in dark mode as in light,
 *        so chrome sitting on one must not flip with it (see theme/c.ts). The
 *        full-width strip is deliberate too — a floating pill cannot promise
 *        the text a consistent backing on an arbitrary photo.
 *
 *        The no-photo branch puts the identity in standard ink below the
 *        frame: there is nothing to protect the text against, and white on
 *        grey would fail contrast.
 * LINKS: src/features/garage/components/VehicleSummaryStep.tsx and
 *        src/features/vehicles/post/components/ReviewListingPreview.tsx (the
 *        two consumers); src/shared/ui/CameraCapture.tsx (the
 *        overlay-on-photo precedent); docs/DESIGN_SYSTEM.md.
 */

import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

import { AppImage } from './AppImage';

/** Tall hero ratio — the confirmation moment earns portrait presence, unlike
 *  the browsing card's landscape 4:3. Fixed, not a prop: two confirmation
 *  screens disagreeing about their own shape is the drift this extraction
 *  exists to prevent. */
const HERO_ASPECT_RATIO = 4 / 5;

export interface MediaIdentityCardProps {
  /** Cover photo. Omit for the placeholder + identity-below-frame branch. */
  uri?: string;
  /** The headline identity, e.g. "Blue BMW 3 Series". One line. */
  name: string;
  /**
   * Optional element before the meta text — a PlateChip, say.
   *
   * ⚠️ A RENDER FUNCTION, not a node, and it is handed `onMedia`. The same
   * element renders over the photo in one branch and on the page in the other,
   * and chrome on a photograph must use theme-INVARIANT tokens
   * (`surfaceOverMedia`/`textOnMedia`): a photo is exactly as bright in dark
   * mode as in light. Passing a plain node let a caller hand in a chip filled
   * with `surfaceSubtle`, which flipped from light to charcoal beside white
   * text that did not — the precise failure this component's header forbids.
   * The signature makes the branch impossible to miss.
   */
  metaLeading?: (onMedia: boolean) => ReactNode;
  /** Secondary identity line ("2018 · Hatchback"). Coloured per branch. */
  metaText?: string;
  /** Quiet line beneath the frame ("5 photos · 2 distinctive features"). */
  caption?: string;
  onEdit: () => void;
  /** Required: "Edit" alone tells a screen-reader user nothing about what. */
  editAccessibilityLabel: string;
  /** Shown in the placeholder frame when there is no photo. */
  placeholderIcon?: LucideIcon;
  testID?: string;
  editTestID?: string;
}

export function MediaIdentityCard({
  uri,
  name,
  metaLeading,
  metaText,
  caption,
  onEdit,
  editAccessibilityLabel,
  placeholderIcon: PlaceholderIcon,
  testID,
  editTestID,
}: MediaIdentityCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  // A separator only when both halves are present, so neither branch renders a
  // stray "· ".
  const meta = metaLeading && metaText ? `· ${metaText}` : metaText;
  const leading = metaLeading?.(Boolean(uri));

  return (
    <View style={styles.block} testID={testID}>
      <View style={styles.hero}>
        {uri ? (
          <>
            {/* Decorative: the identity is real text on the strip below. */}
            <AppImage uri={uri} style={styles.heroPhoto} />
            <View style={styles.identityStrip}>
              <View style={styles.identityBlock}>
                <Text style={styles.heroName} numberOfLines={1}>
                  {name}
                </Text>
                {leading || meta ? (
                  <View style={styles.metaRow}>
                    {leading}
                    {meta ? (
                      <Text style={styles.heroMeta} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={editAccessibilityLabel}
                hitSlop={spacing.sm}
                onPress={onEdit}
                style={({ pressed }) => [styles.editOnStrip, pressed ? styles.pressed : null]}
                testID={editTestID}
              >
                <Text style={styles.editOnStripLabel}>Edit</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View
            style={styles.heroPlaceholder}
            accessible
            accessibilityLabel="No photo added yet"
          >
            {PlaceholderIcon ? (
              <PlaceholderIcon size={sizes.icon} color={palette.textSecondary} />
            ) : null}
          </View>
        )}
      </View>

      {!uri ? (
        <View style={styles.fallbackIdentity}>
          <Text style={styles.fallbackName} numberOfLines={1}>
            {name}
          </Text>
          {leading || meta ? (
            <View style={styles.metaRow}>
              {leading}
              {meta ? <Text style={styles.fallbackMeta}>{meta}</Text> : null}
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editAccessibilityLabel}
            hitSlop={spacing.sm}
            onPress={onEdit}
            style={({ pressed }) => [styles.fallbackEdit, pressed ? styles.pressed : null]}
            testID={editTestID}
          >
            <Text style={styles.fallbackEditLabel}>Edit</Text>
          </Pressable>
        </View>
      ) : null}

      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    block: {
      gap: spacing.lg,
    },
    hero: {
      width: '100%',
      aspectRatio: HERO_ASPECT_RATIO,
      borderRadius: radii.lg,
      overflow: 'hidden',
      backgroundColor: c.surfaceSubtle,
    },
    heroPhoto: {
      width: '100%',
      height: '100%',
    },
    heroPlaceholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The identity, protected by the app's one overlay tone (photo-chrome
    // precedent: CameraCapture, PhotoGridPicker). Full-width strip, not a
    // floating pill — the text needs a consistent backing on any photo.
    identityStrip: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.mediaScrim,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    identityBlock: {
      flexShrink: 1,
      gap: spacing.xs,
    },
    editOnStrip: {
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
      alignItems: 'flex-end',
      justifyContent: 'flex-end',
      paddingBottom: spacing.xs,
    },
    pressed: {
      opacity: opacity.pressed,
    },
    editOnStripLabel: {
      ...typography.label,
      color: c.textOnMedia,
      textDecorationLine: 'underline',
    },
    heroName: {
      ...typography.sectionTitle,
      color: c.textOnMedia,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    heroMeta: {
      ...typography.label,
      color: c.textOnMedia,
    },
    fallbackIdentity: {
      gap: spacing.xs,
    },
    fallbackName: {
      ...typography.sectionTitle,
      color: c.textPrimary,
    },
    fallbackMeta: {
      ...typography.label,
      color: c.textSecondary,
    },
    fallbackEdit: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
    },
    // `label`, matching the on-strip control: one card should not change the
    // scale of its own Edit depending on whether a photo loaded.
    fallbackEditLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
    caption: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
