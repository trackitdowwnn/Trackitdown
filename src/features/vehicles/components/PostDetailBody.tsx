/**
 * WHAT:  PostDetailBody — the scrollable content of a visible post, hairline-
 *        divided with the reference's generous rhythm (32pt sections, title-
 *        scale headers): title, bounty, the last-seen map (promoted — spotters
 *        act on WHERE first), "What to look for" (details + features + how to
 *        spot it), "How it drives", the trust highlights, theft details, the
 *        owner block, the (dormant) sighting-activity line, the SafetyNotice,
 *        and an underlined report row.
 * WHY:   Splits the section rendering out of the screen so the screen file
 *        stays about orchestration (load → header → states). Section order is
 *        the domain-reordered composition from the redesign session: location
 *        and recognition above trust/meta, because a spotter's job is "where
 *        + what to look for". Every optional section is omitted entirely when
 *        its data is absent — old posts (no features / theft context / guided
 *        descriptions) never render an empty shell; the legacy owner's note
 *        only shows when there are no guided descriptions.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui (PlateChip, StatusBadge, ReadMore, SafetyNotice);
 *        docs/design-refs/post-detail/GAP_ANALYSIS.md (composition B).
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTimeAgo } from '@/shared/hooks';
import { formatPounds } from '@/shared/lib';
import { colors, sizes, spacing, typography } from '@/shared/theme';
import { PlateChip, ReadMore, SafetyNotice, StatusBadge } from '@/shared/ui';

import { theftContextLines } from '../lib/theftContext';
import type { PostDetail } from '../types';
import { FeaturesGrid } from './FeaturesGrid';
import { LastSeenMap } from './LastSeenMap';
import { OwnerBlock } from './OwnerBlock';
import { TrustBlock } from './TrustBlock';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface PostDetailBodyProps {
  post: PostDetail;
  /** Open the full search map centred on the last-seen point. */
  onOpenMap: () => void;
  /** Open the report-post confirm (the underlined row at the page's end). */
  onReport: () => void;
  /** OWNER only: open their sighting list. Absent for spotters — the
   *  aggregate line stays a plain, non-navigable fact (SECURITY_AND_TRUST §6). */
  onViewSightings?: () => void;
}

function Divider() {
  return <View style={styles.divider} />;
}

