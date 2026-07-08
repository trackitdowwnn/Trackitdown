/**
 * WHAT:  EmptyState — the app's "nothing here" primitive: an optional
 *        illustration slot, a one-line explanation, optional supporting
 *        body text, and an optional action button.
 * WHY:   Empty moments (no search matches, no sightings yet, no posts
 *        nearby) should feel calm and helpful, never like an error
 *        (docs/DESIGN_SYSTEM.md, Core components). Centralising the layout
 *        keeps every empty screen consistent and guarantees an action is
 *        offered where one makes sense. The illustration is a slot so
 *        screens can drop in anything from an emoji to an SVG without this
 *        component knowing about assets.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components, Tone of voice);
 *        src/shared/ui/Button.tsx; src/shared/theme.
 *
 * Usage:
 *   <EmptyState
 *     title="No matches for 'Astom'"
 *     body="Check the spelling or try a shorter search."
 *     actionLabel="Clear search"
 *     onAction={clearSearch}
 *   />
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { Button } from './Button';

export interface EmptyStateProps {
  /** One-line explanation of why there's nothing here. Sentence case, calm. */
  title: string;
  /** Optional supporting sentence under the title. */
  body?: string;
  /** Optional illustration slot (emoji, image, SVG) rendered above the text. */
  illustration?: ReactNode;
  /** Optional action — rendered as a ghost button so it invites, not shouts. */
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, body, illustration, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {illustration ? <View style={styles.illustration}>{illustration}</View> : null}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} variant="ghost" fullWidth={false} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  illustration: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.md,
  },
});
