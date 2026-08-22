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
export { NudgeRow, type NudgeRowProps } from './NudgeRow';
export { ToastProvider, useToast, useOptionalToast, type ToastKind } from './Toast';
export { BottomSheet, type BottomSheetProps, type BottomSheetRef } from './BottomSheet';
export { BountyTag, bountyLabel, NO_BOUNTY_LABEL, type BountyTagProps } from './BountyTag';
export { BrandLoader, LOADER_PHRASES, type BrandLoaderProps } from './BrandLoader';
export { BrandMark, type BrandMarkProps } from './BrandMark';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export {
  CameraCapture,
  type CameraCaptureProps,
  type EvidencePhoto,
} from './CameraCapture';
export {
  CardSelect,
  type CardSelectOption,
  type CardSelectProps,
} from './CardSelect';
export {
  CardSelectMulti,
  type CardSelectMultiOption,
  type CardSelectMultiProps,
} from './CardSelectMulti';
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
  SurfaceTabs,
  type SurfaceTabOption,
  type SurfaceTabsProps,
} from './SurfaceTabs';
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
export { MoneyRangeSlider, type MoneyRange, type MoneyRangeSliderProps } from './MoneyRangeSlider';
export {
  PhotoGridPicker,
  defaultOwnerPhotoCopy,
  photoListSchema,
  type GridPhoto,
  type PhotoGridCopy,
  type PhotoGridPickerProps,
  type PhotoTileStatus,
  type PickedPhoto,
} from './PhotoGridPicker';
export {
  PermissionPrimer,
  type PermissionPrimerContent,
  type PermissionPrimerProps,
} from './PermissionPrimer';
export { PlateChip, spellPlate, type PlateChipProps } from './PlateChip';
export { RadiusSlider, type RadiusSliderProps } from './RadiusSlider';
export { SafetyNotice, SAFETY_NOTICE_BODY, SAFETY_NOTICE_TITLE } from './SafetyNotice';
export {
  MediaIdentityCard,
  type MediaIdentityCardProps,
} from './MediaIdentityCard';
export { Screen, ThemedRefreshControl, type ScreenProps } from './Screen';
export { SelectField, type SelectFieldProps } from './SelectField';
export { SelectScreen, type SelectScreenProps } from './SelectScreen';
export { type SelectOption } from './selectOptions';
export { StatusBadge, statusBadgeLabel, type StatusBadgeProps } from './StatusBadge';
export { StepSkipButton, type StepSkipButtonProps } from './StepSkipButton';
export { TextField, type TextFieldProps, type TextFieldVariant } from './TextField';
export { HostTextInput, TextInputHostContext } from './TextInputHost';
export {
  SkeletonVehicleCard,
  VehicleCard,
  type VehicleCardProps,
} from './VehicleCard';
