/**
 * WHAT:  Public API of the vehicles feature — the post-detail screen and its
 *        types, plus the make/model pickers reused by other features (the
 *        search surface).
 * WHY:   Route files and other features import ONLY from here, never from
 *        internal paths (ARCHITECTURE.md rule 1). The make/model pickers are
 *        exposed because the search-map surface reuses them; the underlying
 *        make/model DATASETS are shared reference data in src/shared/lib.
 * LINKS: src/features/vehicles/README.md.
 */

export { MyCarsScreen } from './screens/MyCarsScreen';
export { PostAboutScreen } from './screens/PostAboutScreen';
export { PostDetailScreen, type PostDetailScreenProps } from './screens/PostDetailScreen';
export { MakeField } from './post/components/MakeField';
export { ModelField } from './post/components/ModelField';
export type { PostDetail, PostDetailResult, ClosedReason } from './types';
