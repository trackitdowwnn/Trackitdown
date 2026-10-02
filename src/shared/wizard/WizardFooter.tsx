/**
 * WHAT:  The wizard's fixed footer — a ghost Back button and the primary
 *        action (Next / phase CTA / the flow's final label), with a step's
 *        optional footerNote and the last action's error just above them. Progress lives in the header
 *        row, not here.
 * WHY:   One consistent action zone across every wizard screen: Back is
 *        hidden on the first screen and on phase intros (intros advance
 *        only), and the primary button carries the gating — disabled until
 *        the current step validates.
 * LINKS: src/shared/wizard/WizardScreen.tsx (owner, handles keyboard/safe
 *        area); src/shared/ui/Button.tsx; docs/DESIGN_SYSTEM.md.
 */

import { StyleSheet, Text, View } from 'react-native';

// Direct file import (not the ../ui barrel) so the wizard doesn't drag the
// whole UI kit — notably BottomSheet's native deps — into its module graph.
import { Button } from '../ui/Button';
import { spacing, typography, useThemedStyles, type Palette } from '../theme';

export interface WizardFooterProps {
  /** Label of the primary button (Next / Get started / Publish / Done). */
  ctaLabel: string;
  /** Primary button disabled while the current step fails validation. */
  canProceed: boolean;
  /** Primary button shows a spinner while an async action is in flight. */
  loading?: boolean;
  /** Hide Back on the first screen and on phase intros. */
  showBack: boolean;
  onBack: () => void;
  onNext: () => void;
  /** A step's footerNote: one quiet line tied to the buttons below it. */
  note?: string;
  /** The last async-action error, shown for retry right above the buttons
   *  (under the note, so the failure sits next to the button it's about). */
  error?: string | null;
}

export function WizardFooter({
  ctaLabel,
  canProceed,
  loading = false,
  showBack,
  onBack,
  onNext,
  note,
  error,
}: WizardFooterProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <>
      {/* Closer to the buttons (sm) than to the content above (lg), so it
          reads as being about the commitment, not the last line of the step. */}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {/* Danger-toned and announced politely, so a failed lookup/submit is
          read out without stealing focus (WizardScreen announces on iOS). */}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <View style={[styles.buttons, note || error ? styles.buttonsUnderNote : null]}>
        {showBack ? (
          <Button label="Back" variant="ghost" fullWidth={false} onPress={onBack} />
        ) : null}
        <View style={styles.primary}>
          <Button label={ctaLabel} onPress={onNext} disabled={!canProceed} loading={loading} />
        </View>
      </View>
    </>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  buttonsUnderNote: {
    paddingTop: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: c.textSecondary,
    paddingTop: spacing.lg,
  },
  error: {
    ...typography.caption,
    color: c.danger,
    paddingTop: spacing.sm,
  },
  primary: {
    flex: 1,
  },
});
