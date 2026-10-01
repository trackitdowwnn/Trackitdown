/**
 * WHAT:  Tests for MakeField and ModelField, the car pickers every surface
 *        uses (posting, garage, search, alerts):
 *          - "Popular makes" leads, ranked by UK count; the search ignores
 *            accents and knows other names ("skoda", "vw");
 *          - answering allows a typed make or model, and canonicalises it;
 *          - `filter` leads with "Any…", adds a ×, and allows no free text;
 *          - long model lists get A–Z sections and the rail; a make with no
 *            list drops to free text when answering, and to nothing in a
 *            filter.
 * WHY:   Neither field had a test before the DfT list (2026-09-30), yet every
 *        make and model the app stores passes through them. A filter that let
 *        free text through would build alerts that match nothing; an answer
 *        field that lost free text would trap an owner whose car isn't listed.
 * LINKS: src/features/vehicles/post/components/MakeField.tsx, ModelField.tsx;
 *        src/shared/lib/carMakes.ts, carModels.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { MakeField } from './MakeField';
import { ModelField } from './ModelField';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Reanimated's own mock, not a hand-built stub: the shared UI barrel these
// fields import loads BottomSheet and MoneySlider, which call into far more of
// Reanimated at import than the picker does. A thin stub loaded fine alone and
// failed in the full run, depending on what another suite had cached.
jest.mock('react-native-reanimated', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-reanimated/mock'),
);

jest.mock('@/shared/lib/haptics', () => ({ lightHaptic: jest.fn(), selectionHaptic: jest.fn() }));

type View = Awaited<ReturnType<typeof render>>;

async function open(view: View, label: RegExp) {
  await act(async () => {
    fireEvent.press(view.getByLabelText(label));
  });
}

async function search(view: View, text: string, placeholder: string) {
  await act(async () => {
    fireEvent.changeText(view.getByLabelText(placeholder), text);
  });
  await act(async () => {
    jest.advanceTimersByTime(200); // past the picker's 150ms debounce
  });
}

/** Option labels in list order (radio rows), headers excluded. */
const rows = (view: View) =>
  view.getAllByRole('radio').map((row) => row.props.accessibilityLabel as string);

beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('MakeField', () => {
  it('leads with the most common UK makes, then every make A–Z', async () => {
    const view = await render(<MakeField value={null} onChange={jest.fn()} />);
    await open(view, /^Make, not selected/);

    expect(view.getByText('Popular makes')).toBeTruthy();
    // The popular tiles, in rank order, then "All makes".
    expect(rows(view).slice(0, 3)).toEqual(['Ford', 'Volkswagen', 'Vauxhall']);
    expect(view.getByRole('header', { name: 'All makes' })).toBeTruthy();
    // Ten tiles, then the A–Z starts (Abarth), not the popular ten again.
    expect(rows(view)[10]).toBe('Abarth');
    // The A–Z rail is there for the long list.
    expect(view.getByLabelText('Jump to S')).toBeTruthy();
  });

  it('finds Škoda by "skoda" and Volkswagen by "vw", with no "Use…" row', async () => {
    const onChange = jest.fn();
    const view = await render(<MakeField value={null} onChange={onChange} />);
    await open(view, /^Make, not selected/);

    await search(view, 'skoda', 'Search car makes');
    expect(rows(view)).toEqual(['Škoda']);
    expect(view.queryByText(/^Use /)).toBeNull();

    await search(view, 'vw', 'Search car makes');
    expect(rows(view)).toContain('Volkswagen');
    await act(async () => {
      fireEvent.press(view.getByRole('radio', { name: 'Volkswagen' }));
    });
    expect(onChange).toHaveBeenCalledWith('Volkswagen');
  });

  it('answering: a make that isn’t listed can be typed in', async () => {
    const onChange = jest.fn();
    const view = await render(<MakeField value={null} onChange={onChange} />);
    await open(view, /^Make, not selected/);
    await search(view, 'Trabant', 'Search car makes');

    await act(async () => {
      fireEvent.press(view.getByText('Use “Trabant”'));
    });
    expect(onChange).toHaveBeenCalledWith('Trabant');
  });

  it('filter: "Any make" leads, a × clears, and nothing unlisted can be typed', async () => {
    const onClear = jest.fn();
    const view = await render(
      <MakeField value="BMW" onChange={jest.fn()} filter={{ onClear }} />,
    );
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Clear make' }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);

    await open(view, /^Make, BMW/);
    expect(view.getByRole('radio', { name: 'Any make' })).toBeTruthy();
    await search(view, 'Trabant', 'Search car makes');
    expect(view.queryByText(/^Use /)).toBeNull();
  });
});

describe('ModelField', () => {
  it('leads with the make’s most common models, then A–Z sections with a rail', async () => {
    const view = await render(<ModelField make="BMW" value={null} onChange={jest.fn()} />);
    await open(view, /^Model, not selected/);

    expect(view.getByText('Popular BMW models')).toBeTruthy();
    expect(rows(view).slice(0, 2)).toEqual(['3 Series', '1 Series']);
    // Numbered models sit under "#", reachable from the rail, spoken "numbers".
    expect(view.getByLabelText('Jump to numbers')).toBeTruthy();
    expect(view.getByLabelText('Jump to X')).toBeTruthy();
  });

  it('gives a make the old list lacked its models', async () => {
    const view = await render(<ModelField make="Škoda" value={null} onChange={jest.fn()} />);
    await open(view, /^Model, not selected/);
    expect(rows(view)).toContain('Octavia');
  });

  it('search finds a model however it is typed, and stores its label', async () => {
    const onChange = jest.fn();
    const view = await render(<ModelField make="Mercedes-Benz" value={null} onChange={onChange} />);
    await open(view, /^Model, not selected/);
    await search(view, 'cclass', 'Search models');
    // The listed row, not a "Use…" row: pressing it stores the label.
    expect(view.queryByText(/^Use /)).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByRole('radio', { name: 'C-Class' }));
    });
    expect(onChange).toHaveBeenCalledWith('C-Class');
  });

  it('a make with no list: free text when answering, nothing in a filter', async () => {
    const answer = await render(<ModelField make="Trabant" value={null} onChange={jest.fn()} />);
    // A plain text input (labelled "Model"), not a picker.
    expect(answer.getByLabelText('Model')).toBeTruthy();
    expect(answer.queryByLabelText(/opens selection screen/)).toBeNull();

    const filter = await render(
      <ModelField make="Trabant" value={null} onChange={jest.fn()} filter={{ onClear: jest.fn() }} />,
    );
    expect(filter.toJSON()).toBeNull();
  });

  it('filter: a model it was given still shows and clears, even with no list', async () => {
    // A shared link or an old alert can carry one; hidden, it would filter
    // silently with no way to remove it.
    const onClear = jest.fn();
    const view = await render(
      <ModelField make="Trabant" value="601" onChange={jest.fn()} filter={{ onClear }} />,
    );
    expect(view.getByText('601')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Clear model' }));
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('filter: "Any BMW model" leads the list', async () => {
    const view = await render(
      <ModelField make="BMW" value={null} onChange={jest.fn()} filter={{ onClear: jest.fn() }} />,
    );
    await open(view, /^Model, Any BMW model/);
    expect(rows(view)[0]).toBe('Any BMW model');
  });
});
