/**
 * WHAT:  The wizard's fixed footer — a ghost Back button and the primary
 *        action (Next / phase CTA / the flow's final label). Progress lives
 *        in the header row, not here.
 * WHY:   One consistent action zone across every wizard screen: Back is
 *        hidden on the first screen and on phase intros (intros advance
 *        only), and the primary button carries the gating — disabled until
 *        the current step validates.
 * LINKS: src/shared/wizard/WizardScreen.tsx (owner, handles keyboard/safe
 *        area); src/shared/ui/Button.tsx; docs/DESIGN_SYSTEM.md.
 */

import { StyleSheet, View } from 'react-native';

// Direct file import (not the ../ui barrel) so the wizard doesn't drag the
// whole UI kit — notably BottomSheet's native deps — into its module graph.
import { Button } from '../ui/Button';
import { spacing } from '../theme';

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
}

export function WizardFooter({
  ctaLabel,
  canProceed,
  loading = false,
  showBack,
  onBack,
  onNext,
}: WizardFooterProps) {
  return (
    <View style={styles.buttons}>
      {showBack ? (
        <Button label="Back" variant="ghost" fullWidth={false} onPress={onBack} />
      ) : null}
      <View style={styles.primary}>
        <Button label={ctaLabel} onPress={onNext} disabled={!canProceed} loading={loading} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  primary: {
    flex: 1,
  },
});
