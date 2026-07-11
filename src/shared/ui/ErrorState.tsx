/**
 * WHAT:  ErrorState — the app's "something broke" primitive: a calm title,
 *        optional detail line, and a retry button. The failure-mode sibling
 *        of EmptyState.
 * WHY:   Errors must read as recoverable, not alarming (docs/DESIGN_SYSTEM.md
 *        tone rules — warm, never "police app"). Centralising the layout
 *        guarantees every failed load offers a way forward, and the retry is
 *        a secondary (not danger) button because the user did nothing wrong.
 * LINKS: docs/DESIGN_SYSTEM.md (Core components, Tone of voice);
 *        src/shared/ui/EmptyState.tsx; src/shared/ui/Button.tsx.
 *
 * Usage:
 *   <ErrorState body="We couldn't load the feed." onRetry={refetch} />
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { Button } from './Button';

export interface ErrorStateProps {
  /** One-line headline. Sentence case, calm. */
  title?: string;
  /** Optional supporting sentence under the title. */
  body?: string;
  retryLabel?: string;
  /** Omit to render no button (rare — errors should almost always offer retry). */
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  body,
  retryLabel = 'Try again',
  onRetry,
}: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {onRetry ? (
        <View style={styles.action}>
          <Button label={retryLabel} variant="secondary" fullWidth={false} onPress={onRetry} />
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
