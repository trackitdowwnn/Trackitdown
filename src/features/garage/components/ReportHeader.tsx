/**
 * WHAT:  ReportHeader — the report host's top row: an on-screen back control
 *        and, optionally, a title.
 * WHY:   Headers are hidden app-wide, so a pushed page draws its own way back.
 *        Shared by the chooser ("Which car?") and the pending stage, which
 *        shows the back control WITHOUT a title: the way out is always there,
 *        and a bare chevron says nothing about whether you have cars — the
 *        title is what used to tell people with none that they had some
 *        (2026-10-07).
 * LINKS: src/features/garage/components/ChooseCarStage.tsx;
 *        src/features/garage/components/ReportPending.tsx.
 */

import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { sizes, spacing, typography, usePalette, useThemedStyles, type Palette } from '@/shared/theme';

export function ReportHeader({ title, onBack }: { title?: string; onBack: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <View style={styles.headerRow}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={styles.back}
        testID="choose-car-back"
      >
        <ChevronLeft size={sizes.icon} color={palette.textPrimary} />
      </Pressable>
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
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      gap: spacing.xs,
      // Holds its height with or without a title, so the title arriving moves
      // nothing below it.
      minHeight: sizes.touchTarget + spacing.md,
    },
    back: {
      width: sizes.touchTarget,
      height: sizes.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
    },
    title: {
      ...typography.title,
      color: c.textPrimary,
      flexShrink: 1,
    },
  });
