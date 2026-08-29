/**
 * WHAT:  SafetyNotice — the app-wide "report, don't approach" banner with
 *        FIXED copy: never approach/follow/confront, call 999 if a crime is
 *        in progress. Optionally `collapsible`, which pins it as a single
 *        titled line that expands to the full body on tap.
 * WHY:   SECURITY_AND_TRUST §1 requires the SAME safety message on every
 *        sighting flow and alert. Making it one component with non-overridable
 *        copy guarantees the wording never drifts — this is a product-safety
 *        requirement, not decoration.
 *
 *        ⚠️ CHAT IS NO LONGER A CONSUMER (2026-08-29, owner decision; §1 and
 *        DOMAIN.md were amended the same day). The `collapsible` form was built
 *        for it on 2026-08-05 and now has NO consumers at all. It is kept
 *        deliberately rather than deleted, because §1 records the decision and
 *        a future surface may want a pinned-above-live-content form again — but
 *        do not restore it to chat on the strength of this file. Read §1 first.
 *
 *        What `collapsible` guarantees, if it is ever used again: not
 *        dismissible; the accessibility label is the FULL title + body in both
 *        states; role stays `alert`; and the visible half is the actionable
 *        instruction, with only the elaboration folding. Default is the full
 *        banner, so every current consumer is untouched.
 *
 *        Current render sites: the sighting wizard, post sightings, sighting
 *        detail, post detail. Onboarding carries the COPY instead — it imports
 *        SAFETY_RULE_LINE and renders its own pill, 999 clause omitted at that
 *        stage — so grepping for this component name under-counts coverage.
 * LINKS: docs/SECURITY_AND_TRUST.md §1; docs/DOMAIN.md (sighting rules);
 *        src/features/vehicles (post detail); src/features/sightings;
 *        src/features/auth/lib/onboardingSlides.ts (SAFETY_RULE_LINE).
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
        {/* ⚠️ NO numberOfLines. §1 requires the visible half to BE the
            actionable instruction, and at 200% type "Stay safe — report, don't
            approach" can run past two lines in this column — truncating it
            mid-rule is the one failure this element cannot have. Letting the
            strip grow can only ever make the safety notice larger. */}
        <Text style={styles.stripTitle}>
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
    //
    // ⚠️ 8pt PADDING, AND IT STAYS 8. This shipped briefly at 4 (a 36pt band,
    // with hitSlop making up a nominal 44) to give the chat thread back some of
    // its 46% chrome. A security review caught that the lower slop is DEAD:
    // hit-testing walks siblings in reverse draw order, and the branch
    // container drawn after this strip claims any touch below it. The real
    // target was 40 — smaller AND harder to hit, on the one control that is a
    // sighted user's only route to the "call 999" clause.
    //
    // The 8pt came back and the screen took it from the message list's own
    // padding instead, where nothing depends on it. On a safety control, an
    // ACTUAL 44 beats an arithmetic one.
    //
    // ⚠️ A BOTTOM HAIRLINE, because the fill alone is not a boundary:
    // `surfaceSubtle` on `background` is ~1.06:1 (#EEEEEE on #F7F7F7, and
    // #2A2A2A on #141414 in dark). The same pass gave incoming message bubbles
    // an edge for exactly this reason; the element that reason exists to
    // protect should not be the one without one. The top edge is the header
    // block's own hairline.
    strip: {
      backgroundColor: c.surfaceSubtle,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    stripPressed: {
      backgroundColor: c.surfaceSubtlePressed,
    },
    stripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      // A plain 28: it used to be derived from the padding it sat inside
      // (`touchTarget - 2 * spacing.sm`), and that derivation stopped being true
      // the moment the padding changed. The row is 28 because two lines of
      // `label` need 28, not because of what surrounds it.
      minHeight: sizes.safetyStripRow,
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
