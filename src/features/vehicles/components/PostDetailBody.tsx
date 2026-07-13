/**
 * WHAT:  PostDetailBody — the scrollable content of a visible post, hairline-
 *        divided with generous rhythm: title, bounty, trust block, details
 *        grid, features grid, guided descriptions (How to spot it / How it
 *        drives) or the legacy owner's note, theft details, "last seen here"
 *        map, the owner block, the (dormant) sighting-activity line, and the
 *        SafetyNotice.
 * WHY:   Splits the section rendering out of the screen so the screen file
 *        stays about orchestration (load → header → states). Every optional
 *        section is omitted entirely when its data is absent — so old posts
 *        (no features / theft context / guided descriptions) never render an
 *        empty shell, and the legacy owner's note only shows when there are no
 *        guided descriptions.
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx;
 *        src/shared/ui (PlateChip, StatusBadge, ReadMore, SafetyNotice);
 *        src/features/vehicles/components/LastSeenMap.tsx.
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
}

function Divider() {
  return <View style={styles.divider} />;
}

export function PostDetailBody({ post, onOpenMap }: PostDetailBodyProps) {
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

  // Colour already shows in the identity line above, so the grid carries only
  // body type + features — and the whole section drops out when it has neither.
  const detailRows: { icon: FeatherName; value: string }[] = [
    ...(post.bodyType ? [{ icon: 'truck' as FeatherName, value: post.bodyType }] : []),
    ...(post.distinguishingFeatures
      ? [{ icon: 'star' as FeatherName, value: post.distinguishingFeatures }]
      : []),
  ];

  const hasCoords = post.lat != null && post.lng != null;
  const theftLines = theftContextLines(post);

  return (
    <View style={styles.body}>
      {/* 1 — Title block */}
      <View style={styles.section}>
        <Text style={styles.title}>
          {post.make} {post.model}
        </Text>
        <View style={styles.identityRow}>
          <PlateChip plate={post.plate} />
          {identityMeta ? <Text style={styles.identityMeta}>{identityMeta}</Text> : null}
        </View>
        <StatusBadge status={post.status} />
        <Text style={styles.meta}>{metaParts.join(' · ')}</Text>
      </View>

      <Divider />

      {/* 2 — Bounty block */}
      <View style={styles.section}>
        <Text style={styles.bounty}>{formatPounds(post.bountyPence)}</Text>
        <Text style={styles.bountyCaption}>
          Paid to the spotter whose sighting leads to recovery.
        </Text>
      </View>

      {/* 3 — Trust & verification */}
      <Divider />
      <View style={styles.section}>
        <TrustBlock status={post.status} createdAt={post.createdAt} expiresAt={post.expiresAt} />
      </View>

      {/* 4 — Details grid (omitted entirely when there's no data) */}
      {detailRows.length > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.detailGrid}>
              {detailRows.map((row) => (
                <View key={row.icon} style={styles.detailRow} accessible>
                  <Feather
                    name={row.icon}
                    size={sizes.iconSm}
                    color={colors.textSecondary}
                    importantForAccessibility="no"
                  />
                  <Text style={styles.detailValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}

      {/* 5 — Features (Part 2 taxonomy; empty on old posts → omitted). */}
      {post.features.length > 0 ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Features</Text>
            <FeaturesGrid features={post.features} />
          </View>
        </>
      ) : null}

      {/* 6 — Descriptions: guided prompts (new posts) and/or legacy note. Each
          is independent so old and new posts both render whatever they have. */}
      {post.descRecognise ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>How to spot it</Text>
            <ReadMore>{post.descRecognise}</ReadMore>
          </View>
        </>
      ) : null}
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

      {/* 7 — Theft details (Part 2; coarse — never an address). */}
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

      {/* 8 — Last seen here */}
      {hasCoords ? (
        <>
          <Divider />
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Last seen here</Text>
            <LastSeenMap lat={post.lat as number} lng={post.lng as number} onOpenFull={onOpenMap} />
            {post.lastSeenArea ? (
              <Text style={styles.meta}>
                {post.lastSeenArea}
                {post.lastSeenAt ? ` · ${lastSeenAgo}` : ''}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      {/* 9 — Owner (Airbnb "meet the host" placement — low, after the listing). */}
      <Divider />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Owner</Text>
        <OwnerBlock owner={post.owner} />
      </View>

      {/* 10 — Sighting activity — dormant until the sightings feature ships.
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
          </View>
        </>
      ) : null}

      {/* 11 — Safety */}
      <Divider />
      <View style={styles.section}>
        <SafetyNotice />
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
    paddingVertical: spacing.xl,
    gap: spacing.sm,
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
    ...typography.heading,
    color: colors.textPrimary,
  },
  detailGrid: {
    gap: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
});
