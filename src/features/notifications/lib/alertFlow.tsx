/**
 * WHAT:  The create-an-alert WizardFlow, BUILT FROM THE CHOSEN MATCHERS — area
 *        always, then the car step and/or the bounty step only if their card
 *        was ticked, then the name. Plus the initial answers.
 * WHY:   Flows are DATA, not code (the framework renders everything else), so
 *        the order, gating and review copy live in one auditable table.
 *
 *        Deliberately ONE phase with NO intro, but WITH a review — exactly
 *        addVehicleFlow's shape. This is a calm settings task, not the posting
 *        wizard's "sorry this happened" moment, so a full-screen intro would
 *        be ceremony; but unlike report-sighting it is not urgent either, and
 *        a review screen is worth it because an alert is invisible once saved:
 *        the only chance to notice you set 1 mile instead of 10 is before you
 *        finish.
 *
 *        ⚠️ THE MATCHERS ARE CHOSEN BEFORE THE WIZARD MOUNTS, not on a step
 *        inside it. `useWizardController` resets navigation whenever the
 *        flattened screen list changes identity, and nav.index /
 *        nav.returnToIndex are POSITIONS into that list (see navigation.ts's
 *        `reset` SAFETY note). A step that added or removed later steps as the
 *        user toggled it would therefore bounce them back to itself, and a
 *        review-edit spur that changed the count would return to the wrong
 *        screen. Choosing first and building once keeps the flow stable for the
 *        whole run — the same reason AlertWizardScreen memoises it.
 *
 *        Only AREA and NAME gate. A ticked criterion step still has an
 *        always-passing schema: ticking "A specific car" and then leaving it on
 *        "any make" is a real answer, not an error to block on.
 * LINKS: ../components/AlertMatcherPicker.tsx (the screen that chooses these);
 *        ../components/alertSteps.tsx (the components — and where ./alertName.ts's
 *        suggestion is now used, as NameStep's placeholder);
 *        ./alertMatchers.ts (criteria ↔ matchers);
 *        ../screens/AlertWizardScreen.tsx (renders this);
 *        src/features/garage/lib/addVehicleFlow.tsx (the shape).
 */

import { z } from 'zod';

// Direct paths, not barrels — keeps this config's module graph light enough
// for the smoke test to load it without native deps (postACarFlow does the
// same for exactly that reason).
import { formatPounds } from '@/shared/lib/money';
import type { WizardFlow, WizardStep } from '@/shared/wizard';

import { AreaStep, CarStep, FiltersStep, NameStep } from '../components/alertSteps';
import {
  DEFAULT_ALERT_RADIUS_MILES,
  MAX_ALERT_NAME_LENGTH,
  type AlertAnswers,
  type AlertMatcher,
} from '../types';

/** Re-exported so this config still reads as the one place the flow's defaults
 *  live. It is DEFINED in ../types because alertSteps needs it too, and
 *  alertSteps cannot import this file — this file imports alertSteps. */
export { DEFAULT_ALERT_RADIUS_MILES };

export const ALERT_INITIAL_ANSWERS: Partial<AlertAnswers> = {
  radiusMiles: DEFAULT_ALERT_RADIUS_MILES,
  // SAFETY: privacy is the default, not the opt-in.
  approximate: true,
  name: '',
};

