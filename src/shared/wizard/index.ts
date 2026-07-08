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
export { useWizardController } from './useWizardController';
export { WizardScreen, type WizardScreenProps } from './WizardScreen';
