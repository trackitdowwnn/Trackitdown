/**
 * WHAT:  How a per-section post editor is being presented — 'sheet' (inside a
 *        BottomSheet) or 'screen' (a full-screen opaque overlay) — carried as
 *        context from PostSectionEditorHost down to the shared PostSectionEditor
 *        scaffold.
 * WHY:   The seven editors sit BETWEEN the host (which picks the presentation)
 *        and the scaffold (which has to lay itself out for it), and none of them
 *        care which it is. Context skips the prop-drilling so adding an editor
 *        stays a one-line map entry. It also keeps the two layouts from being
 *        two components: a sheet must NOT bring its own Screen or ScrollView
 *        (BottomSheetScrollView already scrolls, and nesting them breaks both).
 * LINKS: src/features/vehicles/components/editors/PostSectionEditorHost.tsx
 *          (provider); PostSectionEditor.tsx (consumer);
 *        src/shared/ui/BottomSheet.tsx.
 */

import { createContext } from 'react';

export type EditorPresentation = 'sheet' | 'screen';

/** Defaults to 'screen' so an editor rendered outside the host (or in a test)
 *  still gets the standalone full-screen layout. */
export const EditorPresentationContext = createContext<EditorPresentation>('screen');
