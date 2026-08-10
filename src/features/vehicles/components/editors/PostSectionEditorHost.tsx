/**
 * WHAT:  PostSectionEditorHost — maps an EditableSection key to its editor and
 *        presents it: as a BOTTOM SHEET for six of the seven sections, and as a
 *        full-screen overlay for 'last_seen'. The detail screen sets which
 *        section is being edited; this picks the component and the presentation.
 * WHY:   Keeps PostDetailScreen's editor wiring to one line (set a section key)
 *        and the section→editor mapping in one place. A sheet is the right weight
 *        for editing ONE section — the listing stays visible behind it, and
 *        swipe-down is a free cancel — so it's the default, with the sheet
 *        auto-sizing (and scrolling internally) for the taller editors. The ONE
 *        exception is 'last_seen': it embeds an interactive map, whose pan
 *        gestures fight the sheet's drag-to-close, so it keeps the opaque
 *        full-screen treatment. Photo pickers are fine either way — they open as
 *        opaque native Modals ABOVE the sheet.
 * LINKS: src/features/vehicles/components/editors/* (the editors);
 *        src/features/vehicles/components/editors/editorPresentation.ts;
 *        src/features/vehicles/screens/PostDetailScreen.tsx (host mount);
 *        src/shared/ui/BottomSheet.tsx.
 */

import { useEffect, useRef, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import { useThemedStyles, type Palette } from '@/shared/theme';
import { BottomSheet, type BottomSheetRef } from '@/shared/ui';

import type { PostDetail } from '../../types';
import { BountyEditor } from './BountyEditor';
import { CarDetailsEditor } from './CarDetailsEditor';
import { DescriptionEditor } from './DescriptionEditor';
import { DistinctiveFeaturesEditor } from './DistinctiveFeaturesEditor';
import { EditorPresentationContext } from './editorPresentation';
import { LastSeenEditor } from './LastSeenEditor';
import { PhotosEditor } from './PhotosEditor';
import { TheftContextEditor } from './TheftContextEditor';

/** The post sections an owner can edit. */
export type EditableSection =
  | 'car_details'
  | 'photos'
  | 'last_seen'
  | 'bounty'
  | 'description'
  | 'theft_context'
  | 'distinctive_features';

const EDITORS = {
  car_details: CarDetailsEditor,
  photos: PhotosEditor,
  last_seen: LastSeenEditor,
  bounty: BountyEditor,
  description: DescriptionEditor,
  theft_context: TheftContextEditor,
  distinctive_features: DistinctiveFeaturesEditor,
} as const;

/** Sections that must NOT be presented in a sheet. 'last_seen' embeds an
 *  interactive map: dragging it would be read as dragging the sheet. */
const FULL_SCREEN_SECTIONS: readonly EditableSection[] = ['last_seen'];

type EditorComponent = ComponentType<{
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}>;

export interface PostSectionEditorHostProps {
  section: EditableSection;
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}

export function PostSectionEditorHost({
  section,
  post,
  onClose,
  onSaved,
}: PostSectionEditorHostProps) {
  const styles = useThemedStyles(makeStyles);
  const Editor: EditorComponent = EDITORS[section];

  if (FULL_SCREEN_SECTIONS.includes(section)) {
    return (
      <EditorPresentationContext value="screen">
        {/* Opaque full-screen cover so the detail underneath never bleeds through. */}
        <View style={styles.overlay}>
          <Editor post={post} onClose={onClose} onSaved={onSaved} />
        </View>
      </EditorPresentationContext>
    );
  }

  return <SheetEditor Editor={Editor} post={post} onClose={onClose} onSaved={onSaved} />;
}

/** The sheet presentation. The host is mounted only while a section is being
 *  edited, so the sheet presents itself on mount and reports every exit —
 *  Cancel, Save, swipe-down or scrim tap — back through the same guard. */
function SheetEditor({
  Editor,
  post,
  onClose,
  onSaved,
}: {
  Editor: EditorComponent;
  post: PostDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const sheetRef = useRef<BottomSheetRef>(null);
  // One exit only. Cancel/Save close the sheet AND call back directly rather than
  // waiting on onDismiss — a row that silently did nothing because a dismissal
  // callback never arrived would be far worse than an unanimated close — so the
  // subsequent onDismiss must not fire a second onClose (which would re-enter the
  // parent's state update, or run onSaved's refetch twice).
  const exited = useRef(false);
  const exit = (report: () => void) => {
    if (exited.current) {
      return;
    }
    exited.current = true;
    sheetRef.current?.close();
    report();
  };

  useEffect(() => {
    sheetRef.current?.open();
  }, []);

  return (
    <BottomSheet ref={sheetRef} onDismiss={() => exit(onClose)}>
      {/* The provider must live INSIDE the sheet's children: @gorhom/bottom-sheet
          re-parents them into its portal host, so context provided around the
          <BottomSheet> element never reaches the editor (it would silently fall
          back to 'screen' and render a full Screen inside the sheet). */}
      <EditorPresentationContext value="sheet">
        <Editor post={post} onClose={() => exit(onClose)} onSaved={() => exit(onSaved)} />
      </EditorPresentationContext>
    </BottomSheet>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.background,
  },
});
