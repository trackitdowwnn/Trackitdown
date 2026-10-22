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
 *        src/shared/ui/optionCardStyles.ts (the card's look, shared);
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

import { sizes, usePalette, useThemedStyles, type Palette } from '../theme';
import { optionCardStyleSpec } from './optionCardStyles';

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
  /** What a screen reader says instead of "label. description" — for an
   *  option whose words lean on what's around it. It REPLACES the description,
   *  and must contain the visible label (WCAG 2.5.3) so voice control still
   *  finds the card by what it shows. */
  accessibilityLabel?: string;
}

export interface CardSelectMultiProps<V extends string = string> {
  options: CardSelectMultiOption<V>[];
  /** Currently selected values; order is preserved by the caller's array. */
  value: V[];
  /** Receives the full next selection (the card's toggle is applied for you).
   *  Locked options never appear in a change — they cannot be toggled off. */
  onChange: (next: V[]) => void;
  /** The QUESTION these options answer. A bonus, not the fix: TalkBack reads it
   *  (it may make it its own stop); VoiceOver says nothing for a label on a
   *  View that isn't itself accessible (ChoiceChipsMulti's note). The context
   *  that works on both is the visible question as a header, plus a per-option
   *  label on any card that needs it. */
  accessibilityLabel?: string;
  /** On the group. */
  testID?: string;
}

export function CardSelectMulti<V extends string = string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: CardSelectMultiProps<V>) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();

  const toggle = (option: V) => {
    onChange(
      value.includes(option) ? value.filter((v) => v !== option) : [...value, option],
    );
  };

  return (
    <View style={styles.group} accessibilityLabel={accessibilityLabel} testID={testID}>
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
              option.accessibilityLabel ??
              (option.description ? `${option.label}. ${option.description}` : option.label)
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

// The card and its tick box are shared with CardSelect and OptionCard
// (optionCardStyles).
const makeStyles = (c: Palette) => StyleSheet.create(optionCardStyleSpec(c));
