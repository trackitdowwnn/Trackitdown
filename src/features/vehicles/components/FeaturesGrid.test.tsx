/**
 * WHAT:  Tests for FeaturesGrid — renders each feature's label.
 * WHY:   The grid is the readable form of the checkable taxonomy; a dropped
 *        label means a spotter misses a distinguishing mark.
 * LINKS: src/features/vehicles/components/FeaturesGrid.tsx, docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { FeaturesGrid } from './FeaturesGrid';

describe('FeaturesGrid', () => {
  it('renders each feature label', async () => {
    const { getByText } = await render(
      <FeaturesGrid
        features={[
          { key: 'tow_bar', label: 'Tow bar', icon: 'link' },
          { key: 'dashcam', label: 'Dashcam', icon: 'video' },
        ]}
      />,
    );
    expect(getByText('Tow bar')).toBeTruthy();
    expect(getByText('Dashcam')).toBeTruthy();
  });
});
