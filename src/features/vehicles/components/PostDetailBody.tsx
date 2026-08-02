/**
 * WHAT:  PostDetailBody — the scrollable content of a visible post, hairline-
 *        divided with the reference's generous rhythm (32pt sections, title-
 *        scale headers): the title cluster (title, facts line, plate+status,
 *        the bounty/sightings/last-seen stat band, quiet meta), the last-seen
 *        map (promoted — spotters act on WHERE first), "About this car"
 *        (clamped prose + "Show more" →
 *        /post-about; an honest "no description yet" line when prose-less),
 *        "Car details" (the FULL fact list in-page, gaps struck through),
 *        the owner passport card
 *        (OwnerCard), the (dormant) sighting-activity line, the SafetyNotice,
 *        an underlined report row, and the "More cars nearby" compact-card
 *        rail (the reference's "More stays nearby" shelf; useSimilarPosts).
 * WHY:   Splits the section rendering out of the screen so the screen file
 *        stays about orchestration (load → header → states). Section order is
 *        the domain-reordered composition from the redesign session: location
 *        and recognition above trust/meta, because a spotter's job is "where
 *        + what to look for". Every optional section is omitted entirely when
 *        its data is absent — old posts (no features / theft context / guided
 *        descriptions) never render an empty shell; the legacy owner's note
 *        only shows when there are no guided descriptions.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui (Button, ConfirmDialog, PlateChip, StatusBadge,
 *        SafetyNotice, VehicleCard, SkeletonVehicleCard);
 *        src/features/vehicles/lib/carDetails.ts;
 *        docs/design-refs/post-detail/GAP_ANALYSIS.md (composition B).
 */

