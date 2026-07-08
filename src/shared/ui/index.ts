/**
 * WHAT:  Public surface of the shared UI kit.
 * WHY:   Features import components from '@/shared/ui' and never reach into
 *        individual files, keeping the design system swappable.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components).
 */

export { BottomSheet, type BottomSheetProps, type BottomSheetRef } from './BottomSheet';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
