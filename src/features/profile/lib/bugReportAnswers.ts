/**
 * WHAT:  The report-a-bug wizard's answers shape.
 * WHY:   Its own module so the step components and the flow can both import it
 *        without the steps importing the flow that renders them (a cycle the
 *        bundler tolerates and nobody enjoys debugging).
 * LINKS: ./bugReportFlow.tsx; ../components/bugWizardSteps.tsx.
 */

import type { PickedPhoto } from '@/shared/ui';

import type { BugArea, BugFrequency, BugSeverity } from './bugReportOptions';

export interface BugReportAnswers {
  /** The only required answer. */
  message: string;
  expected: string;
  /** Pre-filled from the last tab visited — a tab NAME, never a route. */
  area: BugArea | null;
  severity: BugSeverity | null;
  frequency: BugFrequency | null;
  shots: PickedPhoto[];
}
