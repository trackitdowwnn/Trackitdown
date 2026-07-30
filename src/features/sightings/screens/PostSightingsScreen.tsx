/**
 * WHAT:  PostSightingsScreen — the OWNER's full sighting timeline for one of
 *        their posts: the interactive trail MAP (located sightings connected
 *        oldest→newest from the theft origin; owner-only coordinates), then
 *        every sighting as a rail entry (newest first, day-grouped), the
 *        movement hint (2+ located sightings, ≥0.1 mi apart), and
 *        tap-through to each sighting's detail page.
 * WHY:   The owner's window on the reports coming in — and, later, what the
 *        recovery flow credits from. The heavy per-sighting content (full
 *        photos, map, message, mark-helpful) lives on the DETAIL page now;
 *        this screen is for reading the shape of the activity.
 *        PRIVACY: sightings come from get_post_sightings, whose payload is
 *        first-name + reputation only (never spotter_id or a surname) —
 *        enforced server-side AND re-validated by the api layer; the anchor
 *        data and theft origin come from the owner's OWN fetchPostDetail
 *        payload. Every coordinate on this screen is owner-face data.
 * LINKS: src/app/post-sightings.tsx (route);
 *        src/features/sightings/screens/SightingDetailScreen.tsx;
 *        src/features/sightings/components/SightingTimeline.tsx;
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, ErrorState, SafetyNotice, Screen } from '@/shared/ui';

import { SightingsTrailMap } from '../components/SightingsTrailMap';
import { OwnerSightingTimeline } from '../components/SightingTimeline';
import { usePostSightings } from '../hooks/usePostSightings';
import { locatedTrail, type TimelineAnchorSource } from '../lib/timelineModel';

export interface PostSightingsScreenProps {
  postId: string;
}

export function PostSightingsScreen({ postId }: PostSightingsScreenProps) {
  const router = useRouter();
  const { status, sightings, photoUrls, retry } = usePostSightings(postId);

  // Anchor data (status + last-seen) for the timeline's arc ends, and the
  // theft point for the trail map — the OWNER's own post detail carries the
  // exact coordinates (ADR-0008 keeps them off every other face). Best-effort:
  // a failure just renders the timeline anchor-less and the map origin-less.
  // Deferred import keeps this screen's module graph off the vehicles feature.
  const [anchors, setAnchors] = useState<TimelineAnchorSource | undefined>(undefined);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchPostDetail } = await import('@/features/vehicles');
        const result = await fetchPostDetail(postId);
        if (cancelled || result.kind !== 'visible') return;
        const { status: postStatus, lastSeenAt, lastSeenArea, createdAt, lat, lng } = result.post;
        setAnchors({ status: postStatus, lastSeenAt, lastSeenArea, createdAt });
        if (lat !== undefined && lng !== undefined) setOrigin({ lat, lng });
      } catch {
        // anchor-less is a complete, honest timeline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  if (status === 'loading') {
    // Skeleton rows, not a spinner (design system: no spinners on lists).
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          Sightings
        </Text>
        <View
          style={styles.skeletonSet}
          accessibilityLabel="Loading sightings"
          testID="sightings-skeleton"
        >
          {/* Reserve the map card so it doesn't pop the rows down on load. */}
          <View style={styles.skeletonMap} />
          {[0, 1, 2].map((n) => (
            <View key={n} style={styles.skeletonRow}>
              <View style={styles.skeletonDot} />
              <View style={styles.skeletonLines}>
                <View style={styles.skeletonLineWide} />
                <View style={styles.skeletonLine} />
              </View>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

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
        <>
          {/* The trail in SPACE — owner-only (the map component's SAFETY
              header says why); the timeline below stays the accessible and
              complete record, including un-located sightings. */}
          <SightingsTrailMap
            points={locatedTrail(sightings).map((point) => ({
              id: point.sightingId,
              lat: point.lat,
              lng: point.lng,
            }))}
            origin={origin}
            onPinPress={(sightingId) =>
              router.push({ pathname: '/sighting/[sightingId]', params: { sightingId, postId } })
            }
          />
          {locatedTrail(sightings).length < sightings.length ? (
            <Text style={styles.mapNote}>
              Sightings without a captured location aren’t on the map — they’re in the
              timeline below.
            </Text>
          ) : null}
          <OwnerSightingTimeline
            sightings={sightings}
            photoUrls={photoUrls}
            anchors={anchors}
            onEntryPress={(sighting) =>
              router.push({
                pathname: '/sighting/[sightingId]',
                params: { sightingId: sighting.id, postId },
              })
            }
          />
        </>
      )}

      {/* Safety notice — every sighting screen (DOMAIN §1). */}
      <SafetyNotice />
    </Screen>
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
  mapNote: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  skeletonMap: {
    height: sizes.mapPreview,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonSet: {
    gap: spacing.lg,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  skeletonDot: {
    width: sizes.iconSm,
    height: sizes.iconSm,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLineWide: {
    height: sizes.skeletonLine,
    width: '60%',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    width: '40%',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceSubtle,
  },
});
