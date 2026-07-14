/**
 * WHAT:  PermissionPrimer — the calm explain-before-you-ask screen shown
 *        ahead of an OS permission prompt (and re-shown, with a settings
 *        action, when the permission is blocked): icon, one-line title, a
 *        plain-English reason, a primary action, and an optional secondary
 *        "continue without" path.
 * WHY:   OS prompts convert far better when the user already knows why the
 *        app is asking, and a blocked permission needs a route to Settings
 *        rather than a dead re-prompt. Purely presentational — the CONSUMER
 *        owns when to request, what "without" means (e.g. a sighting without
 *        GPS is still valuable), and the actual permission APIs.
 * LINKS: src/shared/ui/CameraCapture.tsx (first consumer, camera permission);
 *        src/features/sightings (location priming); docs/DESIGN_SYSTEM.md
 *        (Tone of voice — clarity, never lecturing).
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '../theme';
import { Button } from './Button';

export interface PermissionPrimerProps {
  /** Icon slot rendered in a soft circular tile (e.g. a Feather icon). */
  icon?: ReactNode;
  /** One line: what we're asking for. Sentence case, calm. */
  title: string;
  /** Plain-English why — the user's benefit, not the app's need. */
  body: string;
  /** Primary action ("Allow camera" → request; "Open settings" when blocked). */
  primaryLabel: string;
  onPrimary: () => void;
  /** Optional opt-out path ("Continue without location") — never punitive. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function PermissionPrimer({
  icon,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: PermissionPrimerProps) {
  return (
    <View style={styles.container}>
      {icon ? <View style={styles.iconTile}>{icon}</View> : null}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.actions}>
        <Button label={primaryLabel} onPress={onPrimary} />
        {secondaryLabel && onSecondary ? (
          <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  iconTile: {
    width: sizes.avatarLg,
    height: sizes.avatarLg,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceSubtle,
    alignItems: 'center',
    justifyContent: 'center',
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
  actions: {
    alignSelf: 'stretch',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
});
