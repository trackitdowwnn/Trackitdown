/**
 * WHAT:  "Spotted by" on the owner's sighting page: the spotter's avatar and
 *        first name, their record ("12 sightings · 4 confirmed by owners ·
 *        1 recovery"), "Member since July 2026", a "View profile" link, and —
 *        while the owner hasn't decided yet — "Message {name}", so they can
 *        ask before they answer "Is this your car?".
 * WHY:   How much to trust a sighting is partly how much to trust who sent
 *        it, and the old row showed only reports and recoveries, with the
 *        rest a tap away. Once the owner has decided, Message moves to the
 *        page's pinned bar instead, so it never appears twice.
 *
 *        PRIVACY (§1): first name and the reputation passport only — no id,
 *        no surname, no contact path. "Message" opens chat by SIGHTING id.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/features/profile (PublicProfileSheet, opened by the screen);
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatMonthYear } from '@/shared/lib';
import {
  cardSurface,
  opacity,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import { Avatar, Button } from '@/shared/ui';

import type { OwnerSighting } from '../types';

export interface SightingSpotterCardProps {
  spotter: OwnerSighting['spotter'];
  onViewProfile: () => void;
  /** Present while the owner hasn't decided — the pinned bar has it after. */
  onMessage?: () => void;
  messaging?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 sightings · 4 confirmed by owners · 1 recovery" — the parts that are non-zero,
 *  with sightings always first (it is the denominator of the rest). */
export function spotterRecordLine(spotter: OwnerSighting['spotter']): string {
  return [
    plural(spotter.sightingsReported, 'sighting', 'sightings'),
    spotter.sightingsHelpful > 0 ? `${spotter.sightingsHelpful} confirmed by owners` : null,
    spotter.recoveriesCredited > 0
      ? plural(spotter.recoveriesCredited, 'recovery', 'recoveries')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Who sent it, and their record — see the header. */
export function SightingSpotterCard({
  spotter,
  onViewProfile,
  onMessage,
  messaging = false,
}: SightingSpotterCardProps) {
  const styles = useThemedStyles(makeStyles);
  let since: string | null = null;
  try {
    since = `Member since ${formatMonthYear(spotter.memberSince)}`;
  } catch {
    since = null; // an unparseable date costs the line, never the card
  }

  return (
    <View style={styles.card} testID="spotter-card">
      <View style={styles.top}>
        <Avatar name={spotter.firstName} size="md" />
        <View style={styles.body}>
          <Text style={styles.name}>{spotter.firstName}</Text>
          <Text style={styles.meta}>{spotterRecordLine(spotter)}</Text>
          {since ? <Text style={styles.meta}>{since}</Text> : null}
        </View>
      </View>
      <Pressable
        onPress={onViewProfile}
        accessibilityRole="button"
        accessibilityLabel={`View ${spotter.firstName}’s profile`}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={styles.linkLabel}>View profile</Text>
      </Pressable>
      {onMessage ? (
        // Subtle: encouraged, never competing with the pinned bar's answer.
        <Button
          label={`Message ${spotter.firstName}`}
          variant="subtle"
          loading={messaging}
          onPress={onMessage}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.md,
    },
    top: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    body: {
      flex: 1,
      gap: spacing.xs,
    },
    name: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    meta: {
      ...typography.caption,
      color: c.textSecondary,
    },
    link: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: sizes.touchTarget,
      minWidth: sizes.touchTarget,
    },
    pressed: {
      opacity: opacity.pressed,
    },
    linkLabel: {
      ...typography.label,
      color: c.textPrimary,
      textDecorationLine: 'underline',
    },
  });
