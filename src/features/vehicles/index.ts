/**
 * WHAT:  Public API of the vehicles feature — the post-detail screen and its
 *        types.
 * WHY:   Route files and other features import ONLY from here, never from
 *        internal paths (ARCHITECTURE.md rule 1).
 * LINKS: src/features/vehicles/README.md.
 */

export { PostDetailScreen, type PostDetailScreenProps } from './screens/PostDetailScreen';
export type { PostDetail, PostDetailResult, ClosedReason } from './types';
