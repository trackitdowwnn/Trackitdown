/**
 * WHAT:  Tests for MapListSheet's peek-card handoff — the `hidden` prop
 *        drives the sheet off-screen (close) while a card is up and back to
 *        peek (snapToIndex 0) when it dismisses, plus the status→handle-label
 *        mapping.
 * WHY:   This show/hide contract is what clears the bottom of the screen for
 *        the floating peek card; a regression would leave the sheet and card
 *        stacked (the bug this behaviour fixed) or strand the sheet off-screen.
 * LINKS: src/features/search-map/components/MapListSheet.tsx, docs/TESTING.md.
 *
 * gorhom is mocked at the boundary with its official Jest mock, extended so
 * the default BottomSheet exposes close()/snapToIndex() spies via its ref —
 * the imperative levers MapListSheet pulls.
 */

import { act, render } from '@testing-library/react-native';

import { MAP_SHEET_SNAP_PERCENTS, MapListSheet, sheetZoomFraction } from './MapListSheet';
import type { MapPost } from '../types';

const mockClose = jest.fn();
const mockSnapToIndex = jest.fn();
let capturedOnAnimate: ((from: number, to: number) => void) | null = null;

// The watch toggle drags in the supabase client + gate — out of scope here.
jest.mock('@/features/watchlist', () => ({ WatchToggle: () => null }));

// The official reanimated mock lacks useReducedMotion, which the sheet now
// reads (motion audit — reduce-motion guard); extend it.
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');

  const BottomSheet = React.forwardRef(
    (
      props: { children?: unknown; onAnimate?: (from: number, to: number) => void },
      ref: unknown,
    ) => {
      React.useImperativeHandle(ref, () => ({
        close: mockClose,
        snapToIndex: mockSnapToIndex,
      }));
      // Captured so a test can drive the sheet's own animation callback —
      // the real one fires from gorhom's gesture layer, which isn't here.
      capturedOnAnimate = props.onAnimate ?? null;
      return React.createElement(View, null, props.children as never);
    },
  );
  BottomSheet.displayName = 'BottomSheet';

  const BottomSheetFlatList = (props: {
    data?: unknown[];
    renderItem?: (info: { item: unknown }) => unknown;
    ListEmptyComponent?: unknown;
  }) => {
    const items = props.data ?? [];
    if (items.length === 0) {
      return props.ListEmptyComponent ?? null;
    }
    return React.createElement(
      View,
      null,
      items.map((item, index) =>
        React.createElement(View, { key: index }, props.renderItem?.({ item })),
      ),
    );
  };

  return {
    __esModule: true,
    default: BottomSheet,
    BottomSheetFlatList,
    useBottomSheetTimingConfigs: () => ({}),
  };
});

const post = (id: string): MapPost => ({
  id,
  photos: [],
  make: 'Ford',
  model: 'Fiesta',
  colour: 'Blue',
  plate: 'AB12 CDE',
  status: 'active',
  lastSeenAt: '2026-07-10T18:00:00Z',
  bountyPence: 15000,
  latitude: 51.75,
  longitude: -0.34,
});

const baseProps = {
  total: 3,
  posts: [post('a'), post('b'), post('c')],
  status: 'ready' as const,
  onRetry: () => {},
  onPressPost: () => {},
};

beforeEach(() => {
  mockClose.mockClear();
  mockSnapToIndex.mockClear();
});

describe('MapListSheet hide/show', () => {
  it('closes the sheet when a card is up and re-peeks when it dismisses', async () => {
    const { rerender } = await render(<MapListSheet {...baseProps} hidden={false} />);
    mockClose.mockClear();
    mockSnapToIndex.mockClear();

    // Card raised → sheet slides off-screen.
    await rerender(<MapListSheet {...baseProps} hidden />);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockSnapToIndex).not.toHaveBeenCalled();

    // Card dismissed → sheet returns to peek (index 0).
    await rerender(<MapListSheet {...baseProps} hidden={false} />);
    expect(mockSnapToIndex).toHaveBeenCalledWith(0);
  });

  it('renders the count in the handle label when ready', async () => {
    const { getByText } = await render(<MapListSheet {...baseProps} hidden={false} />);
    expect(getByText('3 cars in this area')).toBeTruthy();
  });

  it('shows a searching label while loading', async () => {
    const { getByText } = await render(
      <MapListSheet {...baseProps} status="loading" posts={[]} hidden={false} />,
    );
    expect(getByText('Searching this area…')).toBeTruthy();
  });
});

describe('reporting its position to the map', () => {
  // The map zooms to match the sheet, so it needs the DESTINATION index as the
  // move begins. onAnimate gives that; onChange would land ~250ms later, after
  // the sheet had already settled, and the two motions would read as separate.
  it('reports the destination index as the sheet starts moving', async () => {
    const onSnapChange = jest.fn();
    await render(<MapListSheet {...baseProps} hidden={false} onSnapChange={onSnapChange} />);

    await act(async () => {
      capturedOnAnimate?.(0, 1);
    });

    expect(onSnapChange).toHaveBeenCalledWith(1);
  });

  // -1 is gorhom closing the sheet for a peek card. The screen already drives
  // the camera from the card in that case; reporting it as a snap would fight.
  it('does NOT report the close that a peek card triggers', async () => {
    const onSnapChange = jest.fn();
    await render(<MapListSheet {...baseProps} hidden={false} onSnapChange={onSnapChange} />);

    await act(async () => {
      capturedOnAnimate?.(0, -1);
    });

    expect(onSnapChange).not.toHaveBeenCalled();
  });
});

