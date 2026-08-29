/**
 * WHAT:  The ONE mapping from notification kind to how its feed row looks:
 *        leading icon, icon TONE, and whether the row is a needs-attention
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
 *        TONES, NOT HEXES (2026-08-09, dark mode): this is a plain logic
 *        module with no React in it, so it cannot read the active palette —
 *        importing `colors` here would bake the LIGHT hex into the table the
 *        instant the module evaluated, and the dark palette would never reach
 *        the icons. The table names the MEANING ('success', 'warning', …) and
 *        NotificationRowItem resolves it against the live palette at render.
 *        The design decision stays here; only the hex lookup moved.
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

import type { NotificationKind } from './notificationKinds';

/**
 * What an icon MEANS, which the consuming component turns into a hex.
 * `danger` has no kind today — it is here so the vocabulary is the design
 * system's, not "whatever the current nine rows happen to need".
 */
export type NotificationTone = 'neutral' | 'warning' | 'success' | 'danger';

/**
 * ⚠️ A DISCRIMINATED UNION, so a needs-attention kind CANNOT be added without
 * its words. The accent bar alone was colour-only status, which the design
 * system forbids outright — and it was also unreadable: a 3pt warning stripe
 * says "something", never "what". Making the label part of the same branch as
 * the flag means the next author to set `needsAttention: true` gets a compile
 * error until they decide what the row should say, rather than shipping a
 * silent stripe.
 */
export type CenterRowMeta = {
  Icon: LucideIcon;
  /** The icon's meaning — resolved to a palette hue by the row component. */
  tone: NotificationTone;
} & (
  | { needsAttention: false }
  | {
      /** Loud-while-unread: the warning accent bar AND the label below. */
      needsAttention: true;
      /**
       * The action, in the reader's words, shown on the row and spoken by the
       * screen reader.
       *
       * ⚠️ NAME THE ACTION, NOT THE STATE. "Needs your attention" is what the
       * bar already failed to say. And no durations: the row is a snapshot that
       * may be read hours later, so a label promising "72 hours" goes stale
       * between render and read.
       */
      attentionLabel: string;
    }
);

export const CENTER_ROW_META: Record<NotificationKind, CenterRowMeta> = {
  alert: { Icon: Bell, tone: 'neutral', needsAttention: false },
  sighting: { Icon: Eye, tone: 'neutral', needsAttention: false },
  recovery: { Icon: CheckCircle2, tone: 'success', needsAttention: false },
  // The money is sitting there and only the reader can unlock it, so the label
  // is the errand rather than the good news the title already carries.
  credited: {
    Icon: Banknote,
    tone: 'warning',
    needsAttention: true,
    attentionLabel: 'Add your bank details',
  },
  payout_sent: { Icon: Banknote, tone: 'success', needsAttention: false },
  // "Contest" is the word SightingDisputeScreen already uses with these
  // spotters ("This one can’t be contested any more"), so the row and the
  // screen it opens speak the same language.
  closed_uncredited: {
    Icon: Hourglass,
    tone: 'warning',
    needsAttention: true,
    attentionLabel: 'You can contest this',
  },
  dispute_upheld: { Icon: BadgeCheck, tone: 'success', needsAttention: false },
  dispute_rejected: { Icon: Scale, tone: 'neutral', needsAttention: false },
  // Good news that isn't YOUR good news: the car went home, someone else was
  // credited. CheckCircle2 like `recovery` because that is what happened, but
  // neutral ink rather than success green — the green ones are the rows where
  // the reader personally won, and colouring this one to match would overclaim.
  // Never needsAttention: there is nothing to do about it.
  not_credited: { Icon: CheckCircle2, tone: 'neutral', needsAttention: false },
  // The owner looked and said yes. For most spotters this is the ONLY
  // acknowledgement they will ever get — the bounty goes to one person and the
  // car goes home once — so it takes the success hue rather than neutral: it
  // genuinely is the reader's own good news.
  //
  // Never needsAttention. It is recognition, not a task, and an accent bar
  // would turn a thank-you into a chore.
  sighting_confirmed: { Icon: BadgeCheck, tone: 'success', needsAttention: false },
  // Never rendered — chat is excluded from the center — but the map is total
  // over NotificationKind so a stray row degrades to a sane row, not a crash.
  message: { Icon: MessageCircle, tone: 'neutral', needsAttention: false },
};
