/**
 * WHAT:  FinishDraftSheet — "Finish your draft?" over the tabs when + finds a
 *        listing left at the payment step: the car, then Continue draft
 *        (opens that listing, to edit and pay) and Delete draft and start
 *        again (deletes it, then opens the usual report). Dismissing it opens
 *        nothing and deletes nothing.
 * WHY:   Device check, 2026-10-29: + started a new report from nothing while
 *        a listing sat unfinished, and never said so. The owner chose to be
 *        asked, then asked for a sheet rather than a whole page (same day).
 *        1.2.0 device check, 2026-10-30: "start a new one" kept the old draft,
 *        so + asked about it again every time; the owner chose to delete it
 *        on that button. The label says so, because it IS the confirmation
 *        deleteDraft requires. Minimal copy: a question, the car, two buttons.
 *        Mounted by the tabs layout, opened by useStartReport's onDraft.
 * LINKS: src/app/(tabs)/_layout.tsx (mounts it); ../hooks/useStartReport.ts;
 *        src/features/vehicles/lib/serverDraft.ts (where the draft comes from);
 *        src/features/vehicles/api/draftApi.ts (deleteDraft: cancels any
 *        half-made payment at Stripe first); ./SaveYourCarSheet.tsx.
 */

import { useRouter } from 'expo-router';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { deleteDraft, type ServerDraft } from '@/features/vehicles';
import { createLogger } from '@/shared/lib/logger';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, type BottomSheetRef } from '@/shared/ui';

const log = createLogger('garage');

export interface FinishDraftSheetRef {
  open: (draft: ServerDraft) => void;
}

export function FinishDraftSheet({ ref }: { ref?: Ref<FinishDraftSheetRef> }) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const sheetRef = useRef<BottomSheetRef>(null);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open: (next) => {
        setDraft(next);
        setError(null);
        sheetRef.current?.open();
      },
    }),
    [],
  );

  const onContinue = () => {
    if (!draft) return;
    log.info('report_draft_continued');
    sheetRef.current?.close();
    router.push(`/post/${draft.id}`);
  };

  const onDeleteAndStart = async () => {
    if (!draft || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteDraft(draft.id);
    } catch (e) {
      // deleteDraft's copy is already user-facing; the draft is kept.
      setError((e as Error).message);
      setDeleting(false);
      return;
    }
    setDeleting(false);
    log.info('report_draft_deleted');
    sheetRef.current?.close();
    router.push('/post-a-car');
  };

  return (
    <BottomSheet ref={sheetRef} title="Finish your draft?">
      <View style={styles.content} testID="finish-draft-sheet">
        <Text style={styles.car}>{draft?.label}</Text>
        <Button label="Continue draft" onPress={onContinue} disabled={deleting} />
        <Button
          label="Delete draft and start again"
          variant="dangerOutline"
          onPress={onDeleteAndStart}
          loading={deleting}
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: {
      gap: spacing.md,
    },
    car: {
      ...typography.body,
      color: c.textSecondary,
    },
    error: {
      ...typography.caption,
      color: c.danger,
    },
  });
