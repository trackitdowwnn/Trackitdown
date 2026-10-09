/**
 * WHAT:  PostSightingsSection — the detail page's "Sighting activity"
 *        section, serving BOTH faces from one mount point: the owner gets
 *        the rich timeline preview (a summary line — "4 sightings · 1 needs
 *        your answer" — then the 3 newest + movement hint + "View all"),
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
 *        Since 2026-10-09 the owner face also ends with a quiet "Taken back"
 *        list (TakenBackList) — where a spotter's "Something else" note is
 *        read, since it never travels in a push.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (host);
 *        src/features/sightings/components/SightingTimeline.tsx;
 *        docs/decisions/ADR-0008-public-sighting-entries.md;
 *        docs/SECURITY_AND_TRUST.md §6.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';
import { motion, sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

import { usePostSightings } from '../hooks/usePostSightings';
import { usePostWithdrawals } from '../hooks/usePostWithdrawals';
import { usePublicSightingEntries } from '../hooks/usePublicSightingEntries';
import { isGoneSighting } from '../lib/sightingVerdict';
import { locatedTrail, type TimelineAnchorSource } from '../lib/timelineModel';
import type { OwnerSighting, PublicSightingEntry } from '../types';
import { SightingsTrailMap, type TrailMapPoint } from './SightingsTrailMap';
import { OwnerSightingTimeline, PublicSightingTimeline } from './SightingTimeline';
import { TakenBackList } from './TakenBackList';

const log = createLogger('sightings');

/** Newest entries shown in the owner's on-page preview before "View all". */
const PREVIEW_LIMIT = 3;

/** "4 sightings · 1 needs your answer" — counted over ALL the owner's
 *  sightings, not the 3 the preview shows, so a waiting one below the fold is
 *  never missed. "· nothing waiting on you" once every one is decided. */
export function sightingsSummaryLine(all: Pick<OwnerSighting, 'status'>[]): string | null {
  // A withdrawn sighting was never answered — it is not counted at all (the
  // owner RPC filters them; this holds if one ever slips through).
  const sightings = all.filter((s) => !isGoneSighting(s.status));
  if (sightings.length === 0) return null;
  const total = `${sightings.length} ${sightings.length === 1 ? 'sighting' : 'sightings'}`;
  const waiting = sightings.filter((s) => s.status === 'unverified').length;
  if (waiting === 0) return `${total} · nothing waiting on you`;
  if (sightings.length === 1) return `${total} · needs your answer`;
  return `${total} · ${waiting} ${waiting === 1 ? 'needs' : 'need'} your answer`;
}

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
  // SAFETY: owner face only — the public face makes no request for it.
  const withdrawals = usePostWithdrawals(postId, isOwner);

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
  const summary = owner.status === 'ready' ? sightingsSummaryLine(owner.sightings) : null;
  return (
    <View>
      <View style={styles.divider} />
      <View style={styles.section}>
        {/* The title and its one-line answer to "anything new?", together. */}
        <View style={styles.titleBlock}>
          <Text style={styles.sectionTitle}>Sighting activity</Text>
          {summary ? (
            <Text style={styles.summary} testID="sightings-summary">
              {summary}
            </Text>
          ) : null}
        </View>
        {owner.status === 'loading' ? (
          <SightingsPending />
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
        {/* Sightings taken back that the owner was told about — and, for
            "Something else", the spotter's note. Only here: never pushed. */}
        <TakenBackList withdrawals={withdrawals} />
      </View>
    </View>
  );
}

/**
 * While the owner's sightings load: nothing for `motion.skeletonGrace`, then
 * one neutral line — true whatever the answer.
 *
 * ⚠️ NOT A SKELETON SHAPED LIKE SIGHTINGS (DESIGN_SYSTEM, Loading: "never a
 * skeleton shaped like an answer the user may not have"; review of #146). Most
 * posts have none yet, and for someone whose car was stolen, sighting-shaped
 * cards that turn into "No sightings yet" read as something arriving and then
 * vanishing.
 */
function SightingsPending() {
  const styles = useThemedStyles(makeStyles);
  // A held timer, not a render-time clock: the React Compiler would freeze it.
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), motion.skeletonGrace);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View testID="sightings-section-pending">
      {graceOver ? (
        <Text style={styles.meta} accessibilityRole="progressbar">
          Checking for sightings…
        </Text>
      ) : null}
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
  titleBlock: {
    gap: spacing.xs,
  },
  sectionTitle: {
    ...typography.title,
    color: c.textPrimary,
    includeFontPadding: false,
  },
  summary: {
    ...typography.caption,
    color: c.textSecondary,
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
});
