/**
 * WHAT:  Public surface of the shared UI kit.
 * WHY:   Features import components from '@/shared/ui' and never reach into
 *        individual files, keeping the design system swappable.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components).
 */

export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
