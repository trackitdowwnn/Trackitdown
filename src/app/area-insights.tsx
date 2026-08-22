/**
 * WHAT:  Route for "Thefts near you" — area insights, one push from Explore
 *        (OUTSIDE the (tabs) group, so no tab bar).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): this imports the
 *        feature screen and nothing else.
 * LINKS: src/features/search-map/screens/AreaInsightsScreen.tsx.
 */

import { AreaInsightsScreen } from '@/features/search-map';

export default function AreaInsightsRoute() {
  return <AreaInsightsScreen />;
}
