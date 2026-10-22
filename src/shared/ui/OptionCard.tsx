/**
 * WHAT:  OptionCard — one option card drawn READ-ONLY: the icon, the title and
 *        a quiet line under it, in exactly the look CardSelect and
 *        CardSelectMulti give a card (optionCardStyles), selected by default.
 *        Not pressable, no radio/checkbox role: one screen-reader stop that
 *        reads as a statement ("Parked. Looks parked up" — CardSelect's own
 *        wording). `trailingCheck` adds CardSelectMulti's tick box, so an
 *        answer from a multi-select question looks as it did when ticked.
 *        `items` lists rows under the title, each with its small icon, one
 *        level deep (owner, 2026-10-22: the damage seen, a row each, the
 *        parts under "Missing panels or parts") — still one statement.
 * WHY:   To show an answer back as the card that was tapped — the report's
 *        check-and-send step, owner 2026-10-22: "answers to be in the form of
 *        the card, the same and the selection". Reusing CardSelect with only
 *        the chosen option would still be a pressable radio, so a screen
 *        reader would say "radio button, checked, 1 of 1" on something that
 *        cannot be changed here; changing it is what the Edit beside it is for.
 * LINKS: ./optionCardStyles.ts (the shared look); ./CardSelect.tsx;
 *        src/features/sightings/components/ConfirmStep.tsx (the first user).
 *
 * Usage:
 *   <OptionCard icon={SquareParking} label="Parked" description="Looks parked up" />
 */

import { Feather } from '@expo/vector-icons';
import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { sizes, usePalette, useThemedStyles, type Palette } from '../theme';
import { optionCardStyleSpec } from './optionCardStyles';

/** A row under the card's title, and the rows under it (one level). */
export interface OptionCardItem {
  label: string;
  icon?: LucideIcon;
  items?: OptionCardItem[];
}

export interface OptionCardProps {
  label: string;
  /** The line under the title — on a review, what the answer led to. */
  description?: string;
  icon?: LucideIcon;
  /** The chosen look (primary border, dark icon). Default true: a card shown
   *  back is a card that was chosen. */
  selected?: boolean;
  /** CardSelectMulti's trailing tick box — for an answer from a "tick any"
   *  question, so it looks exactly as it did when ticked. */
  trailingCheck?: boolean;
  /** Rows under the title, in place of `description` (decorative icons;
   *  the words join the one statement). */
  items?: OptionCardItem[];
  /** What a screen reader says instead of "label. description". */
  accessibilityLabel?: string;
  testID?: string;
}

export function OptionCard({
  label,
  description,
  icon: Icon,
  selected = true,
  trailingCheck = false,
  items,
  accessibilityLabel,
  testID,
}: OptionCardProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const rows = items && items.length > 0 ? items : null;
  // One statement: the title, then each row — a row's own rows after a colon
  // ("Missing panels or parts: Bumpers, Doors").
  const spoken = rows
    ? [
        label,
        ...rows.map((row) =>
          row.items && row.items.length > 0
            ? `${row.label}: ${row.items.map((inner) => inner.label).join(', ')}`
            : row.label,
        ),
      ].join('. ')
    : description
      ? `${label}. ${description}`
      : label;

  const head = (
    <>
      {Icon ? (
        <Icon size={sizes.icon} color={selected ? palette.textPrimary : palette.textSecondary} />
      ) : null}
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {description && !rows ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {trailingCheck ? (
        <View
          style={[styles.box, selected && styles.boxSelected]}
          testID={testID ? `${testID}-check` : undefined}
        >
          {selected ? (
            <Feather
              name="check"
              size={sizes.iconSm}
              color={palette.textOnPrimary}
              importantForAccessibility="no"
            />
          ) : null}
        </View>
      ) : null}
    </>
  );

  return (
    <View
      style={[styles.card, selected && styles.cardSelected, rows && styles.cardColumn]}
      accessible
      accessibilityLabel={accessibilityLabel ?? spoken}
      testID={testID}
    >
      {rows ? (
        <>
          <View style={styles.titleRow}>{head}</View>
          <View style={styles.itemList}>
            {rows.map((row, index) => (
              <View key={`${index}-${row.label}`}>
                <ItemRow item={row} testID={testID ? `${testID}-item-${index}` : undefined} />
                {row.items && row.items.length > 0 ? (
                  <View style={styles.itemNested}>
                    {row.items.map((inner, innerIndex) => (
                      <ItemRow
                        key={`${innerIndex}-${inner.label}`}
                        item={inner}
                        testID={testID ? `${testID}-item-${index}-${innerIndex}` : undefined}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : (
        head
      )}
    </View>
  );
}

/** One row under the title: a small decorative icon and the words. */
function ItemRow({ item, testID }: { item: OptionCardItem; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const Icon = item.icon;
  return (
    <View style={styles.itemRow} testID={testID}>
      {Icon ? (
        <Icon
          size={sizes.iconSm}
          color={palette.textSecondary}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
      ) : null}
      <Text style={styles.itemText}>{item.label}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create(optionCardStyleSpec(c));
