/**
 * WHAT:  PostDetailBody — the scrollable content of a visible post, hairline-
 *        divided with the reference's generous rhythm (32pt sections, title-
 *        scale headers): the title cluster (make/model title, the tap-to-copy
 *        plate on the line beneath it, status,
 *        the bounty/sightings/last-seen stat band, quiet meta), the last-seen
 *        map (promoted — spotters act on WHERE first), "About this car"
 *        (clamped prose + "Show more" →
 *        /post-about; an honest "no description yet" line when prose-less),
 *        "Car details" (the FULL fact list in-page, gaps struck through),
 *        "Distinctive features" (the owner's photographed marks as cards —
 *        photo inset beside the description, truncated past three behind a
 *        grey "Show all N" block button), the owner passport card
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
 *        docs/design-refs/post-detail/GAP_ANALYSIS.md (composition B; B2 is
 *        the "Show all N" overflow pattern);
 *        docs/design-refs/airbnb-feed/1000014407.jpg (the card-list reference
 *        the distinctive-feature cards are built from).
 */

import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
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
import { estimateRefundPence, formatPounds } from '@/shared/lib';
import { radii, sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';
import {
  AppImage,
  Button,
  ConfirmDialog,
  type ConfirmDialogRef,
  NO_BOUNTY_LABEL,
  PlateChip,
  SafetyNotice,
  SkeletonVehicleCard,
  StatusBadge,
  VehicleCard,
} from '@/shared/ui';

import { buildCarDetailRows } from '../lib/carDetails';
import { theftContextLines } from '../lib/theftContext';
import type { PostDetail } from '../types';
// Direct import (not the ./editors barrel) so PostDetailBody doesn't pull the
// editors + their supabase-backed save API into its module graph.
import { SectionEditButton } from './editors/SectionEditButton';
import { LastSeenMap } from './LastSeenMap';
import { OwnerCard } from './OwnerCard';

/** In-page description clamp before "Show more" (the reference's ~6 lines). */
const ABOUT_CLAMP_LINES = 6;

/** Distinctive-feature cards shown before the grey "Show all N" block button
 *  takes over (the reference's overflow pattern, GAP_ANALYSIS B2). A post can
 *  carry up to MAX_DISTINCTIVE_FEATURES (8) marks. */
const FEATURE_PREVIEW_COUNT = 3;

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
  const styles = useThemedStyles(makeStyles);
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
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const { width: windowWidth } = useWindowDimensions();
  // The reference's carousel geometry (FeedCarouselRow): ~2 cards + a peek.
  const railCardWidth = Math.round(windowWidth * 0.44);
  // Hooks are unconditional; the "last seen" line gates on data.
  const lastSeenAgo = useTimeAgo(post.lastSeenAt ?? post.createdAt);

  // Distinctive features collapse past the third card (the reference's
  // "Show all N" pattern). `expanded` is pinned to `collapsible` so the slice
  // and the button can never disagree: the owner edits marks without this
  // component unmounting (the editor overlays the same screen), so the list
  // can shrink under a raw `showAllFeatures` at any time. The flag itself is
  // NOT reset — expand, trim below three, then add back, and the section
  // returns expanded. Cosmetic and rare; not worth an effect to chase.
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const features = post.distinctiveFeatures;
  const collapsible = features.length > FEATURE_PREVIEW_COUNT;
  const expanded = showAllFeatures && collapsible;
  const visibleFeatures = expanded ? features : features.slice(0, FEATURE_PREVIEW_COUNT);

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

  // A no-reward listing (ADR-0014) was paid for with the fixed platform fee
  // instead of a bounty. Derived once here because it changes THREE things on
  // this screen — the stat band, the explainer behind the ⓘ, and the deactivate
  // copy — and they must never disagree about which kind of listing this is.
  const noReward = post.bountyPence === null;

  // The refund quoted in the deactivate section is an ESTIMATE (bounty minus
  // the ~card fee); the server computes and returns the exact figure. The
  // confirm dialog itself lives on the screen — the "Manage post" sheet opens
  // the same one, so the destructive copy exists exactly once.
  //
  // NULL for a no-reward listing: there is nothing to refund, so there is no
  // estimate to quote. estimateRefundPence is never called with a null — it
  // would compute a nonsense figure for money that was never escrowed.
  // Narrowed on the field itself rather than via `noReward`, so the compiler can
  // see the null is gone before estimateRefundPence is called.
  const estimatedRefundPence =
    post.bountyPence === null ? null : estimateRefundPence(post.bountyPence);

  return (
    <View style={styles.body}>
      {/* 1 — Title cluster (the reference's under-hero anatomy: ONE tight
          block, each line with one job, no internal dividers) — title, facts
          line, identity row, then the stat band. The bounty lives in the band
          (small-but-bold, the Airbnb stat-module treatment) — its old
          display-size solo section duplicated the sticky bar's "£450 reward"
          a thumb away (design session 2026-07-23). */}
      {/* No "Listed on <date>" dateline (removed 2026-08-09): it answered a
          question nobody asked — when the LISTING was made says nothing about
          the car. What a spotter needs is when it was last SEEN, and the stat
          band below plus the map section both carry that. */}
      <View style={[styles.section, styles.sectionFirst]}>
        {/* Title row: the centred name on its own line (the colour is carried
            by the "Car details" section, not a title chip). */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>
            {post.make} {post.model}
          </Text>
        </View>
        {/* The plate sits UNDER the title rather than beside it (product call
            2026-08-09): beside a long make/model it wrapped to its own line
            anyway on narrow screens, so the layout was already two lines half
            the time — and inconsistently. Below, it is always the second line,
            and it has room for the copy affordance. */}
        {post.plate ? (
          <View style={styles.platePlacement}>
            <PlateChip plate={post.plate} onPress={null} />
          </View>
        ) : null}
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
              <Text
                // "No reward" is ~2x the width of "£500" and the cell is one of
                // three sharing the band's width, so at the value tier
                // (typography.title, 24pt) it wraps to two lines and drops the
                // ⓘ label out of line with "Sightings" and "Last seen". The
                // no-reward state therefore steps down a tier and holds ONE
                // line — the band's geometry is what keeps the cluster readable.
                style={post.bountyPence === null ? styles.statValueNone : styles.statValueBounty}
                numberOfLines={1}
              >
                {/* Narrowed on the field, not via `noReward` — so the compiler
                    sees the null is gone and no cast is needed. formatPounds
                    throws on a non-integer, which is why this is a real guard
                    rather than a formality. */}
                {post.bountyPence === null ? NO_BOUNTY_LABEL : formatPounds(post.bountyPence)}
              </Text>
              {onEditBounty ? (
                <SectionEditButton
                  onPress={onEditBounty}
                  // The editor changes the pricing MODE as well as the amount,
                  // so on a no-reward listing "Edit bounty" would name a thing
                  // that is not there. The testID stays stable for the tests.
                  label={noReward ? 'Edit reward' : 'Edit bounty'}
                  testID="edit-bounty"
                />
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={noReward ? 'How this listing works' : 'How the bounty works'}
              onPress={() => bountyInfoRef.current?.open()}
              hitSlop={spacing.lg}
              style={styles.statLabelRow}
            >
              {/* "Bounty" would be a lie under "No reward". "Reward" names the
                  thing the cell is about in both modes. */}
              <Text style={styles.statLabel}>{noReward ? 'Reward' : 'Bounty'}</Text>
              <Feather
                name="info"
                size={sizes.iconSm}
                color={palette.textSecondary}
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
            {/* NO "open in maps" affordance here, deliberately. This body is
                PUBLIC — every spotter and every logged-out browser reads it —
                and SECURITY_AND_TRUST §1 bans exactly this: "We never build
                features that facilitate pursuit: … no directions from spotter
                to vehicle." One was added here on 2026-08-08 and removed the
                same day on review. The coordinate itself is not the issue: it
                already ships in get_post_detail and LastSeenMap already draws
                it. The AFFORDANCE is — it turns "a car to look out for near
                you" into "drive here", which is the line §1 draws. The map tile
                opens OUR map (browse what else is nearby); that stays. */}
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
                color={row.missing ? palette.textSecondary : palette.textPrimary}
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
                          color={palette.textPrimary}
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
          cracked mirror, a sticker). Each is a card: the photo inset beside its
          description. Past FEATURE_PREVIEW_COUNT the list truncates behind the
          reference's grey "Show all N" block button. Shows when there are
          features OR the owner can edit (draft or live). */}
      {features.length > 0 || onEditDistinctiveFeatures ? (
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
            {features.length > 0 ? (
              <>
                <View style={styles.featureList}>
                  {visibleFeatures.map((feature, index) => (
                    // The card is ONE accessible object: the photo is the
                    // evidence for the description beside it, so a screen
                    // reader should hear the mark once, not twice.
                    <View
                      key={feature.id ?? `${feature.photoUrl}-${index}`}
                      style={styles.featureCard}
                      accessible
                      accessibilityLabel={`Distinctive feature: ${feature.description}`}
                    >
                      <AppImage uri={feature.photoUrl} style={styles.featurePhoto} />
                      <Text style={styles.featureDescription}>{feature.description}</Text>
                    </View>
                  ))}
                </View>
                {/* Section-level control, so it sits OUTSIDE the list and takes
                    the section's own 16pt gap (matching "Show more" above). */}
                {collapsible ? (
                  <Button
                    label={
                      expanded ? 'Show fewer features' : `Show all ${features.length} features`
                    }
                    variant="subtle"
                    onPress={() => setShowAllFeatures((shown) => !shown)}
                  />
                ) : null}
              </>
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
              {noReward
                ? // Both halves of the bounty sentence are false here: there is
                  // nothing to send and nothing to get back. What IS true is the
                  // credit, which on a no-reward listing is the spotter's whole
                  // reward (ADR-0014) — so it leads.
                  'Close the listing and credit the spotter who found it. There’s no cash reward to send, but the recovery goes on their spotter record.'
                : 'Close the listing and either send the bounty to the spotter who found it, or get it back if you found it another way.'}
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
              {estimatedRefundPence === null
                ? // No bounty means no refund, and the listing fee is not
                  // refundable (ADR-0014). Said before the tap, not after —
                  // this is the owner's last chance to learn it, though the
                  // pricing step disclosed it before they ever paid.
                  'Take this listing down. Your listing fee isn’t refunded — it covered putting the car in front of spotters.'
                : `Take this listing down and get your bounty back. You’ll be refunded about ${formatPounds(estimatedRefundPence)} — the bounty minus the non-recoverable card fee.`}
            </Text>
            <View style={styles.deactivateAction} testID="deactivate-listing">
              <Button
                label={estimatedRefundPence === null ? 'Deactivate listing' : 'Deactivate & refund'}
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
        title={noReward ? 'How this listing works' : 'How the bounty works'}
        body={
          noReward
            ? // Honest with the spotter about what they will and won't get. The
              // owner paid a flat fee to list, so there is no pot to share — and
              // saying so plainly is better than a vague "no reward" that leaves
              // someone hoping. The recognition on offer is real and is named.
              "There's no cash reward on this listing — the owner paid a flat listing fee instead. If your sighting leads to the car being found, the owner can still credit you, and the recovery is added to your spotter record."
            : "The bounty is paid to the spotter whose sighting leads to this car's recovery. Money is held safely and only released when the owner confirms the car is back."
        }
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
            color={palette.textPrimary}
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

const makeStyles = (c: Palette) => StyleSheet.create({
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
    backgroundColor: c.border,
  },
  // The first section carries its OWN clearance from the sheet's curved top
  // edge. It used to be `spacing.md`, which was enough only because the
  // now-removed dateline sat above it and contributed a line plus its own
  // spacing.lg; with that gone, md alone jammed the title into the curve.
  sectionFirst: {
    paddingTop: spacing.xl,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred name — product call. Wraps on narrow screens.
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // A ROW with justifyContent, not alignItems on a column: PlateChip sets
  // alignSelf:'flex-start' on itself (so it hugs its text), and alignSelf beats
  // a parent's alignItems — it would sit hard left. In a row, its alignSelf
  // only governs the cross (vertical) axis, so justifyContent centres it.
  platePlacement: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  title: {
    ...typography.title,
    color: c.textPrimary,
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
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  // `label` (14/18 Medium), not `cardTitle` (16 Bold): the fact chip must
  // read at the plate's size and a lighter weight, so the plate (14 Black)
  // stays the dominant identifier beside it and the two chips match height.
  chipText: {
    ...typography.label,
    color: c.textPrimary,
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
    color: c.textSecondary,
  },
  // The stat band — bold number over its label, cells parted by a SHORT
  // vertical rule. No container (product call 2026-08-09): the box was drawing
  // a border around three facts that already read as a group by alignment
  // alone, and on a page whose sections are separated by full-width hairlines
  // it was the one boxed module, which made it look like a control.
  // `center`, not `stretch` — stretch is what made the old dividers full-height
  // and is precisely what the short rule replaces.
  statBand: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  // `title` (24/Bold), a step up from the old `heading` (18): with the box
  // gone the numbers carry the module on their own, so they have to hold the
  // eye without a border helping them. Android: includeFontPadding off keeps
  // the numerals optically centred over their labels.
  statValue: {
    ...typography.title,
    color: c.textPrimary,
    includeFontPadding: false,
  },
  // accent stays bounty-only (DESIGN_SYSTEM colour rules; near-black, monochrome).
  statValueBounty: {
    ...typography.title,
    color: c.accent,
    includeFontPadding: false,
  },
  // The no-reward twin. Two deliberate differences from the value tier above:
  //   * `heading` (18) not `title` (24), so "No reward" fits one line in a cell
  //     that is one of three across the band — at 24pt it wraps and the ⓘ label
  //     falls out of line with the other two stats.
  //   * `textSecondary`, not `accent`. DESIGN_SYSTEM reserves the accent for
  //     bounty/value moments; painting the ABSENCE of value in it is exactly the
  //     dilution that rule exists to prevent. Matches BountyTag's own choice, so
  //     the card and the detail band say the same thing the same way.
  statValueNone: {
    ...typography.heading,
    color: c.textSecondary,
    includeFontPadding: false,
  },
  // `label` (14/Medium) rather than `caption` (13/Regular) — the labels carry
  // weight now too, so the whole band reads bold rather than a bold number
  // sitting on a thin one. Role tokens, not raw fontFamilies (house rule).
  statLabel: {
    ...typography.label,
    color: c.textSecondary,
  },
  // Label + ⓘ as one press target (hitSlop tops it up past the 44pt min).
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // A short "|" between cells, not a full-height rule: it separates without
  // implying a table. Fixed height because the band is `center`-aligned now —
  // there is no row height for it to stretch to. borderStrong, not border: at
  // 24px tall and a hairline wide there is very little ink to see, and the
  // lighter token disappears against the background.
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: spacing.xl,
    backgroundColor: c.borderStrong,
  },
  sectionTitle: {
    // Title-scale section headers — the reference's ~26pt tier (C1: two steps
    // up from `heading`, deliberately bypassing `sectionTitle` 20).
    ...typography.title,
    color: c.textPrimary,
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
    color: c.textPrimary,
    flex: 1,
  },
  prose: {
    ...typography.body,
    color: c.textPrimary,
  },
  // Honest absence, quiet voice — a fact about the post, not an error.
  proseMissing: {
    ...typography.body,
    color: c.textSecondary,
  },
  // "Not provided" rows: muted + struck through (the reference's trust device).
  detailValueMissing: {
    color: c.textSecondary,
    textDecorationLine: 'line-through',
  },
  // Distinctive features: the reference's card list — a hairline-bordered white
  // card per mark, its photo inset and rounded, the description carrying the
  // card as a bold body-size line. The photo is the evidence; the card gives it
  // standing without pretending to be tappable.
  featureList: {
    // 12 — the measured gap between the reference's cards.
    gap: spacing.md,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    // Uniform inset (matching the editor's card for the same content), so the
    // photo sits optically centred rather than shoved against one edge.
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: c.surface,
    borderRadius: radii.lg,
    // A quiet container, NOT an elevated one (the statBand grammar above).
    // The reference's cards are shadowed because they are TAPPABLE; ours are
    // not, and a shadow would promise an interaction that isn't there.
    // OwnerCard stays the page's one deliberately-elevated object.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.border,
  },
  featurePhoto: {
    width: sizes.featureThumb,
    // 4:3 by ratio, not a second magic number — the crop can't drift.
    aspectRatio: 4 / 3,
    borderRadius: radii.md,
  },
  featureDescription: {
    // cardTitle, NOT heading: bold at body size so the photo stays the hero
    // (typography.ts). `heading` is this page's stat-numeral tier — a mark must
    // not carry the same weight as the bounty figure.
    ...typography.cardTitle,
    color: c.textPrimary,
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
    color: c.textSecondary,
  },
  deactivateAction: {
    // Sit the button under the explainer at the section's rhythm.
    marginTop: spacing.md,
  },
  messageOwnerText: {
    // Instructional copy introducing an action = body, not caption/meta.
    ...typography.body,
    color: c.textSecondary,
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
    color: c.textPrimary,
    textDecorationLine: 'underline',
  },
});
