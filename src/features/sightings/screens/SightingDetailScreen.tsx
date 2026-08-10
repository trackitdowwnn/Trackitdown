/**
 * WHAT:  SightingDetailScreen — one sighting examined in full by the post's
 *        OWNER: the evidence photos large, the exact captured point on a
 *        non-interactive map, when/where/chips/note, the spotter's passport
 *        row (tap → PublicProfileSheet), and the two owner actions — message
 *        the spotter and mark the sighting helpful.
 * WHY:   The timeline skims; this examines. Served from the SAME owner RPC
 *        as the list (usePostSightings) so there is exactly one payload —
 *        and one privacy review surface — for everything an owner can see.
 *        PRIVACY (§1): the spotter is first name + reputation only; "Message"
 *        opens chat by SIGHTING id (the server resolves the spotter);
 *        the profile sheet is fed from the same narrow passport — no uid
 *        ever reaches this client. Mark-helpful is DOMAIN's owner-side
 *        reputation credit: idempotent server-side, one-way, and never
 *        re-labels a credited sighting (the button hides once non-unverified).
 * LINKS: src/app/sighting/[sightingId].tsx (route);
 *        src/features/sightings/hooks/usePostSightings.ts;
 *        src/features/sightings/api/sightingApi.ts (markSightingHelpful);
 *        docs/DOMAIN.md (Reputation v1); docs/SECURITY_AND_TRUST.md §1.
 */

import { Feather } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentType } from 'react';

import type { PublicProfileSheetProps } from '@/features/profile';
import { useTimeAgo } from '@/shared/hooks';
import { mapPinUrl } from '@/shared/lib';
import { createLogger } from '@/shared/lib/logger';
import {
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  AppImage,
  Avatar,
  Button,
  ConfirmDialog,
  ErrorState,
  SAFETY_NOTICE_BODY,
  SafetyNotice,
  Screen,
  useToast,
  type BottomSheetRef,
  type ConfirmDialogRef,
} from '@/shared/ui';
import { AppMap, AppMapMarker } from '@/shared/ui/AppMap';

import { markSightingHelpful } from '../api/sightingApi';
import { usePostSightings } from '../hooks/usePostSightings';
import { contextSummary } from '../lib/contextLabels';
import type { OwnerSighting } from '../types';

const log = createLogger('sightings');

/** Same ~1.4-mile preview span as the detail page's last-seen map. */
const PREVIEW_DELTA = 0.02;

export interface SightingDetailScreenProps {
  postId: string;
  sightingId: string;
}

