/**
 * WHAT:  Route for "Blocked accounts" — the people the signed-in user has
 *        blocked, one push from Settings (OUTSIDE the (tabs) group, so no tab
 *        bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else.
 *
 *        It exists because a block is made in a chat thread and can be undone
 *        nowhere else — the header action disappears once blocked, so without
 *        this screen blocking would be a one-way door.
 * LINKS: src/features/profile/screens/BlockedAccountsScreen.tsx;
 *        docs/decisions/ADR-0017-user-blocking.md.
 */

import { BlockedAccountsScreen } from '@/features/profile';

export default function BlockedAccountsRoute() {
  return <BlockedAccountsScreen />;
}
