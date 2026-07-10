/**
 * WHAT:  PublicProfileSheet — the compact spotter profile an owner sees from
 *        a sighting: avatar, first name, member-since, reputation card.
 * WHY:   THIS IS A PRIVACY BOUNDARY (docs/SECURITY_AND_TRUST §1: spotter
 *        identity is first name + reputation only). The component accepts
 *        ONLY the PublicProfile type — no surname, location, or contact
 *        exists to leak — and the api layer's select is equally narrow.
 *        The safety test asserts the ABSENCE of anything beyond these
 *        fields. Exported for the sightings feature to open when an owner
 *        reviews who reported.
 * LINKS: src/features/profile/types.ts (PublicProfile — SAFETY note);
 *        src/features/profile/api/profileApi.ts (fetchPublicProfile);
 *        docs/DOMAIN.md; docs/SECURITY_AND_TRUST.md §1.
 *
 * Usage:
 *   const sheetRef = useRef<BottomSheetRef>(null);
 *   <PublicProfileSheet ref={sheetRef} profile={spotterProfile} />
 *   sheetRef.current?.open();
 */

import { type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';
import { Avatar, BottomSheet, type BottomSheetRef } from '@/shared/ui';

import { isTrustedSpotter, memberSinceLabel } from '../lib/reputation';
import type { PublicProfile } from '../types';
import { ReputationCard } from './ReputationCard';
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
  return (
    <BottomSheet ref={ref} onDismiss={onDismiss}>
      {profile ? (
        <View style={styles.content} testID="public-profile">
          <Avatar
            uri={profile.avatarUrl}
            name={profile.firstName}
            size="md"
            accessibilityLabel={`${profile.firstName}'s photo`}
          />
          <View style={styles.identity}>
            <Text style={styles.name}>{profile.firstName}</Text>
            {/* Derived from the public counters — no new fields cross the
                privacy boundary. Owners are who trust markers exist for. */}
            {isTrustedSpotter(profile.counters) ? <TrustedSpotterPill /> : null}
            <Text style={styles.since}>{memberSinceLabel(profile.createdAt)}</Text>
          </View>
          <ReputationCard counters={profile.counters} createdAt={profile.createdAt} />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.lg,
    alignItems: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  name: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  since: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
