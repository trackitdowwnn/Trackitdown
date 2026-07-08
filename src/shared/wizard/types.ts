/**
 * WHAT:  Types for the wizard framework — a flow described as data (phases →
 *        steps), generic over the flow's answers shape, plus the flattened
 *        screen descriptors the navigation reducer walks.
 * WHY:   Flows are configuration, not code: consuming features declare
 *        phases/steps/schemas and the framework renders everything else.
 *        The generic `TAnswers` threads through so a flow's step components
 *        and schemas are checked against its own answer shape.
 * LINKS: src/shared/wizard/README.md; src/shared/wizard/navigation.ts
 *        (flattening + reducer); docs/DESIGN_SYSTEM.md (Forms).
 */

import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';

/** Props every step screen component receives from the framework. */
export interface WizardStepProps<TAnswers> {
  /** The single serializable answers object for the whole flow. */
  answers: Partial<TAnswers>;
  /** Merge a partial update into the answers (one step edits its slice). */
  setAnswers: (patch: Partial<TAnswers>) => void;
}

export interface WizardStep<TAnswers> {
  id: string;
  /** The ONE question/task this screen asks, display-scale typography. */
  question: string;
  /** Optional supporting sentence under the question. */
  helper?: string;
  component: ComponentType<WizardStepProps<TAnswers>>;
  /**
   * Validates this step's slice of the answers; Next is disabled until
   * `schema.safeParse(answers)` succeeds. Object schemas ignore keys owned
   * by other steps, so each step declares only its own fields.
   *
   * LIMITATION: TypeScript cannot tie the schema's keys to TAnswers (any
   * object satisfies Partial<TAnswers>), so a typo'd key compiles but the
   * step can never validate — cover each flow's steps with a smoke test.
   */
  schema: z.ZodType;
  /** Label for this answer on the review screen; defaults to `question`. */
  reviewLabel?: string;
  /** Renders this step's answer as review text; omit to hide from review. */
  reviewValue?: (answers: Partial<TAnswers>) => string;
}

export interface WizardPhaseIntro {
  /** Big headline, e.g. "Tell us about your car". */
  headline: string;
  /** One supporting sentence. */
  body: string;
  /** Illustration/image slot rendered above the headline. */
  illustration?: ReactNode;
  /** Footer button label; defaults to "Get started" / "Continue". */
  ctaLabel?: string;
}

export interface WizardPhase<TAnswers> {
  id: string;
  /** Short phase name, shown on intros and review group headers. */
  title: string;
  /** Full-screen Airbnb-style intro shown before the phase's first step. */
  intro: WizardPhaseIntro;
  steps: WizardStep<TAnswers>[];
}

export interface WizardFlow<TAnswers> {
  id: string;
  phases: WizardPhase<TAnswers>[];
  /** Append the built-in review step after the last phase. */
  review?: {
    /** Review screen heading; defaults to "Check your answers". */
    title?: string;
  };
  /**
   * Label of the very last screen's primary button — high-information per
   * flow ("Publish", "Pay & submit"), never a vague "Finish".
   */
  finalCtaLabel: string;
}

/** A flow flattened into the ordered screens the user walks through. */
export type WizardScreenDescriptor<TAnswers> =
  | { kind: 'intro'; phaseIndex: number }
  | {
      kind: 'step';
      phaseIndex: number;
      stepIndexInPhase: number;
      step: WizardStep<TAnswers>;
    }
  | { kind: 'review' };
