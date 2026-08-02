/**
 * WHAT:  Public API of the legal feature — the three documents and the screen
 *        that renders one.
 * WHY:   Both auth and profile link to these, so the content cannot live in
 *        either (ARCHITECTURE rule 1: features never deep-import each other).
 *        This feature imports nothing from another feature, so it can never
 *        close a cycle.
 * LINKS: ./README.md; ./lib/legalContent.ts; ./screens/LegalDocumentScreen.tsx.
 */

export { LegalDocumentScreen } from './screens/LegalDocumentScreen';
export {
  LEGAL_DOCUMENTS,
  LEGAL_LAST_UPDATED,
  legalDocument,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './lib/legalContent';
