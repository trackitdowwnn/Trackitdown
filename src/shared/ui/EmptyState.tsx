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

import { spacing, typography, useThemedStyles, type Palette } from '../theme';
import { Button } from './Button';

export interface EmptyStateProps {
  /** One-line explanation of why there's nothing here. Sentence case, calm. */
  title: string;
  /** Optional supporting sentence under the title. */
  body?: string;
  /** Optional illustration slot (emoji, image, SVG) rendered above the text. */
  illustration?: ReactNode;
  /** Optional action — a ghost button by default, so it invites, not shouts. */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * How loudly the action asks. Default `'ghost'`, which is right for an
   * incidental empty screen.
   *
   * ⚠️ PASS `'primary'` ONLY FOR A FEATURE'S ONE CONVERSION MOMENT — a screen
   * where the empty state IS the product's ask, not an aside. Alerts is the
   * case that prompted this: its README opens with "nobody is notified about
   * anything until one exists", and it had been quietly inviting with a ghost.
   * The garage had already reached the same conclusion and worked around it by
   * rendering its own Button underneath, which left the CTA 64pt clear of the
   * sentence that motivates it and stretched full-width under centred, inset
   * text. Inside the primitive, it inherits the right measure and rhythm.
   */
  actionVariant?: 'ghost' | 'primary';
  /**
   * Who owns the horizontal gutter. Default `'default'` — this pads itself by
   * 24, which is right when it is dropped into an unpadded screen.
   *
   * ⚠️ PASS `'none'` INSIDE AN ALREADY-PADDED SCROLL. Otherwise the two stack
   * to 48 a side and the body sets a narrow centred column — on a 390pt phone
   * a 33-word sentence wraps to seven or eight lines. Same trap, same escape,
   * as NudgeRow's `gutter`.
   */
  gutter?: 'default' | 'none';
}

export function EmptyState({
  title,
  body,
  illustration,
  actionLabel,
  onAction,
  actionVariant = 'ghost',
  gutter = 'default',
}: EmptyStateProps) {
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={[styles.container, gutter === 'none' && styles.containerFlush]}>
      {illustration ? <View style={styles.illustration}>{illustration}</View> : null}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          {/* fullWidth stays false at both weights: the text above is centred
              and inset, so an edge-to-edge button would give the block two
              different measures. */}
          <Button
            label={actionLabel}
            variant={actionVariant}
            fullWidth={false}
            onPress={onAction}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxxl,
      gap: spacing.md,
    },
    // The caller's scroll already owns the gutter — see the `gutter` prop.
    containerFlush: { paddingHorizontal: 0 },
    illustration: {
      marginBottom: spacing.md,
    },
    title: {
      ...typography.heading,
      color: c.textPrimary,
      textAlign: 'center',
    },
    body: {
      ...typography.body,
      color: c.textSecondary,
      textAlign: 'center',
    },
    action: {
      marginTop: spacing.md,
    },
  });
