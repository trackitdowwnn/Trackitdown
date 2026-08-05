/**
 * WHAT:  The ONE mapping from notification kind to how its feed row looks:
 *        leading icon, icon hue, and whether the row is a needs-attention
 *        kind (kept visually loud while unread).
 * WHY:   Nine kinds rendered ad hoc would drift into nine opinions. One table,
 *        and the design rules live where they can be read: the circle is
 *        always neutral `surfaceSubtle` (the palette is monochrome — no sage,
 *        no terracotta, by owner decision 2026-08-05); the ICON carries the
 *        meaning, in the three semantic hues the design system allows —
 *        success for good news, warning for "this needs you" (per
 *        DESIGN_SYSTEM: warning is dot/icon/border only, never body text),
 *        neutral ink for information. Colour-blind-safe because the icon
 *        SHAPE distinguishes kinds, never hue alone.
 *
 *        NEEDS-ATTENTION: `credited` (money waiting for bank details) and
 *        `closed_uncredited` (a 72-hour window is running) are the two kinds
 *        that must not fade into the scroll — they keep a warning accent bar
 *        while UNREAD. Unread-based, not resolution-based: tracking "resolved"
 *        would need per-kind server queries for a treatment whose whole job
 *        is "don't let me miss this".
 * LINKS: ./notificationKinds.ts; ../components/NotificationRowItem.tsx (the
 *        only consumer); docs/DESIGN_SYSTEM.md (colour rules).
 */

import {
  BadgeCheck,
  Banknote,
  Bell,
  CheckCircle2,
  Eye,
  Hourglass,
  MessageCircle,
  Scale,
  type LucideIcon,
} from 'lucide-react-native';

import { colors } from '@/shared/theme';

import type { NotificationKind } from './notificationKinds';

export interface CenterRowMeta {
  Icon: LucideIcon;
  /** The icon's hue — one of the three semantic colours or neutral ink. */
  iconColor: string;
  /** Loud-while-unread: the warning accent bar. */
  needsAttention: boolean;
}

export const CENTER_ROW_META: Record<NotificationKind, CenterRowMeta> = {
  alert: { Icon: Bell, iconColor: colors.textSecondary, needsAttention: false },
  sighting: { Icon: Eye, iconColor: colors.textSecondary, needsAttention: false },
  recovery: { Icon: CheckCircle2, iconColor: colors.success, needsAttention: false },
  credited: { Icon: Banknote, iconColor: colors.warning, needsAttention: true },
  payout_sent: { Icon: Banknote, iconColor: colors.success, needsAttention: false },
  closed_uncredited: { Icon: Hourglass, iconColor: colors.warning, needsAttention: true },
  dispute_upheld: { Icon: BadgeCheck, iconColor: colors.success, needsAttention: false },
  dispute_rejected: { Icon: Scale, iconColor: colors.textSecondary, needsAttention: false },
  // Never rendered — chat is excluded from the center — but the map is total
  // over NotificationKind so a stray row degrades to a sane row, not a crash.
  message: { Icon: MessageCircle, iconColor: colors.textSecondary, needsAttention: false },
};
