/**
 * WHAT:  Tests for DistinctiveFeatureList — one accessible card per feature,
 *        collapsing past the preview count behind "Show all N features" and
 *        back.
 * WHY:   Shared by the post detail screen and the garage's "Your car" sheet
 *        (2026-10-08); a screen reader must hear each mark once, and the
 *        button must never disagree with what is shown.
 * LINKS: src/shared/ui/DistinctiveFeatureList.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { DistinctiveFeatureList } from './DistinctiveFeatureList';

const features = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    photoUrl: `https://x/${i}.jpg`,
    description: `Mark ${i + 1}`,
  }));

describe('DistinctiveFeatureList', () => {
  it('is one accessible card per feature, read once', async () => {
    const view = await render(<DistinctiveFeatureList features={features(2)} />);
    expect(view.getByLabelText('Distinctive feature: Mark 1')).toBeTruthy();
    expect(view.getByLabelText('Distinctive feature: Mark 2')).toBeTruthy();
    expect(view.queryByText(/Show all/)).toBeNull();
  });

  it('collapses past three behind "Show all N", and opens and closes', async () => {
    const view = await render(<DistinctiveFeatureList features={features(5)} />);
    expect(view.queryByLabelText('Distinctive feature: Mark 4')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByText('Show all 5 features'));
    });
    expect(view.getByLabelText('Distinctive feature: Mark 5')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByText('Show fewer features'));
    });
    expect(view.queryByLabelText('Distinctive feature: Mark 4')).toBeNull();
  });
});
