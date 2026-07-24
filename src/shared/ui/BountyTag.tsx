/**
 * WHAT:  BountyTag — a bounty amount in the near-black accent ("£500
 *        bounty"), always formatted from integer pence via the shared
 *        money formatter.
 * WHY:   Bounty moments are the one place the accent colour appears
 *        (docs/DESIGN_SYSTEM.md — accent is reserved so it keeps meaning;
 *        monochrome scheme, so it's near-black, distinguished by weight),
 *        and the amount is the action driver on every card and detail
 *        screen. Centralising it guarantees no surface ever formats money
 *        its own way. `md` for inline rows, `lg` for card anchor lines.
 * LINKS: docs/DESIGN_SYSTEM.md (Colour rules, Core components: BountyTag);
 *        docs/DOMAIN.md (money is integer pence); src/shared/lib/money.ts.
 *
 * Usage:
 *   <BountyTag bountyPence={50000} size="lg" />
 */

import { StyleSheet, Text } from 'react-native';

import { formatPounds } from '../lib';
import { colors, typography } from '../theme';

export interface BountyTagProps {
  /** Bounty in integer pence. */
  bountyPence: number;
  /** md = inline rows; lg = the card's anchor line. */
  size?: 'md' | 'lg';
}

/** Near-black bounty amount, always formatted from integer pence. */
export function BountyTag({ bountyPence, size = 'md' }: BountyTagProps) {
  const amount = formatPounds(bountyPence);
  return (
    <Text
      accessibilityLabel={`${amount} bounty`}
      // One line always: at narrow carousel widths + large dynamic type a
      // wrapped bounty would make card heights uneven vs their skeletons.
      numberOfLines={1}
      style={[styles.base, size === 'lg' ? styles.lg : styles.md]}
    >
      {amount} bounty
    </Text>
  );
}

const styles = StyleSheet.create({
  // accentText: in the monochrome scheme accent and accentText are the same
  // near-black (~15:1 AAA as text); the token name is kept for intent and so a
  // future re-theme that gives bounty its own hue is a one-line swap.
  base: {
    color: colors.accentText,
  },
  md: {
    ...typography.label,
  },
  lg: {
    ...typography.heading,
  },
});
