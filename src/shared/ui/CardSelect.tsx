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
 *        src/shared/ui/optionCardStyles.ts (the card's look, shared);
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

import { sizes, usePalette, useThemedStyles, type Palette } from '../theme';
import { optionCardStyleSpec } from './optionCardStyles';

export interface CardSelectOption<V extends string = string> {
  value: V;
  /** The card's headline (one or two words). */
  label: string;
  /** One calm line under the label — what distinguishes this option. */
  description?: string;
  /** A lucide icon component rendered on the left. */
  icon?: LucideIcon;
  /** What a screen reader says instead of "label. description" — for an
   *  option whose words lean on what's around it ("Not sure" → "Not sure
   *  which way it went"). It REPLACES the description, and must contain the
   *  visible label (WCAG 2.5.3) so voice control still finds the card. */
  accessibilityLabel?: string;
  /** What tapping it does when that isn't just "select" — e.g. "Opens a
   *  calendar" on a card that opens a picker (last-seen's "Pick a date and
   *  time"), so a screen reader isn't surprised by a dialog. */
  accessibilityHint?: string;
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
  /**
   * The caller clears the answer when the chosen card is tapped again (an
   * optional question). This only TELLS screen readers so — "Double tap to
   * clear" on the chosen card, as ChoiceChips does — since a radio is
   * otherwise assumed to stay chosen.
   */
  clearable?: boolean;
  /** On the group. */
  testID?: string;
}

export function CardSelect<V extends string = string>({
  options,
  value,
  onSelect,
  accessibilityLabel,
  clearable = false,
  testID,
}: CardSelectProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  return (
    <View
      style={styles.group}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={
              option.accessibilityLabel ??
              (option.description ? `${option.label}. ${option.description}` : option.label)
            }
            accessibilityHint={
              option.accessibilityHint ?? (clearable && selected ? 'Double tap to clear' : undefined)
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

// The look is shared with CardSelectMulti and OptionCard (optionCardStyles).
const makeStyles = (c: Palette) => StyleSheet.create(optionCardStyleSpec(c));
