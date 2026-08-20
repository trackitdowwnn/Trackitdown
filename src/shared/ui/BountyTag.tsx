/**
 * WHAT:  BountyTag — a listing's reward line in the near-black accent, either a
 *        bounty amount ("£500 bounty") formatted from integer pence via the
 *        shared money formatter, or "No reward" when the listing carries no
 *        bounty at all.
 * WHY:   Bounty moments are the one place the accent colour appears
 *        (docs/DESIGN_SYSTEM.md — accent is reserved so it keeps meaning;
 *        monochrome scheme, so it's near-black, distinguished by weight),
 *        and the amount is the action driver on every card and detail
 *        screen. Centralising it guarantees no surface ever formats money
 *        its own way. `md` for inline rows, `lg` for card anchor lines.
 *
 *        THE NULL CASE IS THE POINT (ADR-0014). A no-bounty listing has a NULL
 *        bounty, never 0 — so this component is the single place that decides
 *        what "no reward" looks like, and every card, pin and sheet inherits
 *        that decision. Passing 0 here would print "£0 bounty", which is why the
 *        column is nullable and why this prop is `number | null` rather than
 *        being defaulted somewhere upstream.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour rules, Core components: BountyTag);
 *        docs/DOMAIN.md (money is integer pence; listing pricing);
 *        docs/decisions/ADR-0014-no-bounty-listings.md; src/shared/lib/money.ts.
 *
 * Usage:
 *   <BountyTag bountyPence={50000} size="lg" />
 *   <BountyTag bountyPence={null} />          // -> "No reward"
 */

import { StyleSheet, Text } from 'react-native';

import { formatPounds } from '../lib';
import { typography, useThemedStyles, type Palette } from '../theme';

/**
 * What a no-bounty listing reads as, everywhere. Exported because a few
 * surfaces (map pins, accessibility labels) compose their own string and must
 * not invent a second wording for the same fact.
 */
export const NO_BOUNTY_LABEL = 'No reward';

/**
 * The reward as one sentence — "£500 bounty", or "No reward".
 *
 * Exported because four surfaces build their own accessibility label out of the
 * same two facts (card, map pin, map pager, post detail). Exporting only
 * NO_BOUNTY_LABEL guarded the null wording but not the MONEY wording, so a
 * change to "£500 reward" here would have silently desynchronised every screen
 * reader from the text beside it. One function, one sentence.
 *
 * Null-safe by construction: `formatPounds` throws on a non-integer, so this is
 * also the single place that guard has to be right.
 */
export function bountyLabel(bountyPence: number | null): string {
  return bountyPence === null ? NO_BOUNTY_LABEL : `${formatPounds(bountyPence)} bounty`;
}

export interface BountyTagProps {
  /** Bounty in integer pence, or null for a no-bounty listing. */
  bountyPence: number | null;
  /** md = inline rows; lg = the card's anchor line. */
  size?: 'md' | 'lg';
}

/** The reward line: a formatted bounty, or "No reward". */
export function BountyTag({ bountyPence, size = 'md' }: BountyTagProps) {
  const styles = useThemedStyles(makeStyles);
  // The same sentence every other surface shows — see bountyLabel above for why
  // it is shared rather than repeated.
  const label = bountyLabel(bountyPence);
  return (
    <Text
      accessibilityLabel={label}
      // One line always: at narrow carousel widths + large dynamic type a
      // wrapped bounty would make card heights uneven vs their skeletons.
      numberOfLines={1}
      style={[
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        bountyPence === null && styles.none,
      ]}
    >
      {label}
    </Text>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // accentText: in the monochrome scheme accent and accentText are the same
    // near-black (~15:1 AAA as text); the token name is kept for intent and so a
    // future re-theme that gives bounty its own hue is a one-line swap.
    base: {
      color: c.accentText,
    },
    md: {
      ...typography.label,
    },
    lg: {
      ...typography.heading,
    },
    // "No reward" is a fact about the listing, not the action driver a bounty
    // is — so it keeps the size/weight that holds the card's layout together
    // but steps back to secondary text. The accent stays reserved for money.
    none: {
      color: c.textSecondary,
    },
  });
