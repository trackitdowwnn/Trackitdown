/**
 * WHAT:  PostSectionEditor — the shared scaffold every per-section post editor
 *        uses: a title, a body slot, and a Save + Cancel pair. Owns the save
 *        lifecycle (spinner on Save, toast on success, error kept on screen on
 *        failure). Lays itself out for whichever presentation the host chose:
 *        'sheet' (bare — the host's BottomSheet supplies the surface and the
 *        scrolling) or 'screen' (a Screen with its own ScrollView + sticky
 *        footer).
 * WHY:   Each section editor should only supply its inputs + a save call; the
 *        chrome, the save/busy/error handling, and the "stay open on failure so
 *        the user can retry" rule (the same money/safety rule the wizard's submit
 *        follows) live here once. Uses the shared Button (a clear bottom Save),
 *        matching EditProfileScreen — not a header text link. In SHEET mode it
 *        must not bring a Screen or a ScrollView: BottomSheetScrollView already
 *        scrolls, and nesting scrollers breaks both the sheet's drag-to-close and
 *        the inner scroll.
 * LINKS: src/features/vehicles/components/editors/* (consumers);
 *        src/features/vehicles/components/editors/editorPresentation.ts;
 *        src/features/vehicles/post/api/editSectionApi.ts (the save calls);
 *        src/features/profile/screens/EditProfileScreen.tsx (the pattern).
 */

import { type ReactNode, useContext, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PostSubmissionError } from '@/features/vehicles/post';
import { colors, spacing, typography } from '@/shared/theme';
import { Button, Screen, useToast } from '@/shared/ui';

import { EditorPresentationContext } from './editorPresentation';

const SAVE_FALLBACK = 'We couldn’t save your changes. Please try again.';

export interface PostSectionEditorProps {
  /** Header title, e.g. "Bounty" or "Distinctive features". */
  title: string;
  /** Close without saving (Cancel / system back). */
  onClose: () => void;
  /** The section save — should throw a PostSubmissionError (message shown). */
  onSave: () => Promise<void>;
  /** Called after a successful save (parent refreshes the detail + closes). */
  onSaved: () => void;
  /** Whether the current input is valid (Save disabled otherwise). */
  canSave: boolean;
  /** The section's inputs. */
  children: ReactNode;
}

export function PostSectionEditor({
  title,
  onClose,
  onSave,
  onSaved,
  canSave,
  children,
}: PostSectionEditorProps) {
  const presentation = useContext(EditorPresentationContext);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave();
      toast.show('Changes saved', 'success');
      onSaved();
    } catch (err) {
      // Stay open with the message so the user can fix + retry (the same rule the
      // wizard's submit follows — losing an edit to a blip is the failure to avoid).
      setError(err instanceof PostSubmissionError && err.message ? err.message : SAVE_FALLBACK);
      setSaving(false);
    }
  };

  const actions = (
    <>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button label="Save" onPress={() => void handleSave()} disabled={!canSave} loading={saving} />
      <Button label="Cancel" variant="ghost" onPress={onClose} disabled={saving} />
    </>
  );

  // SHEET: no Screen, no ScrollView — the host's BottomSheet owns the surface,
  // the safe-area padding and the scrolling (and auto-sizes to this content).
  if (presentation === 'sheet') {
    return (
      <View style={styles.sheet}>
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {title}
        </Text>
        <View style={styles.sheetBody}>{children}</View>
        <View style={styles.sheetActions}>{actions}</View>
      </View>
    );
  }

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {children}
      </ScrollView>

      <View style={styles.footer}>{actions}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Sheet mode: the BottomSheet already pads horizontally and for the safe area,
  // so this only owns the vertical rhythm between title / inputs / actions.
  sheet: {
    gap: spacing.lg,
  },
  sheetTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  sheetBody: {
    gap: spacing.xl,
  },
  sheetActions: {
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  // Sticky footer above the content, hairline-separated, holding the actions.
  footer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    paddingBottom: spacing.xs,
  },
});
