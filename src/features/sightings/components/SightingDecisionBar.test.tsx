/**
 * WHAT:  Tests for the pinned "Is this your car?" bar: the question and its
 *        two answers, each handed to the screen (which confirms "Yes" before
 *        sending it), and the spinner on the answer being sent — the other
 *        one disabled.
 * WHY:   Since 2026-10-19 the bar exists only while the owner is deciding,
 *        so it is only ever this; the spinner rule is from the review of #145
 *        (a shared flag once spun on "Yes" while "Not my car" was sent).
 * LINKS: src/features/sightings/components/SightingDecisionBar.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SightingDecisionBar } from './SightingDecisionBar';

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

const renderBar = (pending: 'yes' | 'not_mine' | null = null) => {
  const handlers = { onYes: jest.fn(), onNotMine: jest.fn() };
  return { handlers, view: render(<SightingDecisionBar {...handlers} pending={pending} />) };
};

it('asks the question, and hands each answer to the screen', async () => {
  const { handlers, view: rendering } = renderBar();
  const view = await rendering;
  expect(view.getByText('Is this your car?')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByRole('button', { name: 'Yes, it’s my car' }));
  });
  await act(async () => {
    fireEvent.press(view.getByRole('button', { name: 'Not my car' }));
  });
  expect(handlers.onYes).toHaveBeenCalledTimes(1);
  expect(handlers.onNotMine).toHaveBeenCalledTimes(1);
});

it.each([
  ['not_mine', 'Not my car', 'Yes, it’s my car'],
  ['yes', 'Yes, it’s my car', 'Not my car'],
] as const)(
  '⚠️ while "%s" is sent, the spinner is on it and the other is disabled',
  async (pending, sending, other) => {
    const view = await renderBar(pending).view;
    expect(view.getByRole('button', { name: sending, busy: true })).toBeTruthy();
    expect(view.getByRole('button', { name: other, busy: false })).toBeDisabled();
  },
);
