/**
 * WHAT:  Public surface of the shared pure utilities.
 * WHY:   Features and shared UI import from '@/shared/lib' rather than
 *        individual files, matching the other shared barrels.
 * LINKS: docs/ARCHITECTURE.md (shared/lib).
 */

export {
  CAR_COLOURS,
  colourChangePatch,
  colourFromDvla,
  glyphInkFor,
  isNoteColour,
  swatchForName,
  GLYPH_ON_DARK,
  GLYPH_ON_LIGHT,
  type CarColour,
} from './carColours';
export { groupByDay, type DayGrouped } from './dayGroups';
export {
  formatDateLabel,
  formatDateLabelCompact,
  formatClock,
  formatDateTimeLabel,
  formatMonthYear,
} from './dateTimeLabel';
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
export { mapPinUrl } from './mapsLink';
export {
  bountyParam,
  estimateRefundPence,
  formatPounds,
  LISTING_FEE_PENCE,
  NO_BOUNTY_PARAM,
} from './money';
export { timeAgo } from './timeAgo';
