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

// MyCarsScreen moved to features/garage when the garage was built — a saved car
// is not a post. MyPosts stays here.
export { MyPostsScreen } from './screens/MyPostsScreen';
export { PostAboutScreen } from './screens/PostAboutScreen';
export { PostDetailScreen, type PostDetailScreenProps } from './screens/PostDetailScreen';
export { MakeField } from './post/components/MakeField';
export { ModelField } from './post/components/ModelField';
export type { PostDetail, PostDetailResult, ClosedReason } from './types';
// The report-sighting wizard reads the post's registered marks through this
// (deferred-imported) to offer them as confirmable checkmarks.
export { fetchPostDetail } from './api/vehicleApi';
// The shared vehicle-identity slice. features/garage collects EXACTLY this data,
// so it consumes the type (and, from step 5, the step list) from here rather
// than duplicating it. One-way only: vehicles must never import the garage —
// see src/features/garage/types.ts for why that direction is load-bearing.
export type { DistinctiveFeature } from './post/lib/distinctiveFeatures';
export { buildVehicleSteps } from './post/lib/vehicleSteps';
export type { VehicleAnswers, VehicleStepsOptions } from './post/lib/vehicleSteps';
// The posting flow + its seed, so the garage can build a prefilled VARIANT of it
// (its vehicle phase collapsed to a confirm step) and hand it back to
// PostACarScreen. Vehicles stays unaware that a garage exists.
export { POST_A_CAR_INITIAL_ANSWERS, postACarFlow } from './post/postACarFlow';
export { PostACarScreen, type PostACarScreenProps } from './post/screens/PostACarScreen';
export type { PostACarAnswers } from './post/types';
// The garage saves its photos through the POSTING upload path on purpose: the
// object lands in post-photos under the caller's own folder, so create_post
// accepts the URL later with no re-upload.
export {
  CREATE_POST_ERROR_MESSAGES,
  PostSubmissionError,
  uploadPostPhoto,
} from './post/api/postApi';
