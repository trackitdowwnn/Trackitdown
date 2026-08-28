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
export { PostStatsScreen, type PostStatsScreenProps } from './screens/PostStatsScreen';
export { RecoverPostScreen } from './screens/RecoverPostScreen';
export { PostDetailScreen, type PostDetailScreenProps } from './screens/PostDetailScreen';
export { MakeField } from './post/components/MakeField';
export { ModelField } from './post/components/ModelField';
// Car taxonomy. Was posting-only; features/notifications is now a second
// consumer (alert criteria filter on the SAME values posts store, so they must
// come from one list or an alert silently matches nothing). Makes and models
// already live in shared/lib — these two stayed here and are exported rather
// than moved, to keep the posting wizard's imports untouched.
// `swatchForName` joined them 2026-08-27 for features/sightings, which draws a
// report's car as its colour: the swatch hex is the only picture that screen is
// allowed to have. Exported rather than reimplemented so one lookup, one
// trimming rule and one `light` flag serve the grid and the tile alike.
export {
  CAR_COLOURS,
  swatchForName,
  glyphInkFor,
  type CarColour,
} from './post/lib/carColours';
export { BODY_TYPE_OPTIONS, BODY_TYPE_UNKNOWN } from './post/lib/bodyTypes';
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
// Exported so the GARAGE can wrap it (PhotosWithPlateScanStep). vehicles must
// stay ignorant of the garage, so the override happens on the garage's side.
export { PhotosStep } from './post/components/postSteps';
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
export { StatsSparkline } from './components/StatsSparkline';
export type { SparklineBar } from './lib/postStatsModel';
