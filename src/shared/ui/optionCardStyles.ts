/**
 * WHAT:  The option card's look — the full-width card with an icon, a title
 *        and a quiet line under it, a hairline border that turns `primary`
 *        when chosen — as one style spec.
 * WHY:   Three things draw this card: CardSelect (radio), CardSelectMulti
 *        (checkbox) and OptionCard (read-only, for showing an answer back —
 *        the report's check-and-send step, owner 2026-10-22: "the same and
 *        the selection"). Each used to carry its own copy of these numbers;
 *        one spec means the answer a spotter sees on review is pixel for
 *        pixel the card they tapped, and a change to one is a change to all.
 * LINKS: ./CardSelect.tsx, ./CardSelectMulti.tsx, ./OptionCard.tsx;
 *        docs/DESIGN_SYSTEM.md (Cards).
 */

import { radii, sizes, spacing, typography, type Palette } from '../theme';

/** Pass to StyleSheet.create, spread with any extra keys the caller needs. */
export const optionCardStyleSpec = (c: Palette) =>
  ({
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
    // Regular subtext — selection is carried by the border + icon + checked
    // state, so the title weight is constant (the theme has no 600).
    label: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    description: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // The multi-select card's trailing tick box: a selection cue that does
    // not rely on the border colour alone. Fixed size, so ticking never
    // reflows the card.
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
    // A card that lists rows under its title (OptionCard `items` — the
    // review's "Damage visible" card): the title row as above, then the rows
    // aligned with the title (the icon's width and the card's gap in).
    cardColumn: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: spacing.md,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
    },
    itemList: {
      paddingLeft: sizes.icon + spacing.lg,
      gap: spacing.sm,
    },
    itemRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    // Wraps under itself at large text; never cut.
    itemText: {
      ...typography.caption,
      color: c.textSecondary,
      flexShrink: 1,
    },
    // A row's own rows (the parts under "Missing panels or parts"): one
    // step further in — the row icon's width and its gap.
    itemNested: {
      paddingLeft: sizes.iconSm + spacing.sm,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
  }) as const;
