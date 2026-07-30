/**
 * WHAT:  Public surface of the sightings feature.
 * WHY:   Other code (routes, the post-detail entry points) imports from here
 *        only — never from the feature's internals (ARCHITECTURE.md rule 1).
 * LINKS: src/features/sightings/README.md.
 */

export { ReportSightingScreen, type ReportSightingScreenProps } from './screens/ReportSightingScreen';
export { PostSightingsScreen, type PostSightingsScreenProps } from './screens/PostSightingsScreen';
export { SightingDetailScreen, type SightingDetailScreenProps } from './screens/SightingDetailScreen';
export { PostSightingsSection, type PostSightingsSectionProps } from './components/PostSightingsSection';
export type { OwnerSighting, ReportSightingAnswers, SightingContextFlag } from './types';
