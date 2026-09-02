/**
 * WHAT:  Tests for NameStep — that the field opens EMPTY and the suggested
 *        name reaches it as a placeholder instead.
 * WHY:   ⚠️ THIS IS THE BEHAVIOUR THE 2026-08-27 CHANGE SHIPS, and it had no
 *        test at all. `alertFlow.test.ts` asserts the ABSENCE of the old
 *        seeding hook, the name schema and the helper copy — none of which
 *        would fail if `NameStep` quietly went back to putting the suggestion
 *        in `value`. The one thing the owner asked for is the one thing that
 *        was unpinned.
 *
 *        Only NameStep is covered here: the other three steps are a map, a
 *        slider and pickers, all of which need the native graph.
 * LINKS: ./alertSteps.tsx; ../lib/alertFlow.tsx; ../lib/alertName.ts.
 */

import { render } from '@testing-library/react-native';

import { NameStep } from './alertSteps';

// ⚠️ MODULE-LEVEL DEPS ONLY. NameStep itself needs nothing but a TextField —
// but alertSteps.tsx imports the vehicles barrel for the car pickers, which
// reaches auth and then AsyncStorage's native module and dies at import. These
// mocks buy the file, not the behaviour.
jest.mock('@/features/vehicles', () => ({
  BODY_TYPE_OPTIONS: [],
  BODY_TYPE_UNKNOWN: '__unknown__',
}));
// CAR_COLOURS is no longer in that mock: it moved to @/shared/lib on
// 2026-08-28, which imports no feature and so needs no stubbing at all.
// ⚠️ bountyBounds is deliberately NOT mocked. It was, with the two numbers
// retyped by hand — and that is precisely the anti-pattern TESTING.md records
// an incident about: a mocked constant hid a floor that had been £10 for nine
// days while the app went on enforcing £50. The module imports nothing, so
// there was never anything to stub around; the real values are free.
jest.mock('@/shared/lib/carMakes', () => ({ CAR_MAKES: [], POPULAR_MAKES: [] }));
jest.mock('@/shared/lib/carModels', () => ({ modelsForMake: () => [] }));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({ expoLocationServices: {} }));
jest.mock('./AlertZoneMap', () => ({ AlertZoneMap: () => null, AlertZoneMapProvider: () => null }));

// TextField is mocked to a host element so the test reads exactly what NameStep
// PASSES it — which is the contract at stake: an empty `value` and the
// suggestion as `placeholder`, not the other way round.
jest.mock('@/shared/ui', () => {
  const { View: RNView } = jest.requireActual('react-native');
  return {
    TextField: (props: Record<string, unknown>) => <RNView {...props} />,
    ChoiceChips: () => null,
    LocationPicker: () => null,
    MoneySlider: () => null,
    RadiusSlider: () => null,
    SelectField: () => null,
  };
});

const answers = (overrides: Record<string, unknown> = {}) => ({
  radiusMiles: 10,
  placeLabel: 'Luton',
  approximate: true,
  ...overrides,
});

const noop = () => {};

describe('NameStep', () => {
  it('⚠️ opens EMPTY — the suggestion is never the value', async () => {
    // It used to arrive pre-filled with "10 miles around Luton", so anyone who
    // wanted their own name had to clear someone else's words first.
    const { getByTestId } = await render(
      <NameStep answers={answers()} setAnswers={noop} />,
    );

    expect(getByTestId('alert-name').props.value).toBe('');
  });

  it('offers the suggestion as the placeholder, built from their answers', async () => {
    const { getByTestId } = await render(
      <NameStep answers={answers()} setAnswers={noop} />,
    );

    // Not the old generic "Home, Work commute…" — it is their own area.
    expect(getByTestId('alert-name').props.placeholder).toBe('10 miles around Luton');
  });

  it('folds the car into the suggestion when one was chosen', async () => {
    const { getByTestId } = await render(
      <NameStep answers={answers({ make: 'BMW', colour: 'Blue' })} setAnswers={noop} />,
    );

    expect(getByTestId('alert-name').props.placeholder).toBe('Blue BMWs near Luton');
  });

  it('keeps a name the user has typed', async () => {
    const { getByTestId } = await render(
      <NameStep answers={answers({ name: 'My commute' })} setAnswers={noop} />,
    );

    expect(getByTestId('alert-name').props.value).toBe('My commute');
  });
});
