/**
 * WHAT:  Public surface of the shared generic hooks.
 * WHY:   Features and shared UI import from '@/shared/hooks' rather than
 *        individual files, matching the other shared barrels.
 * LINKS: docs/ARCHITECTURE.md (shared/hooks).
 */

export { useAndroidKeyboardHeight } from './useAndroidKeyboardHeight';
export { useFullscreenLoader } from './useFullscreenLoader';
export { useTimeAgo } from './useTimeAgo';
