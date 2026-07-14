/**
 * WHAT:  PostSightingsScreen — the OWNER's read-only list of sightings on
 *        their post: per sighting the evidence photos (short-lived signed
 *        reads from the private bucket), when and roughly where, the context
 *        chips/note, status, and the spotter's first name + reputation line.
 * WHY:   The owner's window on the reports coming in — and, later, what the
 *        recovery flow credits from. Read-only HERE by design: marking
 *        helpful / crediting are other features' server-side writes.
 *        PRIVACY: everything shown comes from get_post_sightings, whose
 *        payload is first-name + reputation only (never spotter_id or a
 *        surname) — enforced server-side AND re-validated by the api layer.
 * LINKS: src/app/post-sightings.tsx (route);
 *        src/features/sightings/hooks/usePostSightings.ts;
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { useTimeAgo } from '@/shared/hooks';
import { colors, radii, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  EmptyState,
  ErrorState,
  FullscreenLoader,
  Screen,
} from '@/shared/ui';

import { usePostSightings } from '../hooks/usePostSightings';
import type { OwnerSighting } from '../types';

export interface PostSightingsScreenProps {
  postId: string;
}

export function PostSightingsScreen({ postId }: PostSightingsScreenProps) {
  const router = useRouter();
  const { status, sightings, photoUrls, retry } = usePostSightings(postId);

  if (status === 'loading') return <FullscreenLoader visible />;

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Sightings
      </Text>
      {status === 'error' ? (
        <ErrorState body="We couldn’t load the sightings." onRetry={retry} />
      ) : sightings.length === 0 ? (
        <EmptyState
          title="No sightings yet"
          body="When a spotter reports your car, their report appears here."
          actionLabel="Done"
          onAction={() => router.back()}
        />
      ) : (
        sightings.map((sighting) => (
          <SightingCard key={sighting.id} sighting={sighting} photoUrls={photoUrls} />
        ))
      )}
    </Screen>
  );
}

const FLAG_LABELS: Record<string, string> = {
  parked: 'Parked',
  driving: 'Driving',
  people_nearby: 'People nearby',
  plate_changed: 'Plate changed or missing',
};

function SightingCard({
  sighting,
  photoUrls,
}: {
  sighting: OwnerSighting;
  photoUrls: Record<string, string>;
}) {
  const reportedAgo = useTimeAgo(sighting.createdAt);
  const flagLine = sighting.contextFlags.map((flag) => FLAG_LABELS[flag] ?? flag).join(' · ');
  const { spotter } = sighting;

  return (
    <View style={styles.card}>
      <View style={styles.photoRow}>
        {sighting.photos.map((photo) =>
          photoUrls[photo.path] ? (
            <AppImage key={photo.path} uri={photoUrls[photo.path]} style={styles.photo} />
          ) : (
            <View key={photo.path} style={[styles.photo, styles.photoPending]} />
          ),
        )}
      </View>
      <View style={styles.headerRow}>
        <Text style={styles.where} numberOfLines={1}>
          {sighting.locationUnavailable
            ? 'Location unavailable'
            : (sighting.areaLabel ?? 'Captured location')}
        </Text>
        {sighting.status !== 'unverified' ? (
          <Text style={styles.statusTag}>
            {sighting.status === 'credited' ? 'Credited' : 'Marked helpful'}
          </Text>
        ) : null}
      </View>
      <Text style={styles.meta}>Reported {reportedAgo}</Text>
      {flagLine ? <Text style={styles.body}>{flagLine}</Text> : null}
      {sighting.note ? <Text style={styles.body}>{sighting.note}</Text> : null}
      <Text style={styles.spotterLine}>
        By {spotter.firstName} · {spotter.sightingsReported}{' '}
        {spotter.sightingsReported === 1 ? 'sighting' : 'sightings'} reported
        {spotter.recoveriesCredited > 0 ? ` · ${spotter.recoveriesCredited} recoveries` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  photo: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radii.md,
  },
  photoPending: {
    backgroundColor: colors.surfaceSubtle,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  where: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  body: {
    ...typography.body,
    color: colors.textPrimary,
  },
  spotterLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  statusTag: {
    ...typography.caption,
    // Sage: affirmative signal (success stays reserved for payout moments).
    color: colors.primary,
  },
});
