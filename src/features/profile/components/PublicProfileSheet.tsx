/**
 * WHAT:  PublicProfileSheet — the passport an owner sees for a spotter:
 *        identity column (avatar, first name, trusted-spotter marker,
 *        member-since) beside the nonzero counters as a stacked stat column,
 *        with earned badge emblems beneath. NO goal/progress UI — passports
 *        show earned trust only; the next-badge bar is the spotter's own
 *        business (docs/design-refs/profile/REFERENCE_SPEC.md §2).
 * WHY:   THIS IS A PRIVACY BOUNDARY (docs/SECURITY_AND_TRUST §1: spotter
 *        identity is first name + reputation only). The component accepts
 *        ONLY the PublicProfile type — no surname, location, or contact
 *        exists to leak — and the api layer's select is equally narrow.
 *        The safety test asserts the ABSENCE of anything beyond these
 *        fields. The passport recomposition shows LESS than before (the
 *        progress bar and highlight sentences are gone — the stat column
 *        already tells those numbers), never more. Degrade by omission: a
 *        fresh spotter is avatar + name + member-since, no zero rows.
 * LINKS: src/features/profile/types.ts (PublicProfile — SAFETY note);
 *        src/features/profile/api/profileApi.ts (fetchPublicProfile);
 *        components/StatColumn.tsx; components/ReputationCard.tsx
 *        (EmblemRail); docs/DOMAIN.md; docs/SECURITY_AND_TRUST.md §1.
 *
 * Usage:
 *   const sheetRef = useRef<BottomSheetRef>(null);
 *   <PublicProfileSheet ref={sheetRef} profile={spotterProfile} />
 *   sheetRef.current?.open();
 */

import { type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, displayFontScaleCap, spacing, typography } from '@/shared/theme';
import { Avatar, BottomSheet, type BottomSheetRef } from '@/shared/ui';

import { earnedBadges, isTrustedSpotter, memberSinceLabel, passportStats } from '../lib/reputation';
import type { PublicProfile } from '../types';
import { EmblemRail } from './ReputationCard';
import { StatColumn } from './StatColumn';
import { TrustedSpotterPill } from './TrustedSpotterPill';

export interface PublicProfileSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** null while loading — the sheet renders nothing until it arrives. */
  profile: PublicProfile | null;
  onDismiss?: () => void;
}

// SAFETY: render ONLY what PublicProfile carries. Do not add props that
// smuggle extra spotter data past the type boundary.
export function PublicProfileSheet({ ref, profile, onDismiss }: PublicProfileSheetProps) {
  const stats = profile ? passportStats(profile.counters) : [];
  const earned = profile ? earnedBadges(profile.counters) : [];

  return (
    <BottomSheet ref={ref} onDismiss={onDismiss}>
      {profile ? (
        <View style={styles.content} testID="public-profile">
          {/* The sheet IS the card — passport anatomy without double chrome. */}
          <View style={styles.passport}>
            <View style={styles.identity}>
              <Avatar
                uri={profile.avatarUrl}
                name={profile.firstName}
                size="xl"
                accessibilityLabel={`${profile.firstName}'s photo`}
              />
              <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={displayFontScaleCap}>
                {profile.firstName}
              </Text>
              {/* Derived from the public counters — no new fields cross the
                  privacy boundary. Owners are who trust markers exist for.
                  The wrapper View centres the pill (its own alignSelf:
                  flex-start would pin it to the column's left edge). */}
              {isTrustedSpotter(profile.counters) ? (
                <View>
                  <TrustedSpotterPill />
                </View>
              ) : null}
              <Text style={styles.since} maxFontSizeMultiplier={displayFontScaleCap}>
                {memberSinceLabel(profile.createdAt)}
              </Text>
            </View>
            {stats.length > 0 ? <StatColumn stats={stats} testID="public-stats" /> : null}
          </View>
          {earned.length > 0 ? <EmblemRail badges={earned} testID="public-emblems" /> : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
  },
  passport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
  },
  identity: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  since: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