export function SightingDetailScreen({ postId, sightingId }: SightingDetailScreenProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const router = useRouter();
  const toast = useToast();
  const { status, sightings, photoUrls, retry } = usePostSightings(postId);
  const sighting = sightings.find((s) => s.id === sightingId) ?? null;

  // The status can advance locally (unverified → helpful) without refetching;
  // the server is the source of truth and this mirrors its reply only.
  const [localStatus, setLocalStatus] = useState<OwnerSighting['status'] | null>(null);
  const effectiveStatus = localStatus ?? sighting?.status ?? 'unverified';

  const [marking, setMarking] = useState(false);
  const [opening, setOpening] = useState(false);

  // Peer profile sheet — component deferred-loaded (profile ↔ sightings graphs
  // stay apart in tests; same pattern as ChatThreadScreen). The DATA is
  // already here: the sighting's narrow spotter passport.
  const [PeerSheet, setPeerSheet] = useState<ComponentType<PublicProfileSheetProps> | null>(null);
  const [peerProfile, setPeerProfile] = useState<PublicProfileSheetProps['profile']>(null);
  const peerSheetRef = useRef<BottomSheetRef>(null);
  const mapsConfirmRef = useRef<ConfirmDialogRef>(null);

  const openSpotterProfile = async () => {
    if (!sighting) return;
    try {
      const profileFeature = await import('@/features/profile');
      setPeerSheet(() => profileFeature.PublicProfileSheet);
      // The narrow passport, shaped to PublicProfile — nothing beyond what
      // the sighting payload already carries (first name + counters + since).
      setPeerProfile({
        firstName: sighting.spotter.firstName,
        avatarUrl: null,
        createdAt: sighting.spotter.memberSince,
        counters: {
          sightingsReported: sighting.spotter.sightingsReported,
          sightingsHelpful: sighting.spotter.sightingsHelpful,
          recoveriesCredited: sighting.spotter.recoveriesCredited,
        },
      });
    } catch {
      toast.show('We couldn’t open their profile just now.', 'error');
    }
  };
  useEffect(() => {
    if (PeerSheet && peerProfile) peerSheetRef.current?.open();
  }, [PeerSheet, peerProfile]);

  const messageSpotter = async () => {
    if (!sighting || opening) return;
    setOpening(true);
    try {
      // Deferred import keeps this screen's test module-graph off the chat
      // feature; the SIGHTING id is the handle — never a spotter id (§1).
      const { openThreadForSighting } = await import('@/features/chat');
      const { threadId } = await openThreadForSighting(sighting.id);
      router.push(`/chat/${threadId}`);
    } catch (err) {
      toast.show(
        err instanceof Error && err.message ? err.message : 'We couldn’t open the conversation.',
        'error',
      );
    } finally {
      setOpening(false);
    }
  };

  const markHelpful = async () => {
    if (!sighting || marking) return;
    setMarking(true);
    try {
      const result = await markSightingHelpful(sighting.id);
      setLocalStatus(result.status);
      if (result.changed) {
        toast.show(`Marked helpful — ${sighting.spotter.firstName} gets the credit.`, 'success');
      }
    } catch {
      toast.show('We couldn’t mark this helpful just now.', 'error');
    } finally {
      setMarking(false);
    }
  };

  useEffect(() => {
    log.info('sighting_detail_viewed', { postId, sightingId });
  }, [postId, sightingId]);

  if (status === 'loading') {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <View accessibilityLabel="Loading sighting" testID="sighting-detail-skeleton" style={styles.skeletonSet}>
          <View style={styles.skeletonPhoto} />
          <View style={styles.skeletonLineWide} />
          <View style={styles.skeletonLine} />
        </View>
      </Screen>
    );
  }

  if (status === 'error') {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ErrorState body="We couldn’t load this sighting." onRetry={retry} />
      </Screen>
    );
  }

  if (!sighting) {
    // Ready but absent — a stale link (e.g. the post was reactivated and the
    // list changed). Honest dead-end, no oracle about why.
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        <ErrorState body="This sighting isn’t available any more." onRetry={() => router.back()} retryLabel="Go back" />
      </Screen>
    );
  }

  const locatedPhoto = sighting.photos.find((p) => p.lat !== null && p.lng !== null) ?? null;
  // Friendly labels from the shared vocabulary (never raw enum values).
  const contextLine = contextSummary(sighting).join(' · ');

  // Hand the captured point to whatever maps app the device has. A device can
  // genuinely have none (stripped Android builds), and openURL then rejects —
  // so this is a toast, never an unhandled rejection.
  const openInMaps = async () => {
    if (!locatedPhoto) return;
    const url = mapPinUrl(
      locatedPhoto.lat as number,
      locatedPhoto.lng as number,
      'Car sighted here',
    );
    try {
      await Linking.openURL(url);
      log.info('sighting_map_opened', { postId, sightingId });
    } catch {
      toast.show('We couldn’t open your maps app.', 'error');
    }
  };

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <SightingHeader sighting={sighting} status={effectiveStatus} />

      {/* Evidence photos, large — the owner is examining, not skimming.
          ADR-0003: a gallery photo is labelled UNMISSABLY — it is context,
          not capture-moment evidence, and never carries a location. */}
      <View style={styles.photoStack}>
        {sighting.photos.map((photo) => (
          <View key={photo.path}>
            {photoUrls[photo.path] ? (
              <AppImage
                uri={photoUrls[photo.path]}
                style={styles.photo}
                accessibilityLabel={
                  photo.source === 'gallery'
                    ? 'Sighting photo, added from photo library'
                    : 'Sighting photo, taken in the app'
                }
              />
            ) : (
              <View style={[styles.photo, styles.photoPending]} />
            )}
            {photo.source === 'gallery' ? (
              <View style={styles.photoSourceRow}>
                <Feather name="image" size={sizes.iconSm} color={palette.textSecondary} />
                <Text style={styles.photoSourceText}>Added from photo library</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>

      {/* The exact captured point — owner-only surface, so precision is
          correct here (the public face never sees coordinates). */}
      {locatedPhoto ? (
        <View style={styles.mapCard}>
          <AppMap
            interactive={false}
            region={{
              latitude: locatedPhoto.lat as number,
              longitude: locatedPhoto.lng as number,
              latitudeDelta: PREVIEW_DELTA,
              longitudeDelta: PREVIEW_DELTA,
            }}
            animateDurationMs={motion.mapPan}
            onRegionChangeStart={() => {}}
            onRegionChangeComplete={() => {}}
          >
            <AppMapMarker
              coordinate={{ latitude: locatedPhoto.lat as number, longitude: locatedPhoto.lng as number }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.pin} />
            </AppMapMarker>
          </AppMap>
        </View>
      ) : (
        <Text style={styles.meta}>Location couldn’t be captured for this sighting.</Text>
      )}

      {contextLine ? <Text style={styles.body}>{contextLine}</Text> : null}

      {/* The marks this spotter CONFIRMED seeing — the strongest identity
          signal a report can carry ("it really is my car"). */}
      {sighting.confirmedFeatures.length > 0 ? (
        <View style={styles.marksCard} testID="confirmed-marks">
          <Text style={styles.marksTitle}>Confirmed your marks</Text>
          {sighting.confirmedFeatures.map((mark) => (
            <View key={mark.id} style={styles.markRow}>
              <Feather name="check" size={sizes.iconSm} color={palette.primary} />
              <Text style={styles.markText}>{mark.description}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {sighting.note ? <Text style={styles.body}>{sighting.note}</Text> : null}

      {/* Spotter passport row — tap opens the narrow public profile. */}
      <SpotterRow sighting={sighting} onPress={() => void openSpotterProfile()} />

      {/* Safety notice — every sighting screen (DOMAIN §1). This is the exact
          captured point on a map; the owner may be tempted to act. */}
      <SafetyNotice />

      <View style={styles.actions}>
        <Button
          label={`Message ${sighting.spotter.firstName}`}
          variant="secondary"
          loading={opening}
          onPress={() => void messageSpotter()}
        />
        {effectiveStatus === 'unverified' ? (
          <Button
            label="Mark helpful"
            variant="subtle"
            loading={marking}
            onPress={() => void markHelpful()}
          />
        ) : null}
        {/* Deliberately BELOW the SafetyNotice, in the quietest variant, and
            behind a confirm that repeats the notice in full.
            §1 bans pursuit features — "no live navigation toward a sighted
            car" — so this drops a PIN and never starts turn-by-turn (see
            mapPinUrl), and it says "Open in Maps", not "Directions". §1's
            enumerated ban is spotter→vehicle and this screen is owner-only,
            with §1 elsewhere putting recovery in the hands of "the owner and
            police" — but it is still the most direct route to the thing the
            notice above forbids, so the confirm makes the owner read it once
            more at the moment it applies. It earns its place: the alternative
            is an owner copying coordinates off a screen that shows none, and
            the police ask "where". */}
        {locatedPhoto ? (
          <Button
            label="Open in Maps"
            variant="ghost"
            onPress={() => mapsConfirmRef.current?.open()}
          />
        ) : null}
      </View>

      {/* The §1 notice, restated at the one moment it is most likely to be
          ignored. The BODY is IMPORTED, never retyped: a hand-typed second copy
          drifts, and this one already had (it gained a "Report from a distance."
          the component's wording doesn't carry). The title is this moment's,
          the warning is the app's one canonical sentence — including 999, the
          emergency line, not 101. */}
      <ConfirmDialog
        ref={mapsConfirmRef}
        title="Opening the map — please don’t approach"
        body={SAFETY_NOTICE_BODY}
        confirmLabel="Open in Maps"
        onConfirm={() => void openInMaps()}
      />

      {PeerSheet ? (
        <PeerSheet ref={peerSheetRef} profile={peerProfile} onDismiss={() => setPeerProfile(null)} />
      ) : null}
    </Screen>
  );
}

function SightingHeader({
  sighting,
  status,
}: {
  sighting: OwnerSighting;
  status: OwnerSighting['status'];
}) {
  const styles = useThemedStyles(makeStyles);
  const reportedAgo = useTimeAgo(sighting.createdAt);
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {sighting.locationUnavailable
          ? 'Sighting'
          : (sighting.areaLabel ?? 'Sighting')}
      </Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>Reported {reportedAgo}</Text>
        {status !== 'unverified' ? (
          <Text style={styles.statusTag}>{status === 'credited' ? 'Credited' : 'Marked helpful'}</Text>
        ) : null}
      </View>
    </View>
  );
}

function SpotterRow({ sighting, onPress }: { sighting: OwnerSighting; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { spotter } = sighting;
  return (
    <View style={styles.spotterCard}>
      <Avatar name={spotter.firstName} size="md" />
      <View style={styles.spotterBody}>
        <Text style={styles.spotterName}>{spotter.firstName}</Text>
        <Text style={styles.spotterMeta}>
          {spotter.sightingsReported} {spotter.sightingsReported === 1 ? 'sighting' : 'sightings'}{' '}
          reported
          {spotter.recoveriesCredited > 0 ? ` · ${spotter.recoveriesCredited} recoveries` : ''}
        </Text>
      </View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`View ${spotter.firstName}’s profile`}
        hitSlop={spacing.lg}
        style={styles.spotterLinkPressable}
      >
        <Text style={styles.spotterLink}>View profile</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  content: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  meta: {
    ...typography.caption,
    color: c.textSecondary,
  },
  statusTag: {
    ...typography.caption,
    // Primary ink, not success green — sage stays reserved for payout moments.
    color: c.primary,
  },
  photoStack: {
    gap: spacing.sm,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
  },
  photoPending: {
    backgroundColor: c.surfaceSubtle,
  },
  photoSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  photoSourceText: {
    ...typography.caption,
    color: c.textSecondary,
  },
  mapCard: {
    height: sizes.mapPreview,
    borderRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: c.surfaceSubtle,
  },
  pin: {
    width: sizes.mapPinConfirm,
    height: sizes.mapPinConfirm,
    borderRadius: radii.full,
    backgroundColor: c.primary,
    borderWidth: sizes.mapPinRing,
    borderColor: c.surface,
    ...shadows.soft,
  },
  body: {
    ...typography.body,
    color: c.textPrimary,
  },
  marksCard: {
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  marksTitle: {
    ...typography.label,
    color: c.textPrimary,
  },
  markRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  markText: {
    ...typography.body,
    color: c.textPrimary,
    flexShrink: 1,
  },
  spotterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    ...shadows.soft,
  },
  spotterBody: {
    flex: 1,
    gap: spacing.xs,
  },
  spotterName: {
    ...typography.cardTitle,
    color: c.textPrimary,
  },
  spotterMeta: {
    ...typography.caption,
    color: c.textSecondary,
  },
  spotterLinkPressable: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  spotterLink: {
    ...typography.label,
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  skeletonSet: {
    gap: spacing.lg,
  },
  skeletonPhoto: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radii.lg,
    backgroundColor: c.surfaceSubtle,
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
