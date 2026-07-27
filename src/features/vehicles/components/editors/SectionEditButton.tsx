/**
 * WHAT:  SectionEditButton — the small pencil an owner taps to edit one section
 *        of their post. Shown beside a section's title (or a stat) only when the
 *        section is editable for the post's status.
 * WHY:   One consistent edit affordance across the detail screen (lucide Pencil
 *        at sizes.iconSm — the glyph the app already uses for edit), with a full
 *        44pt hit target via hitSlop despite the small glyph.
 * LINKS: src/features/vehicles/components/PostDetailBody.tsx (placement);
 *        src/features/vehicles/components/editors/PostSectionEditorHost.tsx.
 */

import { Pencil } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { colors, sizes, spacing } from '@/shared/theme';

export function SectionEditButton({
  onPress,
  label,
  testID,
}: {
  onPress: () => void;
  /** Accessible label, e.g. "Edit car details". */
  label: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.md}
      style={styles.button}
      testID={testID}
    >
      <Pencil size={sizes.iconSm} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: spacing.xs,
  },
});
