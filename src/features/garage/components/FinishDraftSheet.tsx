/**
 * WHAT:  FinishDraftSheet — "Finish your draft?" over the tabs when + finds a
 *        listing left at the payment step: the car, then Continue draft
 *        (opens that listing, to edit and pay) and Start a new one (opens the
 *        usual report). Dismissing it opens nothing.
 * WHY:   Device check, 2026-10-29: + started a new report from nothing while
 *        a listing sat unfinished, and never said so. The owner chose to be
 *        asked, then asked for a sheet rather than a whole page (same day).
 *        Nothing is deleted either way. Minimal copy: a question, the car,
 *        two buttons. Mounted by the tabs layout, opened by useStartReport's
 *        onDraft through the ref.
 * LINKS: src/app/(tabs)/_layout.tsx (mounts it); ../hooks/useStartReport.ts;
 *        src/features/vehicles/lib/serverDraft.ts (where the draft comes from);
 *        ./SaveYourCarSheet.tsx (the same sheet pattern).
 */

import { useRouter } from 'expo-router';
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ServerDraft } from '@/features/vehicles';
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

  useImperativeHandle(
    ref,
    () => ({
      open: (next) => {
        setDraft(next);
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

  const onStartNew = () => {
    log.info('report_draft_set_aside');
    sheetRef.current?.close();
    router.push('/post-a-car');
  };

  return (
    <BottomSheet ref={sheetRef} title="Finish your draft?">
      <View style={styles.content} testID="finish-draft-sheet">
        <Text style={styles.car}>{draft?.label}</Text>
        <Button label="Continue draft" onPress={onContinue} />
        <Button label="Start a new one" variant="secondary" onPress={onStartNew} />
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
  });
