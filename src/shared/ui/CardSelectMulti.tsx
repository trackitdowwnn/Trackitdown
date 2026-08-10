/**
 * WHAT:  CardSelectMulti — a MULTI-select vertical list of full-width option
 *        cards, each an icon + a title + one line of subtext, with a trailing
 *        checkbox. The checkbox sibling of CardSelect (which is single-select),
 *        exactly as ChoiceChipsMulti is to ChoiceChips.
 * WHY:   Some multi-choices need more than a pill's worth of words — "A
 *        specific car / Make, model, colour, body type" explains itself in a
 *        way "Car" cannot. One shared implementation keeps checkbox semantics
 *        (checkbox role + checked state, 44pt targets, a non-colour selection
 *        cue) consistent with the rest of the kit.
 *
 *        Supports a LOCKED option: permanently checked and not pressable, for
 *        a choice the product requires but still wants to show, so the list
 *        reads as the complete set rather than hiding the mandatory part. A
 *        locked card explains itself in its own description — never leave the
 *        user tapping a card that will not respond without saying why.
 * LINKS: docs/DESIGN_SYSTEM.md (Cards, Accessibility);
 *        src/shared/ui/CardSelect.tsx (the single-select sibling);
 *        src/shared/ui/ChoiceChipsMulti.tsx (the compact sibling).
 *
 * Usage:
 *   <CardSelectMulti
 *     options={[
 *       { value: 'area', label: 'An area', description: 'Always on', locked: true },
 *       { value: 'car', label: 'A specific car', description: 'Make, model…', icon: Car },
 *     ]}
 *     value={matchers}
 *     onChange={setMatchers}
 *   />
 */

import { Feather } from '@expo/vector-icons';
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

export interface CardSelectMultiOption<V extends string = string> {
  value: V;
  /** The card's headline (one or two words). */
  label: string;
  /** One calm line under the label — what distinguishes this option. */
  description?: string;
  /** A lucide icon component rendered on the left. */
  icon?: LucideIcon;
  /**
   * Renders permanently checked and non-pressable. Use for a choice the
   * product requires; say why in `description`, because a card that cannot be
   * unticked and does not explain itself reads as a bug.
   */
  locked?: boolean;
}

export interface CardSelectMultiProps<V extends string = string> {
  options: CardSelectMultiOption<V>[];
  /** Currently selected values; order is preserved by the caller's array. */
  value: V[];
  /** Receives the full next selection (the card's toggle is applied for you).
   *  Locked options never appear in a change — they cannot be toggled off. */
  onChange: (next: V[]) => void;
}

export function CardSelectMulti<V extends string = string>({
  options,
  value,
  onChange,
}: CardSelectMultiProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const toggle = (option: V) => {
    onChange(
      value.includes(option) ? value.filter((v) => v !== option) : [...value, option],
    );
  };

  return (
    <View style={styles.group}>
      {options.map((option) => {
        // A locked card reads as checked whether or not the caller passed it in
        // `value`, so the control can never show the required choice as off.
        const selected = option.locked || value.includes(option.value);
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="checkbox"
            accessibilityLabel={
              option.description ? `${option.label}. ${option.description}` : option.label
            }
            accessibilityState={{ checked: selected, disabled: Boolean(option.locked) }}
            disabled={option.locked}
            onPress={() => toggle(option.value)}
            style={({ pressed }) => [
              styles.card,
              selected && styles.cardSelected,
              pressed && !option.locked && styles.cardPressed,
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
            {/* Trailing box: a selection cue that doesn't rely on the border
                colour alone. The slot is always present (fixed size) so
                toggling never reflows the card. */}
            <View style={[styles.box, selected && styles.boxSelected]}>
              {selected ? (
                <Feather
                  name={option.locked ? 'lock' : 'check'}
                  size={sizes.iconSm}
                  color={palette.textOnPrimary}
                  importantForAccessibility="no"
                />
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
    label: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    description: {
      ...typography.caption,
      color: c.textSecondary,
    },
    box: {
      width: sizes.icon,
      height: sizes.icon,
      borderRadius: radii.sm,
      borderWidth: sizes.selectBorder,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxSelected: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
  });
