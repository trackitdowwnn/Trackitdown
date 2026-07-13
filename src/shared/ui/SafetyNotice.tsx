/**
 * WHAT:  SafetyNotice — the app-wide "report, don't approach" banner with
 *        FIXED copy: never approach/follow/confront, call 999 if a crime is
 *        in progress.
 * WHY:   SECURITY_AND_TRUST §1 requires the SAME safety message on every
 *        sighting flow, alert, chat thread, and the post-detail page. Making
 *        it one component with non-overridable copy guarantees the wording
 *        never drifts — this is a product-safety requirement, not decoration.
 * LINKS: docs/SECURITY_AND_TRUST.md §1; docs/DOMAIN.md (sighting rules);
 *        src/features/vehicles (post detail); later sightings / chat / alerts.
 */

import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, sizes, spacing, typography } from '../theme';

const TITLE = 'Stay safe — report, don’t approach';
const BODY =
  'Never approach the vehicle, follow it, or confront anyone. If a crime is in progress, call 999.';

export function SafetyNotice() {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${TITLE}. ${BODY}`}
      style={styles.banner}
    >
      <Feather name="shield" size={sizes.icon} color={colors.textPrimary} />
      <View style={styles.text}>
        <Text style={styles.title}>{TITLE}</Text>
        <Text style={styles.body}>{BODY}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  body: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
