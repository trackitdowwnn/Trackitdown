/**
 * WHAT:  CardSelect — a single-select vertical list of full-width option cards,
 *        each an icon + a title + one line of subtext (the Airbnb "type of
 *        place" pattern). Selected card wears a `primary` (near-black) border;
 *        the rest a hairline. Radio-group semantics.
 * WHY:   Some closed choices carry more than a word — a body type reads better
 *        as "SUV / Tall, chunky stance" with a glyph than as a bare pill. This
 *        is the richer sibling of ChoiceChips for exactly those: one shared
 *        implementation keeps the radiogroup/radio + checked a11y and pressed
 *        states consistent. Icons are lucide components passed per option.
 * LINKS: docs/DESIGN_SYSTEM.md (Cards, Accessibility);
 *        src/shared/ui/ChoiceChips.tsx (the compact sibling);
 *        src/features/vehicles/post/components/postSteps.tsx (BodyTypeStep).
 *
 * Usage:
 *   <CardSelect
 *     options={[{ value: 'suv', label: 'SUV', description: 'Tall, chunky', icon: Truck }]}
 *     value={bodyType}
 *     onSelect={setBodyType}
 *   />
 */

import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

export interface CardSelectOption<V extends string = string> {
  value: V;
  /** The card's headline (one or two words). */
  label: string;
  /** One calm line under the label — what distinguishes this option. */
  description?: string;
  /** A lucide icon component rendered on the left. */
  icon?: LucideIcon;
}

export interface CardSelectProps<V extends string = string> {
  options: CardSelectOption<V>[];
  /** Currently selected value; null renders no card selected. */
  value: V | null;
  onSelect: (value: V) => void;
  /**
   * The QUESTION these options answer.
   *
   * ⚠️ Pass it whenever the question lives in a separate heading above the
   * group. The radiogroup was unnamed, so VoiceOver announced "Annoying, radio
   * button, 1 of 3" with nothing saying what was being asked — a visible header
   * is reachable by heading navigation but is never announced WITH the control.
   */
  accessibilityLabel?: string;
}

export function CardSelect<V extends string = string>({
  options,
  value,
  onSelect,
  accessibilityLabel,
}: CardSelectProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <View
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={
              option.description ? `${option.label}. ${option.description}` : option.label
            }
            accessibilityState={{ checked: selected }}
            onPress={() => onSelect(option.value)}
            style={({ pressed }) => [
              styles.card,
              selected && styles.cardSelected,
              pressed && styles.cardPressed,
            ]}
          >
            {Icon ? (
              <Icon
                size={sizes.icon}
                color={selected ? palette.textPrimary : palette.textSecondary}
              />
            ) : null}
            <View style={styles.text}>
              <Text style={styles.label}>{option.label}</Text>
              {option.description ? (
                <Text style={styles.description}>{option.description}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    group: {
      gap: spacing.md,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      minHeight: sizes.touchTarget + spacing.md,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.lg,
      // Constant-width border (colour-only change on select) so nothing reflows.
      borderWidth: sizes.selectBorder,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    cardSelected: {
      borderColor: c.primary,
    },
    cardPressed: {
      backgroundColor: c.surfaceSubtle,
    },
    text: {
      flex: 1,
      gap: spacing.xs,
    },
    // Title in the cardTitle face (Bold) so it reads as the headline over the
    // Regular subtext — selection is carried by the border + icon + checked state,
    // so the title weight is constant (no fontWeight nudge; the theme has no 600).
    label: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    description: {
      ...typography.caption,
      color: c.textSecondary,
    },
  });
