/**
 * WHAT:  Public surface of the shared UI kit.
 * WHY:   Features import components from '@/shared/ui' and never reach into
 *        individual files, keeping the design system swappable.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components).
 */

export {
  AppHeader,
  AppHeaderButton,
  HEADER_BAR_HEIGHT,
  type AppHeaderButtonProps,
  type AppHeaderProps,
} from './AppHeader';
export { AppImage, type AppImageProps } from './AppImage';
export {
  AppTabBar,
  TabBadgeProvider,
  useTabBadges,
  type AppTabBarProps,
  type AppTabConfig,
  type TabBarAction,
} from './AppTabBar';
export { badgeDisplay, type BadgeValue } from './appTabBarModel';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmDialogRef,
} from './ConfirmDialog';
export { ListRow, type ListRowProps } from './ListRow';
export { ToastProvider, useToast, type ToastKind } from './Toast';
export { BottomSheet, type BottomSheetProps, type BottomSheetRef } from './BottomSheet';
export { BountyTag, type BountyTagProps } from './BountyTag';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export {
  ChoiceChips,
  type ChoiceChipOption,
  type ChoiceChipsProps,
} from './ChoiceChips';
export {
  ChoiceChipsMulti,
  type ChoiceChipMultiOption,
  type ChoiceChipsMultiProps,
} from './ChoiceChipsMulti';
export {
  DEFAULT_DATE_TIME_PRESETS,
  DateTimeField,
  type DateTimeFieldProps,
  type DateTimePreset,
} from './DateTimeField';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { ErrorState, type ErrorStateProps } from './ErrorState';
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
export {
  MoneySlider,
  defaultBountyPanelCopy,
  penceAmountSchema,
  type MoneySliderPanelCopy,
  type MoneySliderProps,
  type SnapStep,
} from './MoneySlider';
export {
  PhotoGridPicker,
  defaultOwnerPhotoCopy,
  photoListSchema,
  type PhotoGridCopy,
  type PhotoGridPickerProps,
  type PhotoTileStatus,
  type PickedPhoto,
} from './PhotoGridPicker';
export { PlateChip, type PlateChipProps } from './PlateChip';
export { ReadMore, type ReadMoreProps } from './ReadMore';
export { SafetyNotice } from './SafetyNotice';
export { Screen, ThemedRefreshControl, type ScreenProps } from './Screen';
export { SelectField, type SelectFieldProps } from './SelectField';
export { SelectScreen, type SelectScreenProps } from './SelectScreen';
export { type SelectOption } from './selectOptions';
export { StatusBadge, statusBadgeLabel, type StatusBadgeProps } from './StatusBadge';
export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
export {
  SkeletonVehicleCard,
  VehicleCard,
  type VehicleCardProps,
} from './VehicleCard';
