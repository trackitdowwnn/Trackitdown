/**
 * WHAT:  The report-a-bug wizard flow — three steps then review, built on the
 *        shared wizard framework.
 * WHY:   Rebuilt from a single long form on 2026-08-27 (owner request) to match
 *        the listing flow's shape. This is the framework's FIFTH consumer, so
 *        none of the chrome, gating, progress or review machinery is new here —
 *        a flow is data.
 *
 *        ⚠️ ONLY THE FIRST STEP ASKS FOR ANYTHING, and that is the whole
 *        design. The other four flows serve someone motivated: posting a car,
 *        adding a vehicle, claiming a sighting. A bug report is altruistic,
 *        filed by someone already annoyed that something broke, and every extra
 *        screen is a chance to abandon. Steps 2 and 3 take permissive schemas
 *        AND `optional`, so Next is enabled the moment they open — a one-line
 *        report is message → Next → Next → Send.
 *
 *        `optional` matters separately from the schema: without it the review
 *        screen's final CTA re-checks every step, so a step nobody answered
 *        would block submission from a screen that never said why.
 *
 *        ⚠️ THE DISCLOSURE PANEL IS THE REVIEW FOOTER, which is a better home
 *        than it had. On the old single screen it sat above the send button but
 *        far below the fields; here it is the last thing before "Send report",
 *        which is exactly where "this is what you are about to send" belongs.
 *        The framework's footer slot exists for flows with something to SHOW —
 *        `reviewValue` returns a string, so a list of rows could only ever be
 *        described, never rendered.
 * LINKS: src/shared/wizard/README.md (the contract);
 *        ../components/bugWizardSteps.tsx; ../components/BugDisclosurePanel.tsx;
 *        ../screens/ReportBugScreen.tsx (the host that submits).
 */

import { z } from 'zod';

import type { WizardFlow } from '@/shared/wizard';

import { BugDisclosurePanel } from '../components/BugDisclosurePanel';
import {
  BugContextStep,
  BugScreenshotsStep,
  BugWhatHappenedStep,
} from '../components/bugWizardSteps';
import type { BugReportAnswers } from './bugReportAnswers';
import { labelForArea } from './bugReportOptions';
import { BUG_FREQUENCIES, BUG_SEVERITIES } from './bugReportOptions';

/** The chosen option's label, or null when nothing was chosen. */
const labelFor = (
  options: { value: string; label: string }[],
  value: string | null,
): string | null => options.find((option) => option.value === value)?.label ?? null;

export function buildBugReportFlow(
  lines: { label: string; value: string }[],
): WizardFlow<BugReportAnswers> {
  return {
    id: 'report-bug',
    phases: [
      {
        id: 'report',
        title: 'Report a bug',
        // No phase intro: an intro screen is a screen, and this flow's whole
        // argument is that there are as few as possible.
        steps: [
          {
            id: 'what-happened',
            question: 'What went wrong?',
            helper: 'Tell us what happened and we’ll take a look.',
            component: BugWhatHappenedStep,
            // The ONLY gate in the flow. `.trim()` so whitespace is not an
            // answer — a report of " " helps nobody and cannot be triaged.
            schema: z.object({ message: z.string().trim().min(1) }),
            reviewLabel: 'What went wrong',
            reviewValue: (answers) => answers.message?.trim() || 'Not said',
          },
          {
            id: 'context',
            question: 'Where, and how bad?',
            helper: 'All optional — skip anything you’re not sure about.',
            component: BugContextStep,
            // Permissive on purpose: Next is enabled on arrival.
            schema: z.object({}),
            optional: true,
            reviewLabel: 'Where, and how bad',
            // ⚠️ ALL THREE IN ONE ROW, because a step gets exactly one review
            // row and this step asks three things. Spending it on the area
            // alone would leave severity and frequency invisible on the one
            // screen that exists to show what is about to be sent — and unlike
            // the disclosure panel's deliberate omission of them (they are the
            // reporter's own answers, not silent payload), invisible HERE would
            // mean unreviewable. Joined with the house middot; omitted rather
            // than padded with "Not said" three times, so a skipped step reads
            // as skipped rather than as three refusals.
            reviewValue: (answers) => {
              const parts = [
                labelForArea(answers.area ?? null),
                labelFor(BUG_SEVERITIES, answers.severity ?? null),
                labelFor(BUG_FREQUENCIES, answers.frequency ?? null),
              ].filter((part): part is string => Boolean(part));
              return parts.length > 0 ? parts.join(' · ') : 'Not said';
            },
          },
          {
            id: 'screenshots',
            question: 'Add a screenshot?',
            helper: 'Only if it helps — and check what’s in it first.',
            component: BugScreenshotsStep,
            schema: z.object({}),
            optional: true,
            reviewLabel: 'Screenshots',
            reviewValue: (answers) => {
              const count = answers.shots?.length ?? 0;
              if (count === 0) return 'None';
              return count === 1 ? '1 image' : `${count} images`;
            },
          },
        ],
      },
    ],
    review: {
      title: 'Check and send',
      footer: (answers) => (
        <BugDisclosurePanel
          lines={lines}
          area={answers.area ?? null}
          shots={answers.shots?.length ?? 0}
        />
      ),
    },
    // Never a vague "Finish" — the framework's own rule, and on this screen the
    // word "Send" is the one that says the report leaves the device.
    finalCtaLabel: 'Send report',
  };
}

