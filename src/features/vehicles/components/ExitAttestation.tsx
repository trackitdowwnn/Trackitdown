/**
 * WHAT:  ExitAttestation — before a refund can leave with recent sightings on
 *        the table, the owner looks at exactly those sightings and says, in
 *        one explicit tap, "none of these led me to the car".
 * WHY:   The owner-denial control's owner half. The server refuses the exit
 *        without an attestation covering its own recent-sighting set
 *        (ATTESTATION_STALE otherwise), so this component renders the
 *        server-named sightings — never a client-side guess — and makes the
 *        consequence honest before the tap: the refund is sent after the
 *        72-hour window, and the spotters shown here will be asked.
 *
 *        THE OTHER BUTTON MATTERS MOST: "One of these did help" routes the
 *        owner to the crediting flow instead. Most owners are honest; the
 *        attestation's job is to make the honest path the easy one at the
 *        exact moment a lazy tap would have stiffed a spotter.
 * LINKS: ../screens/PostDetailScreen.tsx (deactivate entry);
 *        ../screens/RecoverPostScreen.tsx ("found it another way" entry);
 *        src/features/payments (exitCheck — the server-named set);
 *        supabase/functions/_shared/refundHold.ts (what enforces this);
 *        docs/DOMAIN.md (Disputes).
 */

import { StyleSheet, Text, View } from 'react-native';

import { usePostSightings } from '@/features/sightings';
import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { Button } from '@/shared/ui';

export interface ExitAttestationProps {
  postId: string;
  /** The SERVER's recent-uncredited set (exitCheck) — the attestation must
   *  cover exactly these, so this list never filters or invents. */
  sightingIds: string[];
  holdHours: number;
  /** "None of these led me to the car" — proceed with the held exit. */
  onConfirm: (attestedSightingIds: string[]) => void;
  /** "One of these did help" — to the crediting flow instead. */
  onCredit: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ExitAttestation({
  postId,
  sightingIds,
  holdHours,
  onConfirm,
  onCredit,
  onCancel,
  busy = false,
}: ExitAttestationProps) {
  const styles = useThemedStyles(makeStyles);
  const { status, sightings } = usePostSightings(postId);
  const listed = sightings.filter((sighting) => sightingIds.includes(sighting.id));

  return (
    <View style={styles.card} testID="exit-attestation">
      <Text style={styles.title} accessibilityRole="header">
        One thing before your refund
      </Text>
      <Text style={styles.body}>
        People reported seeing your car in the last two weeks. If one of them led you to
        it, they’ve earned the bounty.
      </Text>

      {status === 'loading' ? <Text style={styles.body}>Loading the sightings…</Text> : null}
      <View style={styles.list}>
        {listed.map((sighting) => {
          const when = new Date(sighting.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
          });
          const where = sighting.areaLabel ?? 'Location not shared';
          return (
            <View key={sighting.id} style={styles.item} testID={`attest-${sighting.id}`}>
              <Text style={styles.itemTitle}>
                {when} · {where}
              </Text>
              {sighting.note ? (
                <Text style={styles.itemNote} numberOfLines={2}>
                  {sighting.note}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* The consequence, before the tap — never after. */}
      <Text style={styles.caption}>
        If none of them helped, your refund is sent after {holdHours} hours — these
        spotters get that long to tell us if their sighting found it.
      </Text>

      <Button label="One of these did help" onPress={onCredit} disabled={busy} />
      <Button
        label="None of these led me to the car"
        variant="secondary"
        onPress={() => onConfirm(sightingIds)}
        loading={busy}
      />
      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: c.surface,
  },
  title: {
    ...typography.heading,
    color: c.textPrimary,
  },
  body: {
    ...typography.body,
    color: c.textSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  item: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  itemTitle: {
    ...typography.label,
    color: c.textPrimary,
  },
  itemNote: {
    ...typography.caption,
    color: c.textSecondary,
  },
  caption: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
