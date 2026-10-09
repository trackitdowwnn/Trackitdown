/**
 * WHAT:  Tests for TakenBackList — the notice's sentence per answer, the
 *        spotter's note set apart and labelled as theirs, nothing at all
 *        when empty, and three newest before "Show N more".
 * WHY:   The note is a stranger's unmoderated words (SECURITY_AND_TRUST §7)
 *        shown to a theft victim: it must always read as the spotter's, never
 *        as ours — and the list must never say something the notice didn't.
 * LINKS: src/features/sightings/components/TakenBackList.tsx;
 *        src/features/sightings/lib/withdrawReasons.ts (withdrawalSentence).
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostWithdrawal } from '../types';
import { TakenBackList } from './TakenBackList';

const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

const withdrawal = (overrides: Partial<PostWithdrawal> = {}): PostWithdrawal => ({
  withdrawnAt: at(1),
  reason: null,
  note: null,
  ...overrides,
});

it('says, for each answer, what the notice said', async () => {
  const { getByText } = await render(
    <TakenBackList
      withdrawals={[
        withdrawal({ reason: 'not_the_car' }),
        withdrawal({ reason: 'not_sure' }),
        withdrawal({ reason: 'mistake' }),
      ]}
    />,
  );
  expect(getByText('The spotter says it wasn’t your car.')).toBeTruthy();
  expect(getByText('The spotter wasn’t sure it was your car.')).toBeTruthy();
  expect(getByText('The spotter sent it by mistake.')).toBeTruthy();
});

it('⚠️ labels the note as the spotter’s own words', async () => {
  const { getByText, getByTestId } = await render(
    <TakenBackList withdrawals={[withdrawal({ reason: 'other', note: 'Wrong street, sorry' })]} />,
  );
  expect(getByText('The spotter withdrew it.')).toBeTruthy();
  expect(getByText('Written by the spotter')).toBeTruthy();
  expect(getByText('Wrong street, sorry')).toBeTruthy();
  // One stop to a screen reader: the sentence, the time in full words, and
  // the note with whose it is — never the words on their own.
  expect(getByTestId('taken-back-row').props.accessibilityLabel).toBe(
    'The spotter withdrew it. 1 hour ago. Written by the spotter: Wrong street, sorry',
  );
});

it('speaks a row without a note as the sentence and the time', async () => {
  const { getByTestId } = await render(
    <TakenBackList withdrawals={[withdrawal({ reason: 'mistake' })]} />,
  );
  expect(getByTestId('taken-back-row').props.accessibilityLabel).toBe(
    'The spotter sent it by mistake. 1 hour ago.',
  );
});

it('shows no note block when there is no note', async () => {
  const { queryByTestId } = await render(<TakenBackList withdrawals={[withdrawal()]} />);
  expect(queryByTestId('taken-back-note')).toBeNull();
});

it('renders nothing when nothing was taken back', async () => {
  const { toJSON } = await render(<TakenBackList withdrawals={[]} />);
  expect(toJSON()).toBeNull();
});

it('shows the three newest, then the rest on request', async () => {
  const { getAllByText, getByRole, queryByRole } = await render(
    <TakenBackList withdrawals={[1, 2, 3, 4, 5].map((h) => withdrawal({ withdrawnAt: at(h) }))} />,
  );
  expect(getAllByText('The spotter withdrew it.')).toHaveLength(3);
  await act(async () => {
    fireEvent.press(getByRole('button', { name: 'Show 2 more taken-back sightings' }));
  });
  expect(getAllByText('The spotter withdrew it.')).toHaveLength(5);
  expect(queryByRole('button', { name: /Show \d+ more/ })).toBeNull();
});
