/**
 * WHAT:  Route file for the pushed "My cars" page — the garage.
 * WHY:   Thin wrapper per docs/ARCHITECTURE.md rule 3 — everything lives in
 *        the garage feature's MyCarsScreen. Moved out of the (tabs) group
 *        (2026-07-23): My cars is reached from Profile now, not the navbar.
 *        The screen itself moved from features/vehicles to features/garage when
 *        the garage was built: a saved car is not a post.
 * LINKS: src/features/garage/screens/MyCarsScreen.tsx.
 */

import { MyCarsScreen } from '@/features/garage';

export default MyCarsScreen;
