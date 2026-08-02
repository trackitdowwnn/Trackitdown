/**
 * WHAT:  Route /legal/safety | /legal/terms | /legal/privacy — thin wrapper
 *        for the legal document reader.
 * WHY:   Route files stay thin (ARCHITECTURE.md rule 3).
 * LINKS: src/features/legal/screens/LegalDocumentScreen.tsx;
 *        src/shared/lib/legal.ts (the link targets).
 */

import { useLocalSearchParams } from 'expo-router';

import { LegalDocumentScreen } from '@/features/legal';

export default function LegalDocumentRoute() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  return <LegalDocumentScreen slug={doc} />;
}
