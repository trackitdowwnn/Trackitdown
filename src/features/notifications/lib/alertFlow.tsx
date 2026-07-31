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
 *        ../components/alertSteps.tsx (the components); ./alertName.ts (the
 *        name suggestion); ./alertMatchers.ts (criteria ↔ matchers);
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
import { suggestAlertName } from './alertName';

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

/**
 * Seed the name from everything chosen so far, on the way INTO the name step.
 *
 * This MUST hang off whichever step immediately precedes `name`, which depends
 * on the matchers — it used to live on `filters`, a step that no longer always
 * exists. Attaching it to every step instead would be worse than useless: the
 * first one to run would set a name, and the `if (name) return` guard would
 * then stop every later step from folding its own answer in, so an alert
 * narrowed to blue BMWs would still be called "5 miles around Luton".
 *
 * `||` not `??` so a cleared field re-suggests, and an existing name (an edit,
 * or a name typed then revisited via the review spur) is never overwritten.
 */
function withNameSuggestion(step: WizardStep<AlertAnswers>): WizardStep<AlertAnswers> {
  return {
    ...step,
    onContinue: async (answers) => {
      if (answers.name?.trim()) return;
      return {
        name: suggestAlertName(
          {
            make: answers.make ?? null,
            model: answers.model ?? null,
            colour: answers.colour ?? null,
            bodyType: answers.bodyType ?? null,
            minBountyPence: answers.minBountyPence ?? null,
            recencyDays: answers.recencyDays ?? null,
          },
          answers.placeLabel ?? null,
          answers.radiusMiles ?? DEFAULT_ALERT_RADIUS_MILES,
        ),
      };
    },
  };
}

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
  reviewValue: (answers) =>
    `${answers.radiusMiles ?? DEFAULT_ALERT_RADIUS_MILES} miles around ${
      answers.placeLabel?.trim() || 'the pin'
    }`,
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
  helper: "So you can tell it apart from your others. We've suggested one.",
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

  // The name is seeded by whichever step sits immediately before it: the last
  // criteria step when there is one, otherwise the area step (an area-only
  // alert is "5 miles around Luton", which is all there is to say about it).
  const leadingSteps =
    criteriaSteps.length > 0
      ? [AREA_STEP, ...criteriaSteps.slice(0, -1), withNameSuggestion(criteriaSteps[criteriaSteps.length - 1])]
      : [withNameSuggestion(AREA_STEP)];

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
