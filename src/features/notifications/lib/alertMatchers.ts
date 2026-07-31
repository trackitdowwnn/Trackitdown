/**
 * WHAT:  Pure translation between an alert's stored CRITERIA and the MATCHERS
 *        the wizard's first screen ticks — derive the ticks from a saved alert
 *        (for editing), and reduce the wizard's answers back to criteria,
 *        dropping anything whose matcher is not ticked.
 * WHY:   The matcher list is wizard shape with no column behind it, so the two
 *        directions have to agree or editing silently loses a filter.
 *
 *        `criteriaForMatchers` is the SAFETY half. `update_my_alert` is a FULL
 *        REPLACE, and the wizard's answers keep whatever a step wrote even
 *        after its card is unticked — tick "A specific car", pick a BMW, go
 *        back, untick it, save, and without this the row would still be
 *        BMW-only while the review screen and the card list both said "any
 *        car". Reducing at the single point of submit means the saved row can
 *        never disagree with what the user was shown.
 * LINKS: ./alertFlow.tsx (which steps each matcher emits);
 *        ../screens/AlertWizardScreen.tsx (the one caller of both);
 *        ../types.ts (AlertMatcher, AlertCriteria).
 */

import {
  type AlertAnswers,
  type AlertCriteria,
  type AlertMatcher,
  EMPTY_CRITERIA,
} from '../types';

/**
 * Which cards to pre-tick when re-opening a saved alert. `area` is always in
 * the list — every alert has a point and a radius.
 *
 * Recency rides with `bounty` rather than earning its own card: the product
 * offers three things to match on, and "how recently it was seen" is a
 * refinement of which reports are worth hearing about, not a fourth axis.
 */
export function matchersForCriteria(criteria: AlertCriteria): AlertMatcher[] {
  const matchers: AlertMatcher[] = ['area'];
  if (criteria.make || criteria.model || criteria.colour || criteria.bodyType) {
    matchers.push('car');
  }
  if (criteria.minBountyPence !== null || criteria.recencyDays !== null) {
    matchers.push('bounty');
  }
  return matchers;
}

/**
 * The criteria to SAVE: each field is taken from the answers only when its
 * matcher is ticked, and is null otherwise. Null means "any" server-side, so
 * an unticked card always widens the alert rather than leaving a stale filter.
 */
export function criteriaForMatchers(
  answers: Partial<AlertAnswers>,
  matchers: readonly AlertMatcher[],
): AlertCriteria {
  const wants = (matcher: AlertMatcher) => matchers.includes(matcher);
  return {
    ...EMPTY_CRITERIA,
    make: wants('car') ? (answers.make ?? null) : null,
    model: wants('car') ? (answers.model ?? null) : null,
    colour: wants('car') ? (answers.colour ?? null) : null,
    bodyType: wants('car') ? (answers.bodyType ?? null) : null,
    minBountyPence: wants('bounty') ? (answers.minBountyPence ?? null) : null,
    recencyDays: wants('bounty') ? (answers.recencyDays ?? null) : null,
  };
}
