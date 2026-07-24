/**
 * WHAT:  Public surface of the wizard framework.
 * WHY:   Features declare a WizardFlow and render WizardScreen; the internals
 *        (reducer, chrome pieces) stay private so the framework can evolve
 *        without breaking consuming flows.
 * LINKS: src/shared/wizard/README.md.
 */

export type {
  WizardFlow,
  WizardPhase,
  WizardPhaseIntro,
  WizardStep,
  WizardStepProps,
} from './types';
// flattenFlow is public for flow smoke tests (each flow pins its own shape —
// see the WizardStep.schema LIMITATION note); the reducer/chrome stay private.
// resolveQuestion turns a step's question (string or answers→string) into text.
export { flattenFlow, resolveQuestion } from './navigation';
export { useWizardController } from './useWizardController';
export { WizardScreen, type WizardScreenProps } from './WizardScreen';
