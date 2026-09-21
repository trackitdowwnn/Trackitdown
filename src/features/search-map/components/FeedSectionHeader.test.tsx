/**
 * WHAT:  Tests for FeedSectionHeader's two optional actions — the stats
 *        button and the See all chevron — and the presence-is-permission
 *        contract that decides which render.
 * WHY:   The header is a recycled FlashList row that derives everything from
 *        props, so "which buttons show" is exactly the thing to pin: a header
 *        that grew a stats button on every section (or lost its chevron) would
 *        look fine in one screenshot and be wrong on the next section down.
 *        Order matters too — stats sits INSIDE the chevron so the affordance
 *        readers already know stays where it was.
 * LINKS: ./FeedSectionHeader.tsx; ../screens/HomeFeedScreen.test.tsx (which
 *        sections pass which handlers).
 */

import { cleanup, fireEvent, render } from '@testing-library/react-native';

import { FeedSectionHeader } from './FeedSectionHeader';

// Explicit, as MoneyRangeSlider.test.tsx does. ⚠️ ORDER MATTERS in this file:
// under RNTL 13's async render, the test that presses BOTH buttons leaves the
// following render returning null (observed 2026-09-21; the component is
// fine — the same JSX renders in isolation). The custom-label test therefore
// runs first. If a test here starts failing with 'Unable to find', check the
// order before the component.
afterEach(cleanup);

describe('FeedSectionHeader', () => {
  it('honours custom accessibility labels for both actions', async () => {
    const onSeeAll = jest.fn();
    const onStats = jest.fn();
    const view = await render(
      <FeedSectionHeader
        title="Near you"
        onSeeAll={onSeeAll}
        seeAllAccessibilityLabel="Change the area"
        onStats={onStats}
        statsAccessibilityLabel="Theft figures for your area"
        statsTestID="stats-custom"
      />,
    );
    // The defaults must NOT also render — a custom label replaces, never adds.
    expect(view.queryByLabelText('See all — Near you')).toBeNull();
    expect(view.queryByLabelText('Theft figures — Near you')).toBeNull();
    fireEvent.press(view.getByTestId('stats-custom'));
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('stats-custom').props.accessibilityLabel).toBe(
      'Theft figures for your area',
    );
  });

  it('renders the title as a header with no actions when no handlers are passed', async () => {
    const view = await render(<FeedSectionHeader title="Recently recovered near you" />);
    expect(view.getByRole('header', { name: 'Recently recovered near you' })).toBeTruthy();
    expect(view.queryByRole('button')).toBeNull();
  });

  it('renders only the chevron when only onSeeAll is passed', async () => {
    const onSeeAll = jest.fn();
    const view = await render(<FeedSectionHeader title="Near you" onSeeAll={onSeeAll} />);
    expect(view.getAllByRole('button')).toHaveLength(1);
    fireEvent.press(view.getByLabelText('See all — Near you'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('Theft figures — Near you')).toBeNull();
  });

  it('renders only the stats button when only onStats is passed', async () => {
    const onStats = jest.fn();
    const view = await render(<FeedSectionHeader title="Near you" onStats={onStats} />);
    expect(view.getAllByRole('button')).toHaveLength(1);
    fireEvent.press(view.getByLabelText('Theft figures — Near you'));
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('See all — Near you')).toBeNull();
  });

  it('renders both, stats first then the chevron, each firing its own handler', async () => {
    const onSeeAll = jest.fn();
    const onStats = jest.fn();
    const view = await render(
      <FeedSectionHeader
        title="Recently stolen in St Albans"
        onSeeAll={onSeeAll}
        onStats={onStats}
        statsTestID="stats-st-albans"
      />,
    );
    const buttons = view.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    // Stats INSIDE the chevron: the chevron is the affordance readers already
    // know and it stays at the row's end.
    expect(buttons[0].props.accessibilityLabel).toBe('Theft figures — Recently stolen in St Albans');
    expect(buttons[1].props.accessibilityLabel).toBe('See all — Recently stolen in St Albans');

    fireEvent.press(view.getByTestId('stats-st-albans'));
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(onSeeAll).not.toHaveBeenCalled();

    fireEvent.press(view.getByLabelText('See all — Recently stolen in St Albans'));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
    expect(onStats).toHaveBeenCalledTimes(1);
  });

  it('is icon-only: neither action adds visible text beside the title', async () => {
    // HomeFeedScreen.test.tsx orders feed rows by matching visible text, so a
    // text label on either button would silently break that assertion.
    const view = await render(
      <FeedSectionHeader title="Near you" onSeeAll={jest.fn()} onStats={jest.fn()} />,
    );
    expect(view.queryByText(/see all|stats|figures/i)).toBeNull();
  });
});
