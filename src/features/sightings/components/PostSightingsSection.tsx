/**
 * WHAT:  PostSightingsSection — the detail page's "Sighting activity"
 *        section, serving BOTH faces from one mount point: the owner gets
 *        the rich timeline preview (3 newest + movement hint + "View all"),
 *        everyone else gets the restrained public timeline or nothing at
 *        all. Owns its own divider + title chrome so the public-empty case
 *        can vanish entirely (the host page cannot know emptiness).
 * WHY:   This supersedes the old aggregate-only "N sightings reported" line
 *        on the detail page. // SAFETY: the face split is decided by
 *        `isOwner` ONCE, here — the owner branch calls the owner RPC, the
 *        public branch calls only get_public_sighting_entries (ADR-0008),
 *        and neither branch can render the other's data because the two
 *        payload types don't overlap. The owner's warm empty state exists;
 *        the public face has NO empty state by design (an absent section
 *        signals nothing to a thief casing the page).
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (host);
 *        src/features/sightings/components/SightingTimeline.tsx;
 *        docs/decisions/ADR-0008-public-sighting-entries.md;
 *        docs/SECURITY_AND_TRUST.md §6.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { createLogger } from '@/shared/lib/logger';
import { radii, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { usePostSightings } from '../hooks/usePostSightings';
import { usePublicSightingEntries } from '../hooks/usePublicSightingEntries';
import { locatedTrail, type TimelineAnchorSource } from '../lib/timelineModel';
import type { OwnerSighting, PublicSightingEntry } from '../types';
import { SightingsTrailMap, type TrailMapPoint } from './SightingsTrailMap';
import { OwnerSightingTimeline, PublicSightingTimeline } from './SightingTimeline';

const log = createLogger('sightings');

/** Newest entries shown in the owner's on-page preview before "View all". */
const PREVIEW_LIMIT = 3;

/** Public entries arrive newest-first; the map walks time forward. Only
 *  snapped points exist here — the server rounded them (ADR-0009). */
function snappedTrail(entries: PublicSightingEntry[]): TrailMapPoint[] {
  return [...entries]
    .reverse()
    .flatMap((entry) =>
      entry.snapLat !== null && entry.snapLng !== null
        ? [{ lat: entry.snapLat, lng: entry.snapLng }]
        : [],
    );
}

export interface PostSightingsSectionProps {
  postId: string;
  isOwner: boolean;
  /** The post's anchor-node data (status, last-seen). PRIVACY: this comes
   *  from the host page's own post payload — already face-appropriate. */
  anchors?: TimelineAnchorSource;
  /** The theft point from the host page's post payload (public for active
   *  posts — it's the "Last seen here" pin). Roots the trail map. */
  origin?: { lat: number; lng: number };
}

export function PostSightingsSection({
  postId,
  isOwner,
  anchors,
  origin,
}: PostSightingsSectionProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  // Hooks are unconditional (React rule); each face's fetch is gated by
  // `enabled`, so exactly one request is ever made per mount.
  const owner = usePostSightings(postId, isOwner);
  const publicEntries = usePublicSightingEntries(postId, !isOwner);

  const hasPublicContent = !isOwner && (publicEntries?.entries.length ?? 0) > 0;
  // One view log per mount, once real content is on screen (ids only).
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current) return;
    if (isOwner ? owner.status === 'ready' : hasPublicContent) {
      viewLogged.current = true;
      log.info('sighting_timeline_viewed', { postId, face: isOwner ? 'owner' : 'public' });
    }
  }, [isOwner, owner.status, hasPublicContent, postId]);

  const openSighting = (sighting: OwnerSighting) => {
    log.info('sighting_entry_opened', { postId, sightingId: sighting.id });
    router.push({
      pathname: '/sighting/[sightingId]',
      params: { sightingId: sighting.id, postId },
    });
  };

  if (!isOwner) {
    // PUBLIC FACE — render nothing while loading, on error, and when empty:
    // the section simply isn't there (ADR-0008; no skeleton, no empty copy).
    if (!hasPublicContent || !publicEntries) return null;
    return (
      <View>
        <View style={styles.divider} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sighting activity</Text>
          {/* The trail in SPACE — snapped ~1km points only (ADR-0009); the
              server rounded them before they left the database. */}
          <SightingsTrailMap
            points={snappedTrail(publicEntries.entries)}
            origin={origin}
            height={sizes.mapConfirmPreview}
          />
          <PublicSightingTimeline data={publicEntries} anchors={anchors} />
        </View>
      </View>
    );
  }

  // OWNER FACE — the section always renders: activity, or the warm empty.
  return (
    <View>
      <View style={styles.divider} />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Sighting activity</Text>
        {owner.status === 'loading' ? (
          <View style={styles.skeletonSet} accessibilityLabel="Loading sightings" testID="sightings-section-skeleton">
            {[0, 1].map((n) => (
              <View key={n} style={styles.skeletonRow}>
                <View style={styles.skeletonDot} />
                <View style={styles.skeletonLines}>
                  <View style={styles.skeletonLineWide} />
                  <View style={styles.skeletonLine} />
                </View>
              </View>
            ))}
          </View>
        ) : owner.status === 'error' ? (
          <>
            <Text style={styles.meta}>We couldn’t load your sightings just now.</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try loading sightings again"
              onPress={owner.retry}
              style={styles.linkRow}
              hitSlop={spacing.sm}
            >
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </>
        ) : owner.sightings.length === 0 ? (
          // The warm owner empty (spec copy): honest that waiting is the state.
          <Text style={styles.meta}>
            No sightings yet — spotters in the area have been alerted.
          </Text>
        ) : (
          <>
            {/* Owner face: exact points from the owner's own payload. */}
            <SightingsTrailMap
              points={locatedTrail(owner.sightings).map((point) => ({
                id: point.sightingId,
                lat: point.lat,
                lng: point.lng,
              }))}
              origin={origin}
              height={sizes.mapConfirmPreview}
              onPinPress={(sightingId) => {
                log.info('sighting_entry_opened', { postId, sightingId });
                router.push({
                  pathname: '/sighting/[sightingId]',
                  params: { sightingId, postId },
                });
              }}
            />
            <OwnerSightingTimeline
              sightings={owner.sightings}
              photoUrls={owner.photoUrls}
              limit={PREVIEW_LIMIT}
              onEntryPress={openSighting}
              anchors={anchors}
            />
            {owner.sightings.length > PREVIEW_LIMIT ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View all ${owner.sightings.length} sightings`}
                onPress={() => router.push({ pathname: '/post-sightings', params: { postId } })}
                style={styles.linkRow}
                hitSlop={spacing.sm}
              >
                <Text style={styles.link}>View all {owner.sightings.length} sightings</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // Mirrors the host page's section chrome (PostDetailBody) so this section
  // reads as native to the page: hairline divider, 32pt rhythm, title tier.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: c.border,
  },
  section: {
    paddingVertical: spacing.xxl,
    gap: spacing.lg,
  },
  sectionTitle: {
    ...typography.title,
    color: c.textPrimary,
    includeFontPadding: false,
  },
  meta: {
    ...typography.body,
    color: c.textSecondary,
  },
  linkRow: {
    alignSelf: 'flex-start',
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  link: {
    // The page's underlined-link grammar (underline = tappable).
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
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
    backgroundColor: c.surfaceSubtle,
  },
  skeletonLines: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonLineWide: {
    height: sizes.skeletonLine,
    width: '60%',
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
  skeletonLine: {
    height: sizes.skeletonLine,
    width: '40%',
    borderRadius: radii.sm,
    backgroundColor: c.surfaceSubtle,
  },
});
