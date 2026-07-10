/**
 * WHAT:  Pure logic for AppTabBar — the badge rendering rules (dot vs count
 *        pill vs "9+") and the accessibility-label builder.
 * WHY:   Badges carry meaning (unread messages, activity on your stolen-car
 *        posts), so their thresholds and the words a screen reader speaks
 *        are pinned here as pure functions the tests can hammer without
 *        rendering (precedent: photoGridModel.ts, moneySliderMath.ts).
 * LINKS: src/shared/ui/AppTabBar.tsx (consumer); docs/TESTING.md.
 */

/** A tab's badge input: absent/0/false = none, true = dot, n = count. */
export type BadgeValue = number | boolean | undefined;

/** Counts above this collapse to "9+" — a tab badge informs, not tallies. */
const BADGE_MAX = 9;

export type BadgeDisplay =
  | { kind: 'none' }
  | { kind: 'dot' }
  | { kind: 'count'; text: string };

/** How a badge value renders: nothing, a dot, or a small count pill. */
export function badgeDisplay(value: BadgeValue): BadgeDisplay {
  if (value === undefined || value === false) {
    return { kind: 'none' };
  }
  if (value === true) {
    return { kind: 'dot' };
  }
  if (!Number.isFinite(value)) {
    return { kind: 'none' }; // nonsense counts never render a badge
  }
  const count = Math.floor(value); // floor FIRST so 0.9 is none, not a "0" pill
  if (count <= 0) {
    return { kind: 'none' };
  }
  return { kind: 'count', text: count > BADGE_MAX ? `${BADGE_MAX}+` : String(count) };
}

/** Default wording for a numeric badge in the accessibility label. */
export function defaultBadgeLabel(count: number): string {
  return `${count > BADGE_MAX ? `more than ${BADGE_MAX}` : count} new`;
}

/**
 * The full spoken label for a tab: name, badge (if any), and position —
 * e.g. "Inbox, 3 new, tab 3 of 4".
 */
export function tabAccessibilityLabel(
  label: string,
  index: number,
  total: number,
  badge: BadgeValue,
  badgeLabel: (count: number) => string = defaultBadgeLabel,
): string {
  const display = badgeDisplay(badge);
  const badgePart =
    display.kind === 'dot'
      ? ', new activity'
      : display.kind === 'count'
        ? `, ${badgeLabel(typeof badge === 'number' ? badge : 0)}`
        : '';
  return `${label}${badgePart}, tab ${index + 1} of ${total}`;
}
