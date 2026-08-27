/**
 * WHAT:  AlertActionsSheet — the "⋯" sheet on an alert row: pause or resume,
 *        edit, and a destructive delete.
 * WHY:   ⚠️ IT EXISTS TO GET DELETE OFF THE CARD. The old row carried two ghost
 *        Buttons, "Edit" and "Delete", styled identically — so the irreversible
 *        action looked exactly like the safe one and sat one mis-tap away on a
 *        resting card. Here it is labelled, in the `danger` tone, behind a
 *        deliberate tap, and still routes through the existing ConfirmDialog.
 *        Nothing else in the app put a bare destructive button on a card; this
 *        is the house answer (MyCarsScreen: "cards carry no buttons; menus are
 *        bottom sheets").
 *
 *        Pause is repeated here even though the row has a switch. That is not
 *        redundancy: the sheet is titled with the alert's name and lists what
 *        can be done to it, and a menu that silently omits the commonest verb
 *        reads as incomplete. The switch stays because pausing is the daily
 *        action and burying it would cost three taps.
 * LINKS: ./AlertCard.tsx (opens it); ../screens/AlertsScreen.tsx (owns the ref
 *        and the ConfirmDialog it hands off to).
 */

import { Pencil, Play, Pause, Trash2 } from 'lucide-react-native';
import type { Ref } from 'react';

import { spacing, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, ListRow, type BottomSheetRef } from '@/shared/ui';
import { StyleSheet, View } from 'react-native';

import type { Alert } from '../types';

export interface AlertActionsSheetProps {
  ref?: Ref<BottomSheetRef>;
  /** The alert the sheet is about, or null when nothing is selected. */
  alert: Alert | null;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onDismiss?: () => void;
}

export function AlertActionsSheet({
  ref,
  alert,
  onEdit,
  onToggle,
  onDelete,
  onDismiss,
}: AlertActionsSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const paused = alert ? !alert.enabled : false;

  return (
    // Titled with the alert's own name, so a sheet opened from the third row is
    // unambiguously about the third row.
    <BottomSheet ref={ref} title={alert?.name} onDismiss={onDismiss}>
      <View style={styles.body}>
        <ListRow
          icon={paused ? Play : Pause}
          title={paused ? 'Resume alert' : 'Pause alert'}
          onPress={() => onToggle(paused)}
          testID="alert-action-toggle"
        />
        <ListRow icon={Pencil} title="Edit alert" onPress={onEdit} testID="alert-action-edit" />
        {/* `destructive` is the muted danger tone, not alarm red — the app's one
            red is for destructive and error UI, and this is the destructive
            half of that. */}
        <ListRow
          icon={Trash2}
          title="Delete alert"
          destructive
          onPress={onDelete}
          testID="alert-action-delete"
        />
      </View>
    </BottomSheet>
  );
}

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    // No dividers: three rows in a sheet are a menu, and ListRow's own 52pt
    // height plus its pressed pill already separate them.
    body: { gap: spacing.xs },
  });
