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

/** The gap between a card's icon and its title — and so how far the rows under
 *  a title are indented, so the two can never drift apart. */
const TITLE_GAP = spacing.lg;

/** Pass to StyleSheet.create, spread with any extra keys the caller needs. */
export const optionCardStyleSpec = (c: Palette) =>
  ({
    group: {
      gap: spacing.md,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TITLE_GAP,
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
    // CardSelect layout="inline" (owner, 2026-10-22: last-seen's time
    // cards): a 44pt touch target plus a little air, not the md extra, and
    // half the gap between cards.
    groupCompact: {
      gap: spacing.sm,
    },
    cardCompact: {
      minHeight: sizes.touchTarget + spacing.xs,
      paddingVertical: spacing.md,
    },
    // Label left, value right on one line; wraps (value under, still right)
    // at large text rather than clipping either.
    textInline: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      rowGap: spacing.xs,
    },
    labelInline: {
      flexShrink: 1,
    },
    descriptionInline: {
      marginLeft: 'auto',
      textAlign: 'right',
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
      gap: TITLE_GAP,
    },
    itemList: {
      paddingLeft: sizes.icon + TITLE_GAP,
      gap: spacing.sm,
    },
    // A title with no icon: the rows start where the title does.
    itemListNoIcon: {
      paddingLeft: 0,
    },
    // The row icon's slot: the icon's width even with no icon, so rows always
    // line up; its height is one caption line, scaled with the text in
    // OptionCard, so the icon stays centred on the first line at large text.
    itemIconSlot: {
      width: sizes.iconSm,
      alignItems: 'center',
      justifyContent: 'center',
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