describe('sheetZoomFraction (the camera-coupling calibration)', () => {
  // Measured off docs/design-refs/map/ — two shots of the same map at two snap
  // positions. Preserving the ground EXACTLY would have given a camera scale of
  // 0.50; the reference gives 0.59, and solving for what it does preserve puts
  // the bottom edge a peek-height below the sheet's top. So peek must frame the
  // whole map, and only the rise above peek insets the camera.
  //
  // Nothing else can guard this: there is no MapSearchScreen test, and the
  // difference between this and insetsForSheet is invisible in a screenshot —
  // it only shows as "the zoom feels too aggressive" on a device.
  it('insets nothing at peek', () => {
    expect(sheetZoomFraction(0)).toBe(0);
  });

  it('insets only the rise ABOVE peek at the taller snaps', () => {
    const [peek, half, full] = MAP_SHEET_SNAP_PERCENTS;

    expect(sheetZoomFraction(1)).toBeCloseTo((half - peek) / 100);
    expect(sheetZoomFraction(2)).toBeCloseTo((full - peek) / 100);
  });

  // handleSheetSnap passes the CURRENT index through this too, and gorhom can
  // report -1 as it closes for a peek card.
  it('falls back to peek for an index off the end', () => {
    expect(sheetZoomFraction(-1)).toBe(0);
    expect(sheetZoomFraction(99)).toBe(0);
  });

  // It must stay strictly below insetsForSheet's occlusion, or the calibration
  // has silently reverted to the old zoom-by-full-sheet-height behaviour.
  it('is gentler than the sheet actually occludes, at every snap', () => {
    MAP_SHEET_SNAP_PERCENTS.forEach((percent, index) => {
      expect(sheetZoomFraction(index)).toBeLessThan(percent / 100);
    });
  });
});

describe('opening itself on entry', () => {
  // Scoped to this block: the rest of the file renders without act() and
  // global fake timers would strand those awaits.
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rises to half once the first search settles', async () => {
    const view = await act(async () =>
      render(<MapListSheet {...baseProps} status="loading" expandOnEntry={false} />),
    );
    mockSnapToIndex.mockClear();

    // Two acts, not one: the rerender's effect only registers its timer when
    // act flushes, so advancing the clock in the same act would run it first.
    await act(async () => {
      view.rerender(<MapListSheet {...baseProps} status="ready" expandOnEntry />);
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(mockSnapToIndex).toHaveBeenCalledWith(1);
  });

  // It opens onto CARS, not onto skeletons — that is the whole reason this is
  // gated on the search settling rather than fired from mount.
  it('stays at peek while the first search is still running', async () => {
    await act(async () => {
      render(<MapListSheet {...baseProps} status="loading" expandOnEntry={false} />);
      jest.advanceTimersByTime(1000);
    });

    expect(mockSnapToIndex).not.toHaveBeenCalledWith(1);
  });

  it('only ever does it once — a later search must not re-open it', async () => {
    const view = await act(async () =>
      render(<MapListSheet {...baseProps} status="ready" expandOnEntry />),
    );
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(mockSnapToIndex).toHaveBeenCalledWith(1);
    mockSnapToIndex.mockClear();

    await act(async () => {
      view.rerender(<MapListSheet {...baseProps} status="ready" expandOnEntry searchId={2} />);
      jest.advanceTimersByTime(1000);
    });

    expect(mockSnapToIndex).not.toHaveBeenCalledWith(1);
  });

  // Someone who has already dragged the sheet has said where they want it.
  it('gives up if the user drags the sheet first', async () => {
    await act(async () => {
      render(<MapListSheet {...baseProps} status="ready" expandOnEntry />);
    });
    mockSnapToIndex.mockClear();

    // The user drags to full before the beat elapses.
    await act(async () => {
      capturedOnAnimate?.(0, 2);
      jest.advanceTimersByTime(1000);
    });

    expect(mockSnapToIndex).not.toHaveBeenCalledWith(1);
  });

  // Tapping a pin within the beat hides the sheet. This effect re-runs when
  // the card dismisses, so without a permanent cancel the sheet would rise to
  // half at that moment — long after entry, and under a user who had just
  // chosen what to look at.
  it('gives up for good if a peek card goes up during the beat', async () => {
    const view = await act(async () =>
      render(<MapListSheet {...baseProps} status="ready" expandOnEntry hidden={false} />),
    );

    // Pin tapped before the beat elapses.
    await act(async () => {
      view.rerender(<MapListSheet {...baseProps} status="ready" expandOnEntry hidden />);
    });
    mockSnapToIndex.mockClear();

    // Card dismissed much later.
    await act(async () => {
      view.rerender(<MapListSheet {...baseProps} status="ready" expandOnEntry hidden={false} />);
    });
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockSnapToIndex).not.toHaveBeenCalledWith(1);
    // ...but it still returns to PEEK, which is the card-dismiss contract.
    expect(mockSnapToIndex).toHaveBeenCalledWith(0);
  });

  // gorhom animates to the initial index on mount, reporting 0. That is not a
  // drag, and treating it as one would disable the feature outright.
  it('is NOT cancelled by the mount settling at peek', async () => {
    await act(async () => {
      render(<MapListSheet {...baseProps} status="ready" expandOnEntry />);
    });

    await act(async () => {
      capturedOnAnimate?.(-1, 0);
      jest.advanceTimersByTime(1000);
    });

    expect(mockSnapToIndex).toHaveBeenCalledWith(1);
  });
});