export function PostDetailBody({
  post,
  onOpenMap,
  onReport,
  onViewSightings,
}: PostDetailBodyProps) {
  // Hooks are unconditional; the "last seen" and sighting lines gate on data.
  const lastSeenAgo = useTimeAgo(post.lastSeenAt ?? post.createdAt);
  const postedAgo = useTimeAgo(post.createdAt);
  const latestSightingAgo = useTimeAgo(post.latestSightingAt ?? post.createdAt);

  const metaParts: string[] = [];
  if (post.lastSeenAt) {
    metaParts.push(
      `Last seen ${lastSeenAgo}${post.lastSeenArea ? ` near ${post.lastSeenArea}` : ''}`,
    );
  }
  metaParts.push(`Posted ${postedAgo}`);

  const identityMeta = [post.colour, post.year].filter(Boolean).join(' · ');

  // Colour already shows in the identity line above, so the recognition rows
  // carry only body type + prose distinguishing features.
  const detailRows: { icon: FeatherName; value: string }[] = [
    ...(post.bodyType ? [{ icon: 'truck' as FeatherName, value: post.bodyType }] : []),
    ...(post.distinguishingFeatures
      ? [{ icon: 'star' as FeatherName, value: post.distinguishingFeatures }]
      : []),
  ];

  const hasCoords = post.lat != null && post.lng != null;
  const theftLines = theftContextLines(post);
  // "What to look for" = everything that helps a spotter RECOGNISE the car.
  // Omitted entirely when an old post has none of its three pieces.
  const hasLookFor = detailRows.length > 0 || post.features.length > 0 || !!post.descRecognise;

  return (
    <View style={styles.body}>
      {/* 1 — Title block */}
      <View style={styles.section}>
        <Text style={styles.title}>
          {post.make} {post.model}
        </Text>
        <View style={styles.identityRow}>
          {/* No plate → the make/model title above carries the identity. */}
          {post.plate ? <PlateChip plate={post.plate} /> : null}
          {identityMeta ? <Text style={styles.identityMeta}>{identityMeta}</Text> : null}
        </View>
        <StatusBadge status={post.status} />
        <Text style={styles.meta}>{metaParts.join(' · ')}</Text>
      </View>

      <Divider />

      {/* 2 — Bounty block. Emotional translation: a promise of help repaid,
          never a price asking for money — plain statement, no urgency. */}
      <View style={styles.section}>
        <Text style={styles.bounty}>{formatPounds(post.bountyPence)}</Text>
        <Text style={styles.bountyCaption}>
          Paid to the spotter whose sighting leads to recovery.
        </Text>
      </View>

      {/* 3 — Last seen here (promoted: spotters act on WHERE first).
          Reference order inside the section: title → place line → map. */}
      {hasCoords ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Last seen here</Text>
            {post.lastSeenArea ? (
              <Text style={styles.meta}>
                {post.lastSeenArea}
                {post.lastSeenAt ? ` · ${lastSeenAgo}` : ''}
              </Text>
            ) : null}
            <LastSeenMap lat={post.lat as number} lng={post.lng as number} onOpenFull={onOpenMap} />
          </View>
        </>
      ) : null}

      {/* 4 — What to look for: body type, structured features, and the
          owner's "how to spot it" prose — the spotter's recognition kit. */}
      {hasLookFor ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>What to look for</Text>
            {detailRows.length > 0 ? (
              <View style={styles.detailList}>
                {detailRows.map((row) => (
                  <View key={row.icon} style={styles.detailRow} accessible>
                    <Feather
                      name={row.icon}
                      size={sizes.icon}
                      color={colors.textPrimary}
                      importantForAccessibility="no"
                    />
                    <Text style={styles.detailValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {post.features.length > 0 ? <FeaturesGrid features={post.features} /> : null}
            {post.descRecognise ? <ReadMore>{post.descRecognise}</ReadMore> : null}
          </View>
        </>
      ) : null}

      {/* 5 — How it drives (guided prompt; independent of the section above
          so old and new posts both render whatever they have). */}
      {post.descDrives ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How it drives</Text>
            <ReadMore>{post.descDrives}</ReadMore>
          </View>
        </>
      ) : null}

      {/* Legacy free-text note — only when there are NO guided descriptions
          (old posts), so new posts never show duplicated prose. */}
      {post.ownerNote && !post.descRecognise && !post.descDrives ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{"Owner's note"}</Text>
            <ReadMore>{post.ownerNote}</ReadMore>
          </View>
        </>
      ) : null}

      {/* 6 — Trust & verification (highlight rows; no section title — the
          headline facts are the titles, per the reference's highlights). */}
      <Divider />
      <View style={styles.section}>
        <TrustBlock status={post.status} createdAt={post.createdAt} expiresAt={post.expiresAt} />
      </View>

      {/* 7 — Theft details (coarse; never an address — SAFETY, DOMAIN.md). */}
      {theftLines.length > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Theft details</Text>
            {theftLines.map((line) => (
              <Text key={line} style={styles.detailValue}>
                {line}
              </Text>
            ))}
          </View>
        </>
      ) : null}

      {/* 8 — Owner (the "meet the host" placement — low, after the listing). */}
      <Divider />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Owner</Text>
        <OwnerBlock owner={post.owner} />
      </View>

      {/* 9 — Sighting activity — dormant until the sightings feature ships.
          SAFETY: aggregate count ONLY — never individual sightings or their
          locations to a non-owner (SECURITY_AND_TRUST §6). */}
      {post.sightingCount > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sighting activity</Text>
            <Text style={styles.meta}>
              {post.sightingCount} {post.sightingCount === 1 ? 'sighting' : 'sightings'} reported
              {post.latestSightingAt ? ` — most recent ${latestSightingAgo}` : ''}
            </Text>
            {/* Owner only: the aggregate becomes a doorway to their list. */}
            {onViewSightings ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View sightings"
                onPress={onViewSightings}
                style={styles.reportRow}
                hitSlop={spacing.sm}
              >
                <Text style={styles.reportLabel}>View sightings</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}

      {/* 10 — Safety. Deliberately NOT the reference's quiet "things to know"
          rows — the banner form stays unmissable (emotional translation). */}
      <Divider />
      <View style={styles.section}>
        <SafetyNotice />
      </View>

      {/* 11 — Report, the reference's trust-page grammar: an underlined text
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
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  identityMeta: {
    ...typography.body,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  bounty: {
    ...typography.display,
    // `accent` (not `accentText`) is the token for large terracotta type.
    color: colors.accent,
  },
  bountyCaption: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    // Title-scale section headers — the reference's ~26pt tier (C1: two steps
    // up from `heading`, deliberately bypassing `sectionTitle` 20).
    ...typography.title,
    color: colors.textPrimary,
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
