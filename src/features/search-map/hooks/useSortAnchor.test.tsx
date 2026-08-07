/**
 * WHAT:  Tests for useSortAnchor — follows the searched region, holds while
 *        frozen, and adopts the CURRENT value on unfreeze rather than
 *        replaying what it skipped.
 * WHY:   This hook is the only thing stopping the card pager from reordering
 *        under a user who is reading a card. Because selection is derived from
 *        the list INDEX, a reorder mid-read means a swipe lands on a different
 *        car than the one on screen — a wrong-car bug with no error and no
 *        crash, which is exactly the kind that ships.
 * LINKS: src/features/search-map/hooks/useSortAnchor.ts, docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';

import type { GeoRegion } from '@/shared/types';

import { useSortAnchor } from './useSortAnchor';

const region = (latitude: number): GeoRegion => ({
  latitude,
  longitude: -0.34,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
});

const ST_ALBANS = region(51.75);
const WATFORD = region(51.65);
const LUTON = region(51.88);

/** Renders the hook and reports the anchor it returned. */
function Probe({ next, frozen, onValue }: { next: GeoRegion; frozen: boolean; onValue: (r: GeoRegion) => void }) {
  onValue(useSortAnchor(next, frozen));
  return null;
}

const setup = async (next: GeoRegion, frozen: boolean) => {
  const onValue = jest.fn();
  const view = await act(async () =>
    render(<Probe next={next} frozen={frozen} onValue={onValue} />),
  );
  const rerender = async (n: GeoRegion, f: boolean) => {
    await act(async () => {
      view.rerender(<Probe next={n} frozen={f} onValue={onValue} />);
    });
  };
  const latest = () => onValue.mock.calls[onValue.mock.calls.length - 1][0] as GeoRegion;
  return { rerender, latest };
};

describe('useSortAnchor', () => {
  it('starts at the region it was given', async () => {
    const { latest } = await setup(ST_ALBANS, false);

    expect(latest()).toBe(ST_ALBANS);
  });

  it('follows a new region while unfrozen', async () => {
    const { rerender, latest } = await setup(ST_ALBANS, false);

    await rerender(WATFORD, false);

    expect(latest()).toBe(WATFORD);
  });

  // The card is open: the list must not reorder underneath it.
  it('HOLDS while frozen, however far the map moves', async () => {
    const { rerender, latest } = await setup(ST_ALBANS, false);

    await rerender(WATFORD, true);
    await rerender(LUTON, true);

    expect(latest()).toBe(ST_ALBANS);
  });

  it('adopts the CURRENT region on unfreeze, not the ones it skipped', async () => {
    const { rerender, latest } = await setup(ST_ALBANS, false);

    await rerender(WATFORD, true); // skipped while frozen
    await rerender(LUTON, false); // card dismissed here

    expect(latest()).toBe(LUTON);
  });

  it('keeps holding across re-renders that change nothing', async () => {
    const { rerender, latest } = await setup(ST_ALBANS, true);

    await rerender(ST_ALBANS, true);
    await rerender(ST_ALBANS, true);

    expect(latest()).toBe(ST_ALBANS);
  });

  // Freezing must not RESET the anchor to whatever arrived first — it holds
  // whatever was current at the moment of freezing.
  it('freezes at the latest value seen, not the initial one', async () => {
    const { rerender, latest } = await setup(ST_ALBANS, false);

    await rerender(WATFORD, false); // adopted
    await rerender(LUTON, true); // frozen from here

    expect(latest()).toBe(WATFORD);
  });
});
