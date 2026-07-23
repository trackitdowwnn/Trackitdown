/**
 * WHAT:  Route file for the pushed "My cars" page.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — everything lives in
 *        the vehicles feature's MyCarsScreen. Moved out of the (tabs) group
 *        (2026-07-23): My cars is reached from Profile now, not the navbar.
 * LINKS: src/features/vehicles/screens/MyCarsScreen.tsx.
 */

import { MyCarsScreen } from '@/features/vehicles';

export default MyCarsScreen;
