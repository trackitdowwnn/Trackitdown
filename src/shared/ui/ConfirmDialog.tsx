/**
 * WHAT:  ConfirmDialog — a bottom-sheet confirmation: title, honest
 *        consequence copy, a confirm button (danger variant for
 *        irreversible actions), and a calm way out.
 * WHY:   Sign-out, cover-photo removal, account deletion — every "are you
 *        sure" moment must look identical and never guilt-trip: plain
 *        statement of what happens, confirm styled by severity, cancel is a
 *        ghost. Composes BottomSheet (same ref contract: open()/close()) so
 *        it inherits scrim, swipe-dismiss, and keyboard behaviour for free.
 * LINKS: src/shared/ui/BottomSheet.tsx (host); src/features/profile
 *        (first consumer); docs/DESIGN_SYSTEM.md (Tone of voice).
 *
 * Usage:
 *   const dialogRef = useRef<ConfirmDialogRef>(null);
 *   <ConfirmDialog
 *     ref={dialogRef}
 *     title="Sign out?"
 *     body="You can sign back in any time."
 *     confirmLabel="Sign out"
 *     onConfirm={signOut}
 *   />
 *   dialogRef.current?.open();
 */

import { type Ref, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme';
import { BottomSheet, type BottomSheetRef } from './BottomSheet';
import { Button } from './Button';

export interface ConfirmDialogRef {
  open: () => void;
  close: () => void;
}

export interface ConfirmDialogProps {
  ref?: Ref<ConfirmDialogRef>;
  title: string;
  /** Plain statement of what will happen — honest, never guilt-trippy. */
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Danger styling for irreversible actions (delete, not sign-out). */
  destructive?: boolean;
  /** Informational mode: a single acknowledge button, no cancel — for
   *  "here's why you can't" messages where two exits would be confusing. */
  acknowledge?: boolean;
  onConfirm: () => void;
  /** Fires on any close without confirming (cancel, swipe, scrim). */
  onDismiss?: () => void;
}

export function ConfirmDialog({
  ref,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  acknowledge = false,
  onConfirm,
  onDismiss,
}: ConfirmDialogProps) {
  const sheetRef = useRef<BottomSheetRef>(null);
  // Distinguish a confirm-close from a plain dismissal for onDismiss.
  const confirmed = useRef(false);

  useImperativeHandle(ref, () => ({
    open: () => {
      confirmed.current = false;
      sheetRef.current?.open();
    },
    close: () => sheetRef.current?.close(),
  }));

  return (
    <BottomSheet
      ref={sheetRef}
      title={title}
      onDismiss={() => {
        if (!confirmed.current) {
          onDismiss?.();
        }
      }}
    >
      <View style={styles.content}>
        <Text style={styles.body}>{body}</Text>
        <Button
          label={confirmLabel}
          variant={destructive ? 'danger' : 'primary'}
          onPress={() => {
            confirmed.current = true;
            sheetRef.current?.close();
            onConfirm();
          }}
        />
        {!acknowledge ? (
          <Button
            label={cancelLabel}
            variant="ghost"
            onPress={() => sheetRef.current?.close()}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