/** "Blue BMW 320d" / "Any car" — the review line for the criteria steps. */
function describeCriteria(answers: Partial<AlertAnswers>): string {
  const parts = [answers.colour, answers.make, answers.model, answers.bodyType]
    .map((value) => value?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Any car';
}

function describeFilters(answers: Partial<AlertAnswers>): string {
  const parts: string[] = [];
  if (answers.minBountyPence) parts.push(`${formatPounds(answers.minBountyPence)}+`);
  if (answers.recencyDays) parts.push(`seen in the last ${answers.recencyDays} days`);
  return parts.length > 0 ? parts.join(' · ') : 'No extra filters';
}

/*
 * ⚠️ THE NAME IS NO LONGER PRE-FILLED (owner request, 2026-08-27). A
 * `withNameSuggestion` wrapper used to hang off whichever step preceded `name`
 * and seed the field with "5 miles around Luton" / "Blue BMWs near Luton" via
 * an `onContinue`. It is gone: the field now opens empty.
 *
 * `suggestAlertName` did NOT go with it — NameStep shows the same sentence as
 * the field's PLACEHOLDER instead. That is the whole point of the change: a
 * placeholder guides without being something to delete, and because TextField
 * only surfaces a placeholder once the field is focused, it appears at the
 * moment the user is deciding what to type rather than sitting there looking
 * like an answer.
 */

// Area is ONE step: the circle scaling live with the slider is the payoff
// visual, and splitting it would show a circle the user cannot change, then a
// number with no picture.
const AREA_STEP: WizardStep<AlertAnswers> = {
  id: 'area',
  question: 'Which area should we watch?',
  // NO helper, deliberately. The map teaches the step better than a sentence
  // about the map does, and on a fills step every line of copy is taken
  // directly out of the thing the user came here to use.
  component: AreaStep,
  // The map IS the step, so it takes the height rather than sitting in a fixed
  // frame inside a scroller. See WizardStep.fills.
  fills: true,
  schema: z.object({
    location: z.object({ latitude: z.number(), longitude: z.number() }),
  }),
  reviewLabel: 'Area',
  // SAFETY: names the coarsening. Dropping the step's helper and the option
  // card's caption took the ONLY mentions of it off the map step, and the risk
  // case is someone turning the toggle OFF — precisely when the consequence
  // needs stating. The review is the last screen before an exact home point
  // would be stored, and this costs no map height, which is why it lives here
  // rather than back on the map.
  reviewValue: (answers) =>
    `${answers.radiusMiles ?? DEFAULT_ALERT_RADIUS_MILES} miles around ${
      answers.placeLabel?.trim() || 'the pin'
    }${answers.approximate === false ? ' · exact location' : ' · approximate area'}`,
};

const CAR_STEP: WizardStep<AlertAnswers> = {
  id: 'car',
  question: 'Which cars?',
  // The user asked for this step, so it no longer suggests skipping it — but
  // every field within it is still genuinely optional.
  helper: 'Narrow it as far as you like — anything you leave alone means "any".',
  component: CarStep,
  // Always passes: "any car" is a valid, common answer.
  schema: z.object({}),
  reviewLabel: 'Cars',
  reviewValue: describeCriteria,
};

const FILTERS_STEP: WizardStep<AlertAnswers> = {
  id: 'filters',
  question: 'Which reports are worth it?',
  helper: 'Only hear about the ones above a bounty you care about.',
  component: FiltersStep,
  schema: z.object({}),
  reviewLabel: 'Bounty',
  reviewValue: describeFilters,
};

const NAME_STEP: WizardStep<AlertAnswers> = {
  id: 'name',
  question: 'Name this alert',
  // ⚠️ NO LONGER "We've suggested one." — the field opens empty, so the old
  // helper would have been a plain lie about what is on screen.
  helper: 'So you can tell it apart from your others.',
  component: NameStep,
  schema: z.object({ name: z.string().trim().min(1).max(MAX_ALERT_NAME_LENGTH) }),
  reviewLabel: 'Name',
  reviewValue: (answers) => answers.name?.trim() || '—',
};

/**
 * @param matchers What the user ticked on the picker. `area` is implicit — the
 *   area step is always emitted whether or not it appears in the list, because
 *   the column is NOT NULL.
 */
export function buildAlertFlow(matchers: readonly AlertMatcher[]): WizardFlow<AlertAnswers> {
  const criteriaSteps: WizardStep<AlertAnswers>[] = [];
  if (matchers.includes('car')) criteriaSteps.push(CAR_STEP);
  if (matchers.includes('bounty')) criteriaSteps.push(FILTERS_STEP);

  // Plain order now — nothing seeds the name on the way through. See the note
  // above `NAME_STEP`.
  const leadingSteps = [AREA_STEP, ...criteriaSteps];

  return {
    id: 'alert',
    finalCtaLabel: 'Save alert',
    review: { title: 'Check your alert' },
    phases: [
      {
        id: 'alert',
        title: 'Your alert',
        steps: [...leadingSteps, NAME_STEP],
      },
    ],
  };
}