import { Feather } from '@expo/vector-icons';
import { useRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { PostSightingsSection } from '@/features/sightings';
import { WatchToggle } from '@/features/watchlist';
import type { PostSummary } from '@/shared/types';

import { useTimeAgo } from '@/shared/hooks';
import { formatDateLabel, formatPounds } from '@/shared/lib';
import { colors, radii, sizes, spacing, typography } from '@/shared/theme';
import {
  AppImage,
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  PlateChip,
  SafetyNotice,
  SkeletonVehicleCard,
  StatusBadge,
  VehicleCard,
} from '@/shared/ui';

import { buildCarDetailRows } from '../lib/carDetails';
import { estimateRefundPence } from '../lib/refundEstimate';
import { theftContextLines } from '../lib/theftContext';
import type { PostDetail } from '../types';
// Direct import (not the ./editors barrel) so PostDetailBody doesn't pull the
// editors + their supabase-backed save API into its module graph.
import { SectionEditButton } from './editors/SectionEditButton';
import { LastSeenMap } from './LastSeenMap';
import { OwnerCard } from './OwnerCard';

/** In-page description clamp before "Show more" (the reference's ~6 lines). */
const ABOUT_CLAMP_LINES = 6;

export interface PostDetailBodyProps {
  post: PostDetail;
  /** Open the full search map centred on the last-seen point. */
  onOpenMap: () => void;
  /** Open the report-post confirm (the underlined row at the page's end). */
  onReport: () => void;
  /** SPOTTER only: message the owner. The handler opens the thread when the
   *  viewer already has a sighting, else routes them to report one first
   *  (chat is sighting-gated — DOMAIN Chat). Absent for the owner. */
  onMessageOwner?: () => void;
  /** Open the full "About this car" prose page (/post-about). */
  onShowAbout: () => void;
  /** The "More stolen cars nearby" rail (useSimilarPosts) — [] hides it. */
  similarPosts: PostSummary[];
  /** True while the rail loads — renders skeleton cards, never a spinner. */
  similarLoading: boolean;
  /** Open another post's detail from the rail. */
  onOpenPost: (post: PostSummary) => void;
  // OWNER-only per-section edit openers. Each is passed ONLY when that section
  // is editable for the post's status (draft-only for the money/identity four;
  // draft + live for the safe prose three — description, theft context, marks)
  // — presence = the pencil shows. The parent gates + mounts the editor overlay.
  onEditCarDetails?: () => void;
  onEditPhotos?: () => void;
  onEditLastSeen?: () => void;
  onEditBounty?: () => void;
  onEditDescription?: () => void;
  onEditTheftContext?: () => void;
  onEditDistinctiveFeatures?: () => void;
  /** OWNER + PAID (active / pending_verification) only: REQUEST deactivation.
   *  Presence = the deactivate control shows. The parent owns the confirm step
   *  (shared with the "Manage post" sheet's row, so there is exactly one
   *  confirm) and then runs the refund + toast. */
  onDeactivate?: () => void;
  /** OWNER + ACTIVE only: open the recovery flow. Presence = the control shows.
   *  Rendered ABOVE deactivate deliberately — getting the car back is the
   *  ending this product exists for; taking the listing down is giving up on
   *  it, and the good news should not be the harder one to find. */
  onRecovered?: () => void;
}

function Divider() {
  return <View style={styles.divider} />;
}

export function PostDetailBody({
  post,
  onOpenMap,
  onReport,
  onMessageOwner,
  onShowAbout,
  similarPosts,
  similarLoading,
  onOpenPost,
  onEditCarDetails,
  onEditPhotos,
  onEditLastSeen,
  onEditBounty,
  onEditDescription,
  onEditTheftContext,
  onEditDistinctiveFeatures,
  onDeactivate,
  onRecovered,
}: PostDetailBodyProps) {
  const { width: windowWidth } = useWindowDimensions();
  // The reference's carousel geometry (FeedCarouselRow): ~2 cards + a peek.
  const railCardWidth = Math.round(windowWidth * 0.44);
  // Hooks are unconditional; the "last seen" line gates on data.
  const lastSeenAgo = useTimeAgo(post.lastSeenAt ?? post.createdAt);


  const hasCoords = post.lat != null && post.lng != null;

  // The clamped in-page prose: the recognition text leads (it's the spotter's
  // most useful paragraph); older posts fall back to the legacy owner note.
  // (descDrives now lives in its own "How it was taken" section.)
  const aboutPreview = post.descRecognise ?? post.ownerNote;

  // The FULL inventory renders in-page (no "Show all" tap — product call
  // 2026-07-23): present facts first, then the muted "Not provided" gaps.
  const detailRows = buildCarDetailRows(post);

  // Theft context (stolen-from / keys-taken) as calm fact lines + the free-text
  // "how it drives" note — its own "How it was taken" section.
  const theftLines = theftContextLines(post);
  const hasTheftContent = theftLines.length > 0 || Boolean(post.descDrives);

  // The bounty explainer lives behind the ⓘ in the stat band (acknowledge
  // dialog), keeping the cluster to facts only.
  const bountyInfoRef = useRef<ConfirmDialogRef>(null);

  // The refund quoted in the deactivate section is an ESTIMATE (bounty minus
  // the ~card fee); the server computes and returns the exact figure. The
  // confirm dialog itself lives on the screen — the "Manage post" sheet opens
  // the same one, so the destructive copy exists exactly once.
  const estimatedRefundPence = estimateRefundPence(post.bountyPence);

  return (
    <View style={styles.body}>
      {/* 1 — Title cluster (the reference's under-hero anatomy: ONE tight
          block, each line with one job, no internal dividers) — title, facts
          line, identity row, then the stat band. The bounty lives in the band
          (small-but-bold, the Airbnb stat-module treatment) — its old
          display-size solo section duplicated the sticky bar's "£450 reward"
          a thumb away (design session 2026-07-23). */}
      {/* Listed-on: the quiet dateline, tucked right under the hero's curve
          (above the title cluster's own rhythm). Last-seen when/where
          belongs to the stat band and the map section. */}
      <Text style={styles.listedOn}>Listed on {formatDateLabel(post.createdAt)}</Text>

      <View style={[styles.section, styles.sectionAfterDateline]}>
        {/* Title row: the centred name + the plate chip beside it (the colour is
            carried by the "Car details" section, not a title chip). Wraps on
            narrow screens. */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {post.make} {post.model}
          </Text>
          {/* No plate → the make/model title alone carries the identity. */}
          {post.plate ? <PlateChip plate={post.plate} /> : null}
        </View>
        <View style={styles.badgeRow}>
          {/* Owner sees "Live" (green) on their own active post; a spotter
              viewing the same post sees no badge (public stays calm). */}
          <StatusBadge status={post.status} showLiveWhenActive={post.isOwner} />
          {/* Photos are the hero above — the owner edits them from here. */}
          {onEditPhotos ? (
            <SectionEditButton onPress={onEditPhotos} label="Edit photos" testID="edit-photos" />
          ) : null}
        </View>

        <View style={styles.statBand}>
          <View style={styles.statCell}>
            <View style={styles.bountyValueRow}>
              <Text style={styles.statValueBounty}>{formatPounds(post.bountyPence)}</Text>
              {onEditBounty ? (
                <SectionEditButton onPress={onEditBounty} label="Edit bounty" testID="edit-bounty" />
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="How the bounty works"
              onPress={() => bountyInfoRef.current?.open()}
              hitSlop={spacing.lg}
              style={styles.statLabelRow}
            >
              <Text style={styles.statLabel}>Bounty</Text>
              <Feather
                name="info"
                size={sizes.iconSm}
                color={colors.textSecondary}
                importantForAccessibility="no"
              />
            </Pressable>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{post.sightingCount}</Text>
            <Text style={styles.statLabel}>
              {post.sightingCount === 1 ? 'Sighting' : 'Sightings'}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{lastSeenAgo}</Text>
            <Text style={styles.statLabel}>Last seen</Text>
          </View>
        </View>

      </View>

      {/* 3 — Last seen here (promoted: spotters act on WHERE first). The
          place + time ride beside the title as a chip (same chrome as the
          identity chips — one badge grammar across the page). */}
      {hasCoords ? (
        <>
          <Divider />
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Last seen here</Text>
              {onEditLastSeen ? (
                <SectionEditButton onPress={onEditLastSeen} label="Edit last seen" testID="edit-last-seen" />
              ) : null}
              {post.lastSeenArea ? (
                <View
                  style={styles.chip}
                  accessible
                  accessibilityLabel={`Last seen${post.lastSeenAt ? ` ${lastSeenAgo}` : ''} near ${post.lastSeenArea}`}
                >
                  <Text style={styles.chipText}>
                    {post.lastSeenArea}
                    {post.lastSeenAt ? ` · ${lastSeenAgo}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>
            <LastSeenMap lat={post.lat as number} lng={post.lng as number} onOpenFull={onOpenMap} />
          </View>
        </>
      ) : null}

      {/* 4 — About this car: the reference's clamped description + the grey
          "Show more" block button → the full prose page (/post-about). The
          section always renders; a prose-less post states that honestly
          instead of hiding the section (product call 2026-07-23). */}
      <Divider />
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>About this car</Text>
          {onEditDescription ? (
            <SectionEditButton
              onPress={onEditDescription}
              label="Edit description"
              testID="edit-description"
            />
          ) : null}
        </View>
        {aboutPreview ? (
          <>
            <Text style={styles.prose} numberOfLines={ABOUT_CLAMP_LINES}>
              {aboutPreview}
            </Text>
            <Button
              label="Show more"
              variant="subtle"
              fullWidth={false}
              onPress={onShowAbout}
            />
          </>
        ) : (
          <Text style={styles.proseMissing}>
            {"The owner hasn't added a description yet."}
          </Text>
        )}
      </View>

      {/* 5 — Car details: the reference's amenities anatomy, but the FULL
          list in-page — every fact, then the muted struck-through "Not
          provided" gaps (stated, never omitted). */}
      <Divider />
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Car details</Text>
          {onEditCarDetails ? (
            <SectionEditButton
              onPress={onEditCarDetails}
              label="Edit car details"
              testID="edit-car-details"
            />
          ) : null}
        </View>
        <View style={styles.detailList}>
          {detailRows.map((row) => (
            <View
              key={row.key}
              style={styles.detailRow}
              accessible
              accessibilityLabel={row.missing ? `${row.label}: not provided` : row.label}
            >
              <Feather
                name={row.icon}
                size={sizes.icon}
                color={row.missing ? colors.textSecondary : colors.textPrimary}
                importantForAccessibility="no"
              />
              <Text style={[styles.detailValue, row.missing && styles.detailValueMissing]}>
                {row.label}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* 5a — How it was taken: the theft context (stolen from / keys taken /
          how it drives). Its own titled section (moved out of Car details).
          Shows when there's data OR the owner can edit (draft or live). */}
      {hasTheftContent || onEditTheftContext ? (
        <>
          <Divider />
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>How it was taken</Text>
              {onEditTheftContext ? (
                <SectionEditButton
                  onPress={onEditTheftContext}
                  label="Edit how it was taken"
                  testID="edit-theft-context"
                />
              ) : null}
            </View>
            {hasTheftContent ? (
              <>
                {theftLines.length > 0 ? (
                  <View style={styles.detailList}>
                    {theftLines.map((line, index) => (
                      <View key={`theft-${index}`} style={styles.detailRow}>
                        <Feather
                          name="info"
                          size={sizes.icon}
                          color={colors.textPrimary}
                          importantForAccessibility="no"
                        />
                        <Text style={styles.detailValue}>{line}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {post.descDrives ? <Text style={styles.prose}>{post.descDrives}</Text> : null}
              </>
            ) : (
              <Text style={styles.proseMissing}>No theft details added yet.</Text>
            )}
          </View>
        </>
      ) : null}

      {/* 5b — Distinctive features: owner-photographed identifying features (a
          cracked mirror, a sticker). Each is a photo + its description. Shows
          when there are features OR the owner can edit (draft or live). */}
      {post.distinctiveFeatures.length > 0 || onEditDistinctiveFeatures ? (
        <>
          <Divider />
          <View style={styles.section}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitle}>Distinctive features</Text>
              {onEditDistinctiveFeatures ? (
                <SectionEditButton
                  onPress={onEditDistinctiveFeatures}
                  label="Edit distinctive features"
                  testID="edit-distinctive-features"
                />
              ) : null}
            </View>
            {post.distinctiveFeatures.length > 0 ? (
              <View style={styles.featureList}>
                {post.distinctiveFeatures.map((feature, index) => (
                  <View key={`${feature.photoUrl}-${index}`} style={styles.featureRow}>
                    <AppImage
                      uri={feature.photoUrl}
                      style={styles.featurePhoto}
                      accessibilityLabel={`Distinctive feature: ${feature.description}`}
                    />
                    <Text style={styles.featureDescription}>{feature.description}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.proseMissing}>No distinctive features added yet.</Text>
            )}
          </View>
        </>
      ) : null}

      {/* 7 — Owner (the reference's host-passport placement — low on the
          page, the final reassurance). Calm register: "Owner", never "Meet
          the owner". */}
      <Divider />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Owner</Text>
        <OwnerCard owner={post.owner} sightingCount={post.sightingCount} />

        {/* Message the owner — SPOTTER side only (the owner reaches spotters
            through their sightings list). Chat is sighting-gated (DOMAIN
            Chat: no cold DMs), so the affordance is honest about the gate:
            a viewer who has reported opens the thread; everyone else is told
            reporting is what opens the conversation, and the handler routes
            them there. */}
        {!post.isOwner && onMessageOwner ? (
          <View style={styles.messageOwner}>
            <Text style={styles.messageOwnerText}>
              {post.viewerHasSighting
                ? 'Chat privately with the owner about your sighting.'
                : 'Spotted this car? Reporting a sighting opens a private, safe conversation with the owner.'}
            </Text>
            {post.viewerHasSighting ? (
              // A real distinct action (opens the thread) → a button. Subtle,
              // like the reference's "Message host": encouraged, but never
              // competing with the sticky bar's primary CTA.
              <Button
                label="Message the owner"
                variant="subtle"
                fullWidth={false}
                onPress={onMessageOwner}
              />
            ) : (
              // No-sighting: a QUIET link, not a second button — the sticky
              // bottom-bar "I've seen this car" is the primary route to the
              // same report flow; this is just a contextual entry from the
              // messaging framing (page's underlined-link grammar).
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Report a sighting to message the owner"
                onPress={onMessageOwner}
                style={styles.reportRow}
                hitSlop={spacing.sm}
              >
                <Text style={styles.reportLabel}>Report a sighting</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </View>

      {/* 7a2 — Got it back — OWNER + ACTIVE only. The recovery flow: credit the
          sighting that led to it, or say you found it another way. Above
          deactivate on purpose (see the prop's comment). */}
      {onRecovered ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Got your car back?</Text>
            <Text style={styles.deactivateBody}>
              Close the listing and either send the bounty to the spotter who found it,
              or get it back if you found it another way.
            </Text>
            <View style={styles.deactivateAction} testID="mark-recovered">
              <Button
                label="I got it back"
                fullWidth={false}
                onPress={onRecovered}
              />
            </View>
          </View>
        </>
      ) : null}

      {/* 7b — Deactivate listing — OWNER + PAID only. Takes the post down and
          refunds the bounty (minus the non-recoverable card fee). Server-
          enforced; the button is convenience. The confirm shows an estimate;
          the parent runs the refund and toasts the exact figure. */}
      {onDeactivate ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Deactivate listing</Text>
            <Text style={styles.deactivateBody}>
              Take this listing down and get your bounty back. You’ll be refunded about{' '}
              {formatPounds(estimatedRefundPence)} — the bounty minus the non-recoverable card fee.
            </Text>
            <View style={styles.deactivateAction} testID="deactivate-listing">
              <Button
                label="Deactivate & refund"
                variant="secondary"
                fullWidth={false}
                onPress={onDeactivate}
              />
            </View>
          </View>
        </>
      ) : null}

      {/* 8 — Sighting activity: the timeline, two faces from one mount
          point (PostSightingsSection). The owner gets the rich preview +
          warm empty; the public gets the restrained {time, locality}
          timeline or NOTHING — the section owns its divider/title so the
          public-empty case vanishes entirely. SAFETY: the old aggregate
          line is superseded; the face split and its fences live in the
          sightings feature (ADR-0008, SECURITY_AND_TRUST §6). */}
      <PostSightingsSection
        postId={post.id}
        isOwner={post.isOwner}
        // Anchor data for the timeline's arc ends — this page's own payload,
        // already coarsened for the viewer's face (adds nothing, ADR-0008).
        anchors={{
          status: post.status,
          lastSeenAt: post.lastSeenAt,
          lastSeenArea: post.lastSeenArea,
          createdAt: post.createdAt,
        }}
        // The theft point this page already maps ("Last seen here") roots the
        // trail; sighting points come from each face's own payload (ADR-0009).
        origin={
          post.lat !== undefined && post.lng !== undefined
            ? { lat: post.lat, lng: post.lng }
            : undefined
        }
      />

      {/* 9 — Safety. Deliberately NOT the reference's quiet "things to know"
          rows — the banner form stays unmissable (emotional translation). */}
      <Divider />
      <View style={styles.section}>
        <SafetyNotice />
      </View>

      {/* The bounty explainer popup — the promise that makes the number an
          act of help, not a price (emotional translation). */}
      <ConfirmDialog
        ref={bountyInfoRef}
        title="How the bounty works"
        body="The bounty is paid to the spotter whose sighting leads to this car's recovery. Money is held safely and only released when the owner confirms the car is back."
        confirmLabel="Got it"
        acknowledge
        onConfirm={() => {}}
      />

      {/* 10 — Report, the reference's trust-page grammar: an underlined text
          row at the page's end (underline = tappable). */}
      <Divider />
      <View style={styles.section}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report this post"
          onPress={onReport}
          style={styles.reportRow}
          hitSlop={spacing.sm}
        >
          <Feather
            name="flag"
            size={sizes.iconSm}
            color={colors.textPrimary}
            importantForAccessibility="no"
          />
          <Text style={styles.reportLabel}>Report this post</Text>
        </Pressable>
      </View>

      {/* 11 — More cars nearby (the reference's "More stays nearby" shelf,
          page's end): compact-card rail from the public feed centred on this
          car's last-seen point. The whole app is stolen cars, so the title
          doesn't repeat "stolen". Quietly absent when there's nothing to
          show. Full-bleed: the rail escapes the page gutter and carries the
          feed's own 16px one. */}
      {similarLoading || similarPosts.length > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {hasCoords ? 'More cars nearby' : 'More cars'}
            </Text>
            {similarLoading ? (
              <View style={[styles.rail, styles.railContent, styles.railSkeletonRow]}>
                <View style={{ width: railCardWidth }}>
                  <SkeletonVehicleCard variant="compact" />
                </View>
                <View style={{ width: railCardWidth }}>
                  <SkeletonVehicleCard variant="compact" />
                </View>
                <View style={{ width: railCardWidth }}>
                  <SkeletonVehicleCard variant="compact" />
                </View>
              </View>
            ) : (
              // ScrollView, not FlatList: ≤6 mounted compact cards need no
              // virtualization, and VirtualizedList's batching timers leak
              // into jest renders (seen 2026-07-23).
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={railCardWidth + spacing.md}
                snapToAlignment="start"
                decelerationRate="fast"
                style={styles.rail}
                contentContainerStyle={styles.railContent}
              >
                {similarPosts.map((item) => (
                  <View key={item.id} style={{ width: railCardWidth }}>
                    <VehicleCard
                      post={item}
                      variant="compact"
                      onPress={() => onOpenPost(item)}
                      topRightAction={<WatchToggle postId={item.id} source="feed" />}
                    />
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    // 24px gutter: post detail is a text/detail screen, not a feed surface.
    paddingHorizontal: spacing.xl,
  },
  section: {
    // The reference rhythm: 32pt each side of a divider, 16pt title→content.
    paddingVertical: spacing.xxl,
    gap: spacing.lg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  listedOn: {
    ...typography.caption,
    color: colors.textSecondary,
    alignSelf: 'flex-end',
    // Hugs the sheet's curved top edge, clear of the section rhythm below.
    paddingTop: spacing.lg,
  },
  // The dateline already provides the breathing room above the title.
  sectionAfterDateline: {
    paddingTop: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred name (+ plate chip) — product call. Wraps on narrow screens.
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'center',
    // Android pads font boxes asymmetrically (worse with custom faces) —
    // strip it so the chips beside the title centre on the GLYPHS.
    includeFontPadding: false,
  },
  // The page's fact chip (colour, last-seen): the plate's chip chrome (same
  // surface, radius, padding) — one badge grammar; text stays sentence case
  // (ALL-CAPS is plate-only).
  chip: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // `label` (14/18 Medium), not `cardTitle` (16 Bold): the fact chip must
  // read at the plate's size and a lighter weight, so the plate (14 Black)
  // stays the dominant identifier beside it and the two chips match height.
  chipText: {
    ...typography.label,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  // The similar-posts rail escapes the page's 24px gutter (full-bleed, like
  // the home feed's carousels) and carries the feed's 16px one itself.
  rail: {
    marginHorizontal: -spacing.xl,
  },
  railContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  railSkeletonRow: {
    flexDirection: 'row',
    overflow: 'hidden',
  },
  // Section header with a trailing fact chip, wrapping on narrow screens.
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Status badge + (owner) an edit-photos pencil, on one line.
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Bounty value + (owner) its edit pencil, centred in the stat cell.
  bountyValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // The stat band — the reference's stat-module anatomy (§4): bold number
  // over a tiny label, cells split by vertical hairlines, one quiet
  // hairline-bordered container.
  statBand: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  // Android: keep the bold stat numerals optically centred over their labels.
  statValue: {
    ...typography.heading,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  // accent stays bounty-only (DESIGN_SYSTEM colour rules; near-black, monochrome).
  statValueBounty: {
    ...typography.heading,
    color: colors.accent,
    includeFontPadding: false,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  // Label + ⓘ as one press target (hitSlop tops it up past the 44pt min).
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  sectionTitle: {
    // Title-scale section headers — the reference's ~26pt tier (C1: two steps
    // up from `heading`, deliberately bypassing `sectionTitle` 20).
    ...typography.title,
    color: colors.textPrimary,
    includeFontPadding: false,
  },
  detailList: {
    gap: spacing.sm,
  },
  detailRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  prose: {
    ...typography.body,
    color: colors.textPrimary,
  },
  // Honest absence, quiet voice — a fact about the post, not an error.
  proseMissing: {
    ...typography.body,
    color: colors.textSecondary,
  },
  // "Not provided" rows: muted + struck through (the reference's trust device).
  detailValueMissing: {
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  // Distinctive features: a photo thumbnail beside its description, one per row.
  featureList: {
    gap: spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  featurePhoto: {
    width: 72,
    height: 54, // 4:3, matching the photo grid aspect
    borderRadius: radii.md,
  },
  featureDescription: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  messageOwner: {
    // The section's own gap governs rhythm — no extra top margin (which would
    // compound to an off-rhythm 24px below the owner block).
    gap: spacing.md,
  },
  deactivateBody: {
    // Instructional copy introducing a money action = body, not caption/meta
    // (mirrors messageOwnerText).
    ...typography.body,
    color: colors.textSecondary,
  },
  deactivateAction: {
    // Sit the button under the explainer at the section's rhythm.
    marginTop: spacing.md,
  },
  messageOwnerText: {
    // Instructional copy introducing an action = body, not caption/meta.
    ...typography.body,
    color: colors.textSecondary,
  },
  reportRow: {
    minHeight: sizes.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
  },
  reportLabel: {
    ...typography.body,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
});
