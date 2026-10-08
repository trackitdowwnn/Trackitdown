/**
 * WHAT:  DistinctiveFeatureList — a car's distinctive features, read-only: one
 *        quiet card per feature (its photo inset beside the description),
 *        collapsing past `previewCount` behind a "Show all N features" button.
 * WHY:   Extracted 2026-10-08 from the post detail screen's section when the
 *        garage's "Your car" sheet needed the same thing — one implementation,
 *        so the two can't drift. The rules came with it:
 *        - each card is ONE accessible object ("Distinctive feature: …"): the
 *          photo is the evidence for the description beside it, so a screen
 *          reader hears the mark once, not twice;
 *        - the cards are flat (cardSurface), not shadowed — they are not
 *          tappable, and a shadow would promise an interaction that isn't there;
 *        - `expanded` is pinned to `collapsible`, so the slice and the button
 *          can never disagree when the list shrinks under it (the post editor
 *          overlays the same screen without unmounting this).
 *        The section around it — heading, edit control, empty state — stays
 *        with each screen.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx;
 *        src/features/garage/components/VehicleSummaryStep.tsx.
 */

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  cardSurface,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '../theme';
import { AppImage } from './AppImage';
import { Button } from './Button';

export interface DistinctiveFeatureItem {
  id?: string;
  photoUrl: string;
  description: string;
}

export interface DistinctiveFeatureListProps {
  features: DistinctiveFeatureItem[];
  /** Cards shown before "Show all N features". */
  previewCount?: number;
  testID?: string;
}

export function DistinctiveFeatureList({
  features,
  previewCount = 3,
  testID,
}: DistinctiveFeatureListProps) {
  const styles = useThemedStyles(makeStyles);
  const [showAll, setShowAll] = useState(false);
  const collapsible = features.length > previewCount;
  const expanded = showAll && collapsible;
  const visible = expanded ? features : features.slice(0, previewCount);

  return (
    <View style={styles.root} testID={testID}>
      <View style={styles.list}>
        {visible.map((feature, index) => (
          <View
            key={feature.id ?? `${feature.photoUrl}-${index}`}
            style={styles.card}
            accessible
            accessibilityLabel={`Distinctive feature: ${feature.description}`}
          >
            <AppImage uri={feature.photoUrl} style={styles.photo} />
            <Text style={styles.description}>{feature.description}</Text>
          </View>
        ))}
      </View>
      {collapsible ? (
        <Button
          label={expanded ? 'Show fewer features' : `Show all ${features.length} features`}
          variant="subtle"
          onPress={() => setShowAll((shown) => !shown)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The section-level gap between the list and its button (16), matching
    // "Show more" elsewhere on the detail page.
    root: {
      gap: spacing.lg,
    },
    list: {
      // 12 — the measured gap between the reference's cards.
      gap: spacing.md,
    },
    card: {
      ...cardSurface(c),
      flexDirection: 'row',
      alignItems: 'center',
      // Uniform inset (matching the editor's card for the same content), so the
      // photo sits optically centred rather than shoved against one edge.
      gap: spacing.md,
      padding: spacing.md,
    },
    photo: {
      width: sizes.featureThumb,
      // 4:3 by ratio, not a second magic number — the crop can't drift.
      aspectRatio: 4 / 3,
      borderRadius: radii.md,
    },
    description: {
      // cardTitle, NOT heading: bold at body size so the photo stays the hero.
      ...typography.cardTitle,
      color: c.textPrimary,
      flex: 1,
    },
  });
