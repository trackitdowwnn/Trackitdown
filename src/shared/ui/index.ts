/**
 * WHAT:  Public surface of the shared UI kit.
 * WHY:   Features import components from '@/shared/ui' and never reach into
 *        individual files, keeping the design system swappable.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components).
 */

export { AppImage, type AppImageProps } from './AppImage';
export { BottomSheet, type BottomSheetProps, type BottomSheetRef } from './BottomSheet';
export { BountyTag, type BountyTagProps } from './BountyTag';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export {
  ChoiceChips,
  type ChoiceChipOption,
  type ChoiceChipsProps,
} from './ChoiceChips';
export {
  DEFAULT_DATE_TIME_PRESETS,
  DateTimeField,
  type DateTimeFieldProps,
  type DateTimePreset,
} from './DateTimeField';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { FullscreenLoader, type FullscreenLoaderProps } from './FullscreenLoader';
export {
  LocationPicker,
  LocationPickerModal,
  UK_DEFAULT_REGION,
  locationValueSchema,
  noopLocationServices,
  settledLocationSchema,
  type LocationOptionSlot,
  type LocationPickerMap,
  type LocationPickerModalProps,
  type LocationPickerProps,
  type MapComponentProps,
} from './LocationPicker';
export { PlateChip, type PlateChipProps } from './PlateChip';
export { SelectField, type SelectFieldProps } from './SelectField';
export { SelectScreen, type SelectScreenProps } from './SelectScreen';
export { type SelectOption } from './selectOptions';
export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
export {
  SkeletonVehicleCard,
  VehicleCard,
  type VehicleCardProps,
} from './VehicleCard';
