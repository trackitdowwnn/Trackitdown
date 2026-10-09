/**
 * WHAT:  Tests for PhotoPager — the counter (shown for 2+, hidden for 1, kept
 *        in step with the page, and written back when the list shrinks), each
 *        photo saying its own place to a screen reader, the placeholder, a
 *        first frame laid out from `estimatedWidth`, and that nothing in it
 *        is pressable.
 * WHY:   It is the post detail hero AND the garage's "Your car" sheet
 *        (2026-10-08). On the sheet a tappable photo would be a tap-to-affirm
 *        trap under "Continue", so display-only is pinned here.
 * LINKS: src/shared/ui/PhotoPager.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { PhotoPager } from './PhotoPager';

const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `https://x/${i}.jpg` }));

type View = Awaited<ReturnType<typeof render>>;

/** The counter is a sighted aid, hidden from screen readers — so are its queries. */
const HIDDEN = { includeHiddenElements: true };

/** Give the pager a width, as its first layout would. */
async function measure(view: View, width = 300) {
  await act(async () => {
    fireEvent(view.getByTestId('pager'), 'layout', { nativeEvent: { layout: { width } } });
  });
}

async function swipeTo(view: View, x: number) {
  await act(async () => {
    fireEvent(view.getByTestId('pager-scroll'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x } },
    });
  });
}

describe('PhotoPager', () => {
  it('counts the photos, and follows the page swiped to', async () => {
    const view = await render(<PhotoPager photos={photos(5)} testID="pager" />);
    await measure(view);
    expect(view.getByText('1 / 5', HIDDEN)).toBeTruthy();
    await swipeTo(view, 600);
    expect(view.getByText('3 / 5', HIDDEN)).toBeTruthy();
  });

  it('clamps an overscroll to the last photo', async () => {
    const view = await render(<PhotoPager photos={photos(2)} testID="pager" />);
    await measure(view);
    await swipeTo(view, 9999);
    expect(view.getByText('2 / 2', HIDDEN)).toBeTruthy();
  });

  it('a list that shrinks, then grows again, does not jump the counter', async () => {
    const pager = (n: number) => <PhotoPager photos={photos(n)} testID="pager" />;
    const view = await render(pager(5));
    await measure(view);
    await swipeTo(view, 900); // photo 4
    await act(async () => view.rerender(pager(2)));
    expect(view.getByText('2 / 2', HIDDEN)).toBeTruthy();
    await act(async () => view.rerender(pager(5)));
    expect(view.getByText('2 / 5', HIDDEN)).toBeTruthy(); // where the scroll actually is
  });

  it('each photo tells a screen reader where it is; the counter is for sight only', async () => {
    const view = await render(<PhotoPager photos={photos(3)} alt="Blue BMW" testID="pager" />);
    await measure(view);
    expect(view.getByLabelText('Blue BMW, photo 2 of 3')).toBeTruthy();
    expect(view.getByTestId('pager-counter', HIDDEN).props.accessibilityElementsHidden).toBe(true);
  });

  it('shows no counter for a single photo', async () => {
    const view = await render(<PhotoPager photos={photos(1)} alt="Blue BMW" testID="pager" />);
    await measure(view);
    expect(view.queryByTestId('pager-counter')).toBeNull();
    expect(view.getByLabelText('Blue BMW')).toBeTruthy();
  });

  it('says so when there are no photos', async () => {
    const view = await render(<PhotoPager photos={[]} testID="pager" />);
    expect(view.getByLabelText('No photos added yet')).toBeTruthy();
    expect(view.queryByTestId('pager-scroll')).toBeNull();
  });

  it('lays its photos out on the FIRST frame when it knows its width', async () => {
    const view = await render(
      <PhotoPager photos={photos(2)} estimatedWidth={300} testID="pager" />,
    );
    expect(view.getByTestId('pager-scroll')).toBeTruthy();
  });

  it('⚠️ is display-only — nothing in it can be pressed', async () => {
    // Under the "Your car" sheet's Continue, tapping a photo to mean "yes"
    // must not do anything else (MediaIdentityCard's rule).
    const view = await render(<PhotoPager photos={photos(3)} alt="Blue BMW" testID="pager" />);
    await measure(view);
    // Any press handler on any rendered element — not just what declares a role.
    const handlers: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const { props, children } = node as { props?: Record<string, unknown>; children?: unknown[] };
      Object.keys(props ?? {}).forEach((key) => {
        if (/^on(Press|Click|ResponderRelease)/.test(key)) handlers.push(key);
      });
      (children ?? []).forEach(walk);
    };
    // toJSON is an array when there is more than one root — walk every one.
    const tree = view.toJSON();
    (Array.isArray(tree) ? tree : [tree]).forEach(walk);
    expect(handlers).toEqual([]);
  });

  // The sighting page marks a library photo ON the photo (ADR-0003).
  it('a photo’s badge is drawn on it and spoken with it', async () => {
    const view = await render(
      <PhotoPager
        photos={[
          { uri: 'https://x/0.jpg' },
          { uri: 'https://x/1.jpg', badge: 'From photo library' },
        ]}
        alt="Sighting photo"
        testID="pager"
      />,
    );
    await measure(view);
    expect(view.getByText('From photo library', HIDDEN)).toBeTruthy();
    expect(view.getByLabelText('Sighting photo, photo 2 of 2, From photo library')).toBeTruthy();
  });

  it('a photo still on its way is an empty page — not a broken image, and not silent', async () => {
    const view = await render(
      <PhotoPager
        photos={[{ uri: 'https://x/0.jpg' }, { badge: 'From photo library' }]}
        alt="Car"
        testID="pager"
      />,
    );
    await measure(view);
    const pending = view.getByLabelText('Car, photo 2 of 2, From photo library');
    expect(pending.props.source).toBeUndefined(); // no image yet
  });

  it('without a description, each photo is simply "Photo n of m"', async () => {
    const view = await render(<PhotoPager photos={photos(2)} testID="pager" />);
    await measure(view);
    expect(view.getByLabelText('Photo 2 of 2')).toBeTruthy();
  });
});
