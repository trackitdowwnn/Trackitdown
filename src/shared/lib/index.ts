/**
 * WHAT:  Public surface of the shared pure utilities.
 * WHY:   Features and shared UI import from '@/shared/lib' rather than
 *        individual files, matching the other shared barrels.
 * LINKS: docs/ARCHITECTURE.md (shared/lib).
 */

export { formatDateLabel, formatDateTimeLabel, formatMonthYear } from './dateTimeLabel';
export { isValidEmail } from './email';
export { LEGAL_URLS } from './legal';
export { createLogger, type LogEntry, type LogSink } from './logger';
export { formatPounds } from './money';
export { timeAgo } from './timeAgo';
