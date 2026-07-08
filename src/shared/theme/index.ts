/**
 * WHAT:  Barrel for the design-system tokens.
 * WHY:   UI imports from '@/shared/theme' (one path) rather than reaching into
 *        individual token files.
 * LINKS: docs/DESIGN_SYSTEM.md.
 */

export { colors, type ColorToken } from './colors';
export { motion, type MotionToken } from './motion';
export { spacing, type SpacingToken } from './spacing';
export { radii, type RadiusToken } from './radii';
export { sizes, type SizeToken } from './sizes';
export { opacity, type OpacityToken } from './opacity';
export { typography, type TypographyToken } from './typography';
