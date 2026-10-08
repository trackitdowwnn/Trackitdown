/**
 * WHAT:  ReportHeader — the report host's top: the SAME exit ✕ as the posting
 *        wizard, in the same place, and optionally a title beneath it.
 * WHY:   The report screen slides up from the bottom and its stages dissolve
 *        into the wizard, which exits with ✕. A left chevron on a bottom-sheet
 *        task was the wrong grammar, and a control that sat 4pt away from the
 *        wizard's ✕ showed BOTH during the dissolve (UI review of #141). So
 *        this reuses WizardHeader in the wizard's own header geometry: across
 *        pending → chooser → form, the way out never moves or changes.
 *        The pending stage shows it WITHOUT a title — the way out is always
 *        there, and nothing claims you have cars.
 * LINKS: src/shared/wizard/WizardHeader.tsx (the control);
 *        src/shared/wizard/WizardScreen.tsx (styles.header — the geometry
 *          matched here); src/features/garage/components/ChooseCarStage.tsx,
 *        src/features/garage/components/ReportPending.tsx.
 */

import { StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { WizardHeader } from '@/shared/wizard';

export function ReportHeader({ title, onBack }: { title?: string; onBack: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View>
      <View style={styles.headerRow}>
        <WizardHeader onExit={onBack} testID="report-close" />
      </View>
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    // The wizard's header row exactly (WizardScreen styles.header), so the ✕
    // lands on the same pixels as the form's.
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
    },
  });
