/**
 * WHAT:  Public surface of the per-section post editors — the section→editor host
 *        and the shared pencil button. The individual editors are internal (the
 *        host resolves them).
 * WHY:   PostDetailScreen mounts the host and PostDetailBody places the pencils;
 *        neither reaches into individual editor files.
 * LINKS: src/features/vehicles/components/editors/PostSectionEditorHost.tsx;
 *        src/features/vehicles/components/editors/SectionEditButton.tsx.
 */

export { PostSectionEditorHost, type EditableSection } from './PostSectionEditorHost';
export { SectionEditButton } from './SectionEditButton';
