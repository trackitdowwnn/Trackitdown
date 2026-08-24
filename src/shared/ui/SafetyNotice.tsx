/**
 * WHAT:  SafetyNotice — the app-wide "report, don't approach" banner with
 *        FIXED copy: never approach/follow/confront, call 999 if a crime is
 *        in progress. Optionally `collapsible`, which pins it as a single
 *        titled line that expands to the full body on tap.
 * WHY:   SECURITY_AND_TRUST §1 requires the SAME safety message on every
 *        sighting flow, alert, chat thread, and the post-detail page. Making
 *        it one component with non-overridable copy guarantees the wording
 *        never drifts — this is a product-safety requirement, not decoration.
 *
 *        The collapsible form exists for CHAT (2026-08-05), where the notice
 *        is pinned above a live conversation rather than read once in a flow:
 *        at full height it cost ~100dp of every thread forever, which with the
 *        keyboard open left barely two visible messages. Three things make the
 *        shrink safe rather than a quiet weakening:
 *          · it is not dismissible — collapsed is still PRESENT, on screen, on
 *            every thread, exactly as §1 requires;
 *          · the accessibility label is the FULL title + body in both states,
 *            so nothing is hidden from a screen reader at any point;
 *          · role stays `alert`, and the title itself — the actionable half,
 *            "report, don't approach" — is the part that stays visible.
 *        Only the elaboration folds away. Default is the full banner, so
 *        every existing consumer is untouched.
 * LINKS: docs/SECURITY_AND_TRUST.md §1; docs/DOMAIN.md (sighting rules);
 *        src/features/vehicles (post detail); src/features/sightings;
 *        src/features/chat/screens/ChatThreadScreen.tsx (the collapsible one).
 */

import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  radii,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '../theme';

/**
 * The §1 wording, exported because it is now repeated OUTSIDE this component:
 * SightingDetailScreen's confirm restates it before handing an owner the exact
 * captured point to a maps app. Repeating it there is deliberate — that is the
 * moment it most needs re-reading — but a second hand-typed copy would drift
 * from this one silently, and safety copy is the last text in the app that
 * should say two different things in two places. Import, never retype.
 */
export const SAFETY_NOTICE_TITLE = 'Stay safe — report, don’t approach';

/**
 * The rule itself, without the 999 clause.
 *
 * Exported for ONBOARDING, which shows a one-line pill rather than this
 * component — a calm register is right on a first screen, and 999 belongs at
 * the moment of a live sighting, not while someone is reading what the app is.
 * It was a third hand-typed wording until 2026-08-24 ("Never approach or follow
 * a vehicle."), which quietly dropped "or confront anyone" and made the app’s
 * FIRST safety utterance its weakest.
 *
 * BODY is built from it, so the two cannot say different things.
 */
export const SAFETY_RULE_LINE =
  'Never approach the vehicle, follow it, or confront anyone.';
export const SAFETY_NOTICE_BODY = `${SAFETY_RULE_LINE} If a crime is in progress, call 999.`;

const TITLE = SAFETY_NOTICE_TITLE;
const BODY = SAFETY_NOTICE_BODY;
const FULL_LABEL = `${TITLE}. ${BODY}`;

export interface SafetyNoticeProps {
  /**
   * Pin as one line that expands on tap. For surfaces where the notice sits
   * ABOVE live content for the whole session (chat) rather than being read
   * once in a flow. Never a way to hide it — see the header.
   */
  collapsible?: boolean;
}

export function SafetyNotice({ collapsible = false }: SafetyNoticeProps) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);

  if (!collapsible) {
    return (
      <View accessible accessibilityRole="alert" accessibilityLabel={FULL_LABEL} style={styles.banner}>
        <Feather name="shield" size={sizes.icon} color={palette.textPrimary} />
        <View style={styles.text}>
          <Text style={styles.title}>{TITLE}</Text>
          <Text style={styles.body}>{BODY}</Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessible
      accessibilityRole="alert"
      // The whole message, collapsed or not — a screen reader never gets the
      // short form.
      accessibilityLabel={FULL_LABEL}
      accessibilityHint={expanded ? 'Hide the details' : 'Show the full safety advice'}
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((open) => !open)}
      style={({ pressed }) => [styles.strip, pressed && styles.stripPressed]}
      testID="safety-notice-collapsible"
    >
      <View style={styles.stripRow}>
        <Feather name="shield" size={sizes.iconSm} color={palette.textPrimary} />
        <Text style={styles.stripTitle} numberOfLines={2}>
          {TITLE}
        </Text>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={sizes.iconSm}
          color={palette.textSecondary}
        />
      </View>
      {expanded ? <Text style={styles.stripBody}>{BODY}</Text> : null}
    </Pressable>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.lg,
      padding: spacing.lg,
    },
    text: {
      flex: 1,
      gap: spacing.xs,
    },
    title: {
      ...typography.cardTitle,
      color: c.textPrimary,
    },
    body: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // Full-bleed strip, not a card: it is chrome on the thread, and a rounded
    // floating card here would compete with the message bubbles below it.
    strip: {
      backgroundColor: c.surfaceSubtle,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
    },
    stripPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    stripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: sizes.touchTarget - 2 * spacing.sm,
    },
    stripTitle: {
      ...typography.label,
      color: c.textPrimary,
      flex: 1,
    },
    stripBody: {
      ...typography.caption,
      color: c.textSecondary,
      paddingBottom: spacing.xs,
    },
  });
