/**
 * WHAT:  Route file for the pushed "Settings" page.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — the screen lives in
 *        the profile feature. A lateral push needs no Stack.Screen entry;
 *        _layout.tsx declares only the three routes with modal grammar.
 * LINKS: src/features/profile/screens/SettingsScreen.tsx.
 */

import { SettingsScreen } from '@/features/profile';

export default SettingsScreen;
