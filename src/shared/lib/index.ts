/**
 * WHAT:  Public surface of the shared pure utilities.
 * WHY:   Features and shared UI import from '@/shared/lib' rather than
 *        individual files, matching the other shared barrels.
 * LINKS: docs/ARCHITECTURE.md (shared/lib).
 */

export { formatDateLabel, formatDateTimeLabel, formatMonthYear } from './dateTimeLabel';
export {
  METRES_PER_MILE,
  RADIUS_MAX_MILES,
  RADIUS_MIN_MILES,
  metresToMiles,
  milesToMetres,
} from './distance';
export { isValidEmail } from './email';
export { legalHref, LEGAL_PUBLIC_URLS, type LegalDoc } from './legal';
export { createLogger, type LogEntry, type LogSink } from './logger';
export { formatPounds } from './money';
export { samplePhotos } from './devSampleImages';
export { timeAgo } from './timeAgo';
