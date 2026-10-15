/**
 * WHAT:  PayoutsHero — the top of the Payouts screen while a reward is in
 *        play: the chip, the amount at hero scale, the car it was for, and
 *        ONE line saying where the money is. Once per payout, the paid moment:
 *        a success tick and "Thanks for helping".
 * WHY:   2026-10-14 (payout experience redesign, PR5; owner: "the amount is
 *        the hero"). The old earned card vanished exactly when the money
 *        started moving (it hid on `ready`), and the state was said again in
 *        a title, a paragraph and a pill below it. Now the figure stays put
 *        from "add your details" to "paid", and the state is said once.
 *
 *        COLOUR SPARINGLY (owner): the chip's dot and the paid tick are the
 *        only status colour on the screen. Everything else is ink.
 *
 *        ONE accessible stop: "You've earned £190, for helping find a blue
 *        BMW. Sending your reward. On its way." Three stops would deliver
 *        the number without the words that give it meaning.
 * LINKS: ../lib/payoutView.ts (PayoutHero); ../lib/payoutCopy.ts;
 *        ../screens/PayoutsScreen.tsx; docs/DESIGN_SYSTEM.md (display, displayFontScaleCap).
 */

import { Check } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { formatPounds } from '@/shared/lib/money';
import {
  displayFontScaleCap,
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { StatusPill } from '@/shared/ui';

import { COPY } from '../lib/payoutCopy';
import type { ChipTone, PayoutHero } from '../lib/payoutView';

export interface PayoutsHeroProps {
  hero: PayoutHero;
  chip: { label: string; tone: ChipTone };
  /** The paid moment — shown once per payout (see paidMomentStorage). */
  celebrating?: boolean;
}

export function PayoutsHero({ hero, chip, celebrating = false }: PayoutsHeroProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const amount = hero.amountPence !== null ? formatPounds(hero.amountPence) : null;
  // The car is "for helping find a blue BMW"; thanked, it reads straight on.
  const subtitle = celebrating
    ? hero.carLabel
      ? `Thanks ${hero.carLabel}`
      : COPY.thanks
    : hero.carLabel;

  const spoken = [
    amount ? `${COPY.earned} ${amount}${subtitle && !celebrating ? `, ${subtitle}` : ''}.` : null,
    celebrating && subtitle ? `${subtitle}.` : null,
    `${hero.status}.`,
    `${chip.label}.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <View
      style={styles.hero}
      // A paragraph, not a heading: "Payouts" is the screen's header, and a
      // four-sentence stop in the headings rotor is clutter (UI review).
      accessible
      accessibilityLabel={spoken}
      testID="payouts-hero"
    >
      {celebrating ? (
        <View style={styles.tick} testID="payouts-paid-moment">
          <Check size={sizes.icon} color={palette.textOnPrimary} strokeWidth={3} />
        </View>
      ) : (
        <StatusPill label={chip.label} tone={chip.tone} testID="payouts-chip" />
      )}
      {amount ? (
        <View>
          <Text style={styles.label}>{COPY.earned}</Text>
          <Text style={styles.amount} maxFontSizeMultiplier={displayFontScaleCap}>
            {amount}
          </Text>
        </View>
      ) : null}
      {subtitle ? (
        <Text style={celebrating ? styles.thanks : styles.subtitle}>{subtitle}</Text>
      ) : null}
      {/* Without a figure (details being checked, nothing credited yet), the
          status line is the headline. */}
      <Text style={amount ? styles.status : styles.statusAlone}>{hero.status}</Text>
    </View>
  );
}

const TICK = sizes.touchTarget;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    hero: {
      gap: spacing.sm,
    },
    // The success hue as a FILL, once — the screen's one celebratory mark.
    tick: {
      width: TICK,
      height: TICK,
      borderRadius: radii.full,
      backgroundColor: c.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // `display`, the in-page hero value (DESIGN_SYSTEM: displayHero is the
    // onboarding headline's alone), in `accent` — large value type.
    amount: {
      ...typography.display,
      color: c.accent,
    },
    subtitle: {
      ...typography.body,
      color: c.textSecondary,
    },
    thanks: {
      ...typography.heading,
      color: c.textPrimary,
    },
    status: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    statusAlone: {
      ...typography.title,
      color: c.textPrimary,
    },
  });
