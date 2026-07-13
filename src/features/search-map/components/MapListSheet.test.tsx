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

import { render } from '@testing-library/react-native';

import { MapListSheet } from './MapListSheet';
import type { MapPost } from '../types';

const mockClose = jest.fn();
const mockSnapToIndex = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { View } = require('react-native');

  const BottomSheet = React.forwardRef((props: { children?: unknown }, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({
      close: mockClose,
      snapToIndex: mockSnapToIndex,
    }));
    return React.createElement(View, null, props.children as never);
  });
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
