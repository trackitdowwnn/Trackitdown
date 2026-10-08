/**
 * WHAT:  Tests for PhotoPager — the counter (shown for 2+, hidden for 1, kept
 *        in step with the page), the placeholder when there are no photos,
 *        a first frame laid out from `estimatedWidth`, and that nothing in it
 *        is pressable.
 * WHY:   It is the post detail hero AND the garage's "Your car" sheet
 *        (2026-10-08). On the sheet a tappable photo would be a tap-to-affirm
 *        trap under "Continue", so display-only is pinned here.
 * LINKS: src/shared/ui/PhotoPager.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PhotoPager } from './PhotoPager';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `https://x/${i}.jpg` }));

/** Give the pager a width, as its first layout would. */
async function measure(view: Awaited<ReturnType<typeof render>>, width = 300) {
  await act(async () => {
    fireEvent(view.getByTestId('pager'), 'layout', { nativeEvent: { layout: { width } } });
  });
}

describe('PhotoPager', () => {
  it('counts the photos, and follows the page swiped to', async () => {
    const view = await render(<PhotoPager photos={photos(5)} testID="pager" />);
    await measure(view);
    expect(view.getByText('1 / 5')).toBeTruthy();
    expect(view.getByLabelText('Photo 1 of 5')).toBeTruthy();

    await act(async () => {
      fireEvent(view.getByTestId('pager-scroll'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 600 } },
      });
    });
    expect(view.getByText('3 / 5')).toBeTruthy();
  });

  it('clamps an overscroll to the last photo', async () => {
    const view = await render(<PhotoPager photos={photos(2)} testID="pager" />);
    await measure(view);
    await act(async () => {
      fireEvent(view.getByTestId('pager-scroll'), 'momentumScrollEnd', {
        nativeEvent: { contentOffset: { x: 9999 } },
      });
    });
    expect(view.getByText('2 / 2')).toBeTruthy();
  });

  it('shows no counter for a single photo', async () => {
    const view = await render(<PhotoPager photos={photos(1)} testID="pager" />);
    await measure(view);
    expect(view.queryByTestId('pager-counter')).toBeNull();
  });

  it('shows its placeholder when there are no photos', async () => {
    const view = await render(
      <PhotoPager photos={[]} placeholder={<Text>no photos</Text>} testID="pager" />,
    );
    expect(view.getByText('no photos')).toBeTruthy();
    expect(view.queryByTestId('pager-scroll')).toBeNull();
  });

  it('lays its photos out on the FIRST frame when it knows its width', async () => {
    const view = await render(
      <PhotoPager photos={photos(2)} estimatedWidth={300} testID="pager" />,
    );
    expect(view.getByTestId('pager-scroll')).toBeTruthy();
  });

  it('⚠️ is display-only — no photo can be pressed', async () => {
    // Under the "Your car" sheet's Continue, tapping a photo to mean "yes"
    // must not do anything else (MediaIdentityCard's rule).
    const view = await render(<PhotoPager photos={photos(3)} alt="Blue BMW" testID="pager" />);
    await measure(view);
    expect(view.queryAllByRole('button')).toHaveLength(0);
    expect(view.queryAllByRole('imagebutton')).toHaveLength(0);
  });
});
