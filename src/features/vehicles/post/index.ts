/**
 * WHAT:  Public surface of the post-a-car feature. For now it exposes the data
 *        layer (the create_post write path) and the wizard answer/param types;
 *        the flow config, step components, and route screen land next pass and
 *        will be re-exported here.
 * WHY:   Other code (the My Cars entry point, the wizard route) imports from
 *        '@/features/vehicles/post' and never reaches into internal files,
 *        keeping the feature boundary swappable per ARCHITECTURE.md.
 * LINKS: src/features/vehicles/post/README.md;
 *        src/features/vehicles/post/api/postApi.ts;
 *        src/features/vehicles/post/types.ts.
 */

export {
  CREATE_POST_ERROR_MESSAGES,
  PostSubmissionError,
  buildCreatePostParams,
  createPost,
  submitPost,
  uploadPostPhoto,
  uploadVerificationDocument,
  type SubmitPostOptions,
  type SubmitReadyAnswers,
} from './api/postApi';
export { PostACarScreen } from './screens/PostACarScreen';
export type {
  CreatePostParams,
  CreatePostResult,
  KeysTaken,
  LastSeenLocation,
  PostACarAnswers,
  StolenFrom,
} from './types';
