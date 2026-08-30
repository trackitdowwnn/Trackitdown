/**
 * WHAT:  CollectionPickerSheet — "which list should this car be saved to?".
 *        Mounted once at the app root, driven by the picker intent store.
 *        A list of the caller's collections plus the implicit "Saved" bucket,
 *        with a "New list" row that swaps the sheet body in place for a name
 *        field rather than pushing a second sheet.
 * WHY:   Airbnb's heart never asks first: it saves, then offers "Change". This
 *        is the Change. It therefore opens on top of a completed action — the
 *        car is ALREADY saved when this appears, so dismissing it must be a
 *        perfectly good outcome, and every path out of here leaves the car
 *        filed somewhere.
 *
 *        Mounted at the root, like AuthSheet and SaveYourCarSheet: the toast
 *        that raises this outlives the feed cell that triggered the save.
 * LINKS: src/features/watchlist/lib/pickerIntent.ts (the store);
 *        src/features/watchlist/api/collectionsApi.ts (moveWatch);
 *        src/features/garage/components/SaveYourCarSheet.tsx (root-mounted
 *          pattern); docs/DESIGN_SYSTEM.md.
 */

import { Bookmark, List, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { spacing, useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, Button, ListRow, TextField, useToast } from '@/shared/ui';
import type { BottomSheetRef } from '@/shared/ui';

import { moveWatch } from '../api/collectionsApi';
import { useCollections } from '../hooks/useCollections';
import { setMruCollection } from '../lib/mruCollection';
import { clearCollectionPicker, useCollectionPickerIntent } from '../lib/pickerIntent';
import { MAX_COLLECTIONS } from '../types';
import type { CollectionId } from '../types';

import { useSession } from '@/features/auth';

/** The implicit bucket's label. Not a row in any table — see types.ts. */
const SAVED_LABEL = 'Saved';

export function CollectionPickerSheet() {
  const styles = useThemedStyles(makeStyles);
  const intent = useCollectionPickerIntent();
  const session = useSession();
  const toast = useToast();
  const sheetRef = useRef<BottomSheetRef>(null);
  const { collections, create } = useCollections();

  const userId = session.status === 'signedIn' ? session.userId : null;

  // 'list' = choose an existing one; 'create' = the inline name field. The body
  // swaps in place; a second sheet stacked on this one would trap the user
  // behind two dismissals to undo one tap.
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (intent === null) {
      return;
    }
    sheetRef.current?.open();
  }, [intent]);

  // Reset on the way OUT, not on the way in: an effect that set state on open
  // would cascade a render (and the lint rule that forbids it is right). Every
  // exit — button, swipe, scrim tap — funnels through the sheet's onDismiss,
  // so the next open always starts on the list with an empty name.
  const onDismiss = useCallback(() => {
    clearCollectionPicker();
    setMode('list');
    setName('');
  }, []);

  const close = useCallback(() => {
    sheetRef.current?.close();
    onDismiss();
  }, [onDismiss]);

  const file = useCallback(
    async (target: CollectionId, targetName: string | null) => {
      if (intent === null || busy) {
        return;
      }
      setBusy(true);
      try {
        await moveWatch(intent.postId, target);
        if (userId !== null) {
          // The user just told us where they file things — the next save
          // should go here too. The NAME goes with it: this is the one place
          // that reliably knows it, and it's what lets the next save's toast
          // say "Saved to My commute" instead of the generic copy.
          setMruCollection(userId, target, targetName);
        }
        close();
      } catch (error) {
        // The message is already user-facing (CollectionError). The car is
        // still saved where it was, so this is a failed MOVE, not a failed
        // save — the copy must not imply the car was lost.
        toast.show(error instanceof Error ? error.message : 'Please try again.', 'error');
      } finally {
        setBusy(false);
      }
    },
    [intent, busy, userId, close, toast],
  );

  const createAndFile = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const collection = await create(name);
      setBusy(false);
      await file(collection.id, collection.name);
    } catch (error) {
      setBusy(false);
      toast.show(error instanceof Error ? error.message : 'Please try again.', 'error');
    }
  }, [busy, create, name, file, toast]);

  const atLimit = collections.length >= MAX_COLLECTIONS;
  const current = intent?.currentCollectionId ?? null;

  return (
    <BottomSheet ref={sheetRef} title="Save to a list" onDismiss={onDismiss}>
      {mode === 'create' ? (
        <View style={styles.createBody} testID="collection-picker-create">
          {/* ⚠️ NO helperText (owner request, 2026-08-30). It read "Somewhere
              you'd actually spot a car — 'My commute', 'Near work'." The field
              is one line in a sheet the reader opened deliberately; the hint
              was explaining something the label already says. */}
          <TextField
            label="List name"
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={() => void createAndFile()}
          />
          {/* The actions are their own group. Without this the field would sit
              12pt above "Create and save here" — the same gap the two buttons
              share — so the input would read as the top of the button stack
              rather than the thing the buttons act on. TextField's whole
              message row is conditional, so removing the hint took away 26pt
              (its 18pt line plus the field's own 8pt gap) and left nothing. */}
          <View style={styles.createActions}>
            <Button
              label="Create and save here"
              onPress={() => void createAndFile()}
              disabled={busy || name.trim().length === 0}
            />
            <Button label="Back" variant="ghost" onPress={() => setMode('list')} disabled={busy} />
          </View>
        </View>
      ) : (
        <View style={styles.content} testID="collection-picker">
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            // The rows are the content; a bounce over one row reads as broken.
            bounces={collections.length > 3}
          >
            <ListRow
              icon={Bookmark}
              title={SAVED_LABEL}
              subtitle="Everything you save, unless you file it"
              selected={current === null}
              onPress={() => void file(null, null)}
              disabled={busy}
            />
            {collections.map((collection) => (
              <ListRow
                key={collection.id}
                icon={List}
                title={collection.name}
                selected={current === collection.id}
                onPress={() => void file(collection.id, collection.name)}
                disabled={busy}
              />
            ))}
          </ScrollView>
          {/* A ROW, not a button below the list: with no named lists yet the
              only two things anyone can do here are "leave it in Saved" and
              "make a list", and those have to read as two choices of equal
              standing. A ghost button parked under a one-row list read as an
              afterthought. No `selected` — it isn't one of the answers, it
              makes a new one, so it keeps the chevron and the button role. */}
          <View style={styles.newListRow}>
            <ListRow
              icon={Plus}
              title="New list"
              subtitle={
                atLimit
                  ? `You’ve reached the limit of ${MAX_COLLECTIONS} lists`
                  : 'Group the cars you want to keep together'
              }
              onPress={() => setMode('create')}
              // At the cap this could only ever produce an error — say why up
              // front instead of letting them type a name and then refusing it.
              disabled={busy || atLimit}
              testID="new-list-row"
            />
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  content: {
    gap: spacing.sm,
  },
  // 24 between the field and the actions, 12 within the action stack: the
  // input is one thing and the buttons are another, and the difference is what
  // makes them read that way. A single flat gap here would put the field, the
  // primary and the ghost all the same distance apart.
  createBody: {
    gap: spacing.xl,
  },
  createActions: {
    gap: spacing.md,
  },
  list: {
    // Caps the sheet's height with many lists while keeping "New list"
    // reachable without scrolling to the bottom of them. flexGrow 0 so a
    // single row doesn't stretch the ScrollView to the cap and leave a gap.
    maxHeight: 320,
    flexGrow: 0,
  },
  listContent: {
    gap: spacing.xs,
  },
  newListRow: {
    // Hairline separator: "New list" makes a new answer rather than being one,
    // so it reads as its own group instead of a fourth radio option.
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
    paddingTop: spacing.sm,
  },
});
