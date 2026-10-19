/**
 * WHAT:  "Spotted by" on the owner's sighting page: one compact card — the
 *        spotter's avatar and first name, ONE line of record ("12 sightings ·
 *        4 confirmed by owners · 1 recovery · since July 2026"), and
 *        "Message {name}", always, in the same place.
 * WHY:   How much to trust a sighting is partly how much to trust who sent
 *        it, so the record stays; everything else went (owner's pick,
 *        2026-10-19):
 *        - "View profile" opened a sheet fed ONLY from this payload, so it
 *          repeated the card a tap away;
 *        - "Member since" had a line of its own;
 *        - Message was here only while undecided, then moved to the page's
 *          pinned bar — the same button in two places depending on state.
 *          Now the bar only ever asks the question, and Message is here in
 *          every state.
 *
 *        PRIVACY (§1): first name and the reputation passport only — no id,
 *        no surname, no contact path. "Message" opens chat by SIGHTING id.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx;
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { StyleSheet, Text, View } from 'react-native';

import { formatMonthYear } from '@/shared/lib';
import { cardSurface, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Avatar, Button } from '@/shared/ui';

import type { OwnerSighting } from '../types';

export interface SightingSpotterCardProps {
  spotter: OwnerSighting['spotter'];
  onMessage: () => void;
  messaging?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 sightings · 4 confirmed by owners · 1 recovery · since July 2026" — the
 *  counts that are non-zero, sightings always first (it is the denominator of
 *  the rest), then when they joined. An unparseable join date costs that part,
 *  never the line. */
export function spotterRecordLine(spotter: OwnerSighting['spotter']): string {
  let since: string | null = null;
  try {
    since = `since ${formatMonthYear(spotter.memberSince)}`;
  } catch {
    since = null;
  }
  return [
    plural(spotter.sightingsReported, 'sighting', 'sightings'),
    spotter.sightingsHelpful > 0 ? `${spotter.sightingsHelpful} confirmed by owners` : null,
    spotter.recoveriesCredited > 0
      ? plural(spotter.recoveriesCredited, 'recovery', 'recoveries')
      : null,
    since,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Who sent it, their record, and Message — see the header. */
export function SightingSpotterCard({
  spotter,
  onMessage,
  messaging = false,
}: SightingSpotterCardProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card} testID="spotter-card">
      <View style={styles.top}>
        <Avatar name={spotter.firstName} size="md" />
        <View style={styles.body}>
          <Text style={styles.name}>{spotter.firstName}</Text>
          <Text style={styles.meta}>{spotterRecordLine(spotter)}</Text>
        </View>
      </View>
      {/* Secondary, never primary: while undecided the pinned bar's "Yes"
          is the page's one primary action. */}
      <Button
        label={`Message ${spotter.firstName}`}
        variant="secondary"
        loading={messaging}
        onPress={onMessage}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      ...cardSurface(c),
      padding: spacing.lg,
      gap: spacing.lg,
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
  });
