/**
 * WHAT:  Tests for CollectionPickerSheet — the "Change" surface: it opens only
 *        on an intent, checks the list the car is currently in, re-files on a
 *        tap, retargets the next save, creates a list inline, and reports a
 *        failed move without implying the car was lost.
 * WHY:   This sheet opens on top of a COMPLETED save, so every exit from it
 *        must leave the car filed somewhere. The two ways to break that are a
 *        failed move that looks like a failed save, and a create-then-file that
 *        stops halfway — both are asserted here.
 * LINKS: src/features/watchlist/components/CollectionPickerSheet.tsx;
 *        src/features/watchlist/lib/pickerIntent.ts; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { CollectionError } from '../lib/collectionError';
import { getMruTarget, resetMruCollectionForTests } from '../lib/mruCollection';
import {
  getCollectionPickerIntent,
  requestCollectionPicker,
  resetCollectionPickerForTests,
} from '../lib/pickerIntent';
import { CollectionPickerSheet } from './CollectionPickerSheet';

// Reached transitively via mruCollection, which persists the chosen list.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockOpen = jest.fn();
const mockClose = jest.fn();
const mockToastShow = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable, TextInput } = require('react-native');
  return {
    BottomSheet: ({ ref, children }: { ref?: React.Ref<unknown>; children: React.ReactNode }) => {
      React.useImperativeHandle(ref, () => ({ open: mockOpen, close: mockClose }));
      return React.createElement(View, null, children);
    },
    Button: ({ label, onPress, disabled }: Record<string, never>) =>
      React.createElement(
        Pressable,
        { testID: `btn-${label}`, onPress, disabled, accessibilityState: { disabled } },
        React.createElement(Text, null, label),
      ),
    ListRow: ({ title, subtitle, selected, onPress, disabled }: Record<string, never>) =>
      React.createElement(
        Pressable,
        {
          testID: `row-${title}`,
          onPress,
          disabled,
          accessibilityState: { selected, disabled },
        },
        React.createElement(Text, null, title),
        subtitle ? React.createElement(Text, null, subtitle) : null,
      ),
    TextField: ({ value, onChangeText }: Record<string, never>) =>
      React.createElement(TextInput, { testID: 'name-field', value, onChangeText }),
    useToast: () => ({ show: mockToastShow }),
  };
});

const mockMoveWatch = jest.fn(async (_postId: string, _collectionId: string | null) => {});
jest.mock('../api/collectionsApi', () => ({
  moveWatch: (postId: string, collectionId: string | null) => mockMoveWatch(postId, collectionId),
}));
// ⚠️ lib/collectionError is deliberately NOT mocked. The sheet narrows its
// toasts on `instanceof CollectionError`, so a stub class here would let these
// tests pass while the shipped guard rejected the very errors it exists to show
// — TESTING.md's mocked-constant lesson, applied to a class.

const COMMUTE = { id: 'cccccccc-0000-0000-0000-00000000000c', name: 'My commute', createdAt: 'x' };
const NEAR_WORK = { id: 'dddddddd-0000-0000-0000-00000000000d', name: 'Near work', createdAt: 'y' };

const mockCreate = jest.fn(async (_name: string) => NEAR_WORK);
let mockCollections = [COMMUTE];
jest.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    status: 'ready',
    collections: mockCollections,
    reload: jest.fn(),
    create: (name: string) => mockCreate(name),
    rename: jest.fn(),
    remove: jest.fn(),
  }),
}));

jest.mock('@/features/auth', () => ({
  useSession: () => ({ status: 'signedIn', userId: 'user-1' }),
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const POST_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';

beforeEach(() => {
  jest.clearAllMocks();
  mockCollections = [COMMUTE];
  mockMoveWatch.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue(NEAR_WORK);
  resetMruCollectionForTests();
  resetCollectionPickerForTests();
});

async function mountWithIntent(currentCollectionId: string | null = null) {
  const utils = await act(async () => render(<CollectionPickerSheet />));
  await act(async () => {
    requestCollectionPicker({ postId: POST_ID, currentCollectionId, source: 'save_toast' });
  });
  return utils;
}

describe('opening', () => {
  it('stays shut until an intent is raised', async () => {
    await act(async () => render(<CollectionPickerSheet />));

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('opens on an intent and offers Saved plus every list', async () => {
    const { getByTestId } = await mountWithIntent();

    expect(mockOpen).toHaveBeenCalled();
    expect(getByTestId('row-Saved')).toBeTruthy();
    expect(getByTestId('row-My commute')).toBeTruthy();
  });

  it('offers both choices when the user has no lists at all', async () => {
    // The first-run state, and the one most people will ever see: keep it in
    // Saved, or make a list. Both must be present and read as peers — this is
    // the whole feature's front door.
    mockCollections = [];
    const { getByTestId } = await mountWithIntent();

    expect(getByTestId('row-Saved')).toBeTruthy();
    expect(getByTestId('row-New list')).toBeTruthy();
    expect(getByTestId('row-New list').props.accessibilityState.disabled).toBeFalsy();
  });

  it('checks the list the car is currently in', async () => {
    const { getByTestId } = await mountWithIntent(COMMUTE.id);

    expect(getByTestId('row-My commute').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('row-Saved').props.accessibilityState.selected).toBe(false);
  });
});

describe('re-filing', () => {
  it('moves the car and closes', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-My commute'));
    });

    expect(mockMoveWatch).toHaveBeenCalledWith(POST_ID, COMMUTE.id);
    expect(mockClose).toHaveBeenCalled();
    expect(getCollectionPickerIntent()).toBeNull();
  });

  it('retargets the next save at the list just chosen, by name', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-My commute'));
    });

    // The name matters: it is what lets the NEXT save's toast say where it went.
    expect(getMruTarget('user-1')).toEqual({ id: COMMUTE.id, name: 'My commute' });
  });

  it('moving back to Saved is a real choice', async () => {
    const { getByTestId } = await mountWithIntent(COMMUTE.id);

    await act(async () => {
      fireEvent.press(getByTestId('row-Saved'));
    });

    expect(mockMoveWatch).toHaveBeenCalledWith(POST_ID, null);
    expect(getMruTarget('user-1')).toBeNull();
  });

  it('a failed move says so without claiming the car was lost', async () => {
    mockMoveWatch.mockRejectedValue(
      new CollectionError('We couldn’t find that list.', 'COLLECTION_NOT_FOUND'),
    );
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-My commute'));
    });

    expect(mockToastShow).toHaveBeenCalledWith('We couldn’t find that list.', 'error');
    // Still open: the user can pick somewhere else. The car remains saved
    // where it was either way.
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('a raw server error is never shown to the user', async () => {
    // A PostgREST/RLS failure is an Error like any other, so an `instanceof
    // Error` guard would print it. It has happened before: an RLS refusal once
    // reached a user as 'new row violates row-level security policy for table
    // "objects"'. Only copy this app wrote may reach a toast.
    mockMoveWatch.mockRejectedValue(
      new Error('new row violates row-level security policy for table "watchlist_items"'),
    );
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-My commute'));
    });

    expect(mockToastShow).toHaveBeenCalledWith('We couldn’t move that car.', 'error');
    expect(mockClose).not.toHaveBeenCalled();
  });
});

describe('creating a list inline', () => {
  it('swaps the body in place rather than pushing a second sheet', async () => {
    const { getByTestId, queryByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-New list'));
    });

    expect(getByTestId('collection-picker-create')).toBeTruthy();
    expect(queryByTestId('collection-picker')).toBeNull();
    // One sheet throughout — no second open() call.
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('creates then files into the new list in one action', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-New list'));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId('name-field'), 'Near work');
    });
    await act(async () => {
      fireEvent.press(getByTestId('btn-Create and save here'));
    });

    expect(mockCreate).toHaveBeenCalledWith('Near work');
    // The half-done state — a list made but the car not moved into it — is the
    // one this must never leave behind.
    expect(mockMoveWatch).toHaveBeenCalledWith(POST_ID, NEAR_WORK.id);
    expect(mockClose).toHaveBeenCalled();
  });

  it('a rejected name keeps the field open with the reason', async () => {
    mockCreate.mockRejectedValue(
      new CollectionError('You already have a list with that name.', 'COLLECTION_NAME_TAKEN'),
    );
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('row-New list'));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId('name-field'), 'My commute');
    });
    await act(async () => {
      fireEvent.press(getByTestId('btn-Create and save here'));
    });

    expect(mockToastShow).toHaveBeenCalledWith('You already have a list with that name.', 'error');
    expect(getByTestId('collection-picker-create')).toBeTruthy();
    expect(mockMoveWatch).not.toHaveBeenCalled();
  });

  it('blocks New list at the cap instead of failing after typing', async () => {
    mockCollections = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      name: `List ${i}`,
      createdAt: 'x',
    }));
    const { getByTestId, getByText } = await mountWithIntent();

    expect(getByTestId('row-New list').props.accessibilityState.disabled).toBe(true);
    // …and says why, rather than being mysteriously dead.
    expect(getByText('You’ve reached the limit of 20 lists')).toBeTruthy();
  });
});

describe('dismissing', () => {
  it('resets to the list body, so the next open is not stuck on the name field', async () => {
    const { getByTestId, queryByTestId } = await mountWithIntent();
    await act(async () => {
      fireEvent.press(getByTestId('row-New list'));
    });
    expect(getByTestId('collection-picker-create')).toBeTruthy();

    // Choose a list: that closes, which resets.
    await act(async () => {
      fireEvent.press(getByTestId('btn-Back'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('row-My commute'));
    });

    await act(async () => {
      requestCollectionPicker({ postId: POST_ID, currentCollectionId: null, source: 'save_toast' });
    });

    expect(getByTestId('collection-picker')).toBeTruthy();
    expect(queryByTestId('collection-picker-create')).toBeNull();
  });
});
