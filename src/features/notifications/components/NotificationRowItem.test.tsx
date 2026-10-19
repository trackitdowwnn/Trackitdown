/**
 * WHAT:  Tests for one notification row on its own — the two-line body, the
 *        unread title weight, the errand standing in for the body (and
 *        wrapping, never cut), and the forwarded press.
 * WHY:   The row had no test of its own; its screen's suite covered it only
 *        through the list. The 2026-10-19 readability pass (owner: "squashed
 *        and hard to read") changed what a row may show — pinned here, where
 *        a later density pass would have to undo it on purpose.
 * LINKS: ./NotificationRowItem.tsx; ../screens/NotificationCenterScreen.test.tsx.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { typography } from '@/shared/theme';

import type { NotificationRow } from '../api/notificationsApi';
import { NotificationRowItem } from './NotificationRowItem';

const POST_ID = '11111111-2222-3333-4444-555555555555';

const row = (overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n-1',
  kind: 'alert',
  title: 'A blue BMW was reported stolen near Camden',
  body: 'Keep an eye out — never approach the car or anyone near it. Report what you see.',
  payload: { type: 'alert', postId: POST_ID },
  readAt: null,
  createdAt: new Date().toISOString(),
  imageUrl: null,
  ...overrides,
});

const read = () => ({ readAt: new Date().toISOString() });

describe('the body', () => {
  it('gets two lines, so safety advice isn’t cut mid-sentence', async () => {
    const { getByTestId } = await render(
      <NotificationRowItem row={row(read())} onPress={jest.fn()} />,
    );

    expect(getByTestId('notification-body-n-1').props.numberOfLines).toBe(2);
  });

  it('keeps the title to one line', async () => {
    const { getByText } = await render(<NotificationRowItem row={row()} onPress={jest.fn()} />);

    expect(getByText('A blue BMW was reported stolen near Camden').props.numberOfLines).toBe(1);
  });
});

describe('unread', () => {
  it('sets the title in the heavier family, and a read row does not', async () => {
    const title = 'A blue BMW was reported stolen near Camden';
    const unread = await render(<NotificationRowItem row={row()} onPress={jest.fn()} />);
    expect(StyleSheet.flatten(unread.getByText(title).props.style).fontFamily).toBe(
      typography.cardTitle.fontFamily,
    );
    await unread.unmount();

    const seen = await render(<NotificationRowItem row={row(read())} onPress={jest.fn()} />);
    expect(StyleSheet.flatten(seen.getByText(title).props.style).fontFamily).toBe(
      typography.body.fontFamily,
    );
  });

  it('⚠️ shows the errand in the body’s place, and lets it wrap', async () => {
    const { getByTestId, queryByTestId } = await render(
      <NotificationRowItem
        row={row({ kind: 'credited', payload: { type: 'credited', postId: POST_ID } })}
        onPress={jest.fn()}
      />,
    );

    const errand = getByTestId('attention-n-1');
    expect(errand).toHaveTextContent('Add your bank details');
    // A cut-off errand tells nobody what to do.
    expect(errand.props.numberOfLines).toBeUndefined();
    expect(queryByTestId('notification-body-n-1')).toBeNull();
  });
});

it('forwards the press with its row', async () => {
  const onPress = jest.fn();
  const { getByTestId } = await render(<NotificationRowItem row={row()} onPress={onPress} />);

  await fireEvent.press(getByTestId('notification-n-1'));

  expect(onPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'n-1' }));
});
