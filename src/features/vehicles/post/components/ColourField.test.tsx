/**
 * WHAT:  Tests for ColourField — selection writes the canonical colour name,
 *        every swatch shows its NAME label (the accessibility guarantee), light
 *        swatches render a border, the note trigger appears only for the escapes
 *        and opens a sheet whose input captures text, and a pre-set colour (incl.
 *        a DVLA-mapped one) pre-selects its swatch.
 * WHY:   The colour is a clean enum a colour-blind spotter reads by NAME, so a
 *        missing name label, a light swatch that vanishes, or a note leaking
 *        under a plain colour are real defects — pinned here.
 * LINKS: src/features/vehicles/post/components/ColourField.tsx;
 *        src/shared/lib/carColours.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Keyboard, StyleSheet } from 'react-native';

import { ColourField } from './ColourField';
import { CAR_COLOURS, colourFromDvla } from '@/shared/lib';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// BottomSheet is gorhom-based; reuse the visibility-aware boundary mock the
// BottomSheet suite established so open()/close() gate children.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    wedged = false;
    present = () => {
      if (this.wedged) return;
      this.setState({ visible: true });
    };
    dismiss = () => {
      if (!this.state.visible) {
        this.wedged = true;
        return;
      }
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

// The sheet's input, queried by its floating label (its accessible name).
const NOTE_INPUT_LABEL = 'Details';

function renderField(props: Partial<React.ComponentProps<typeof ColourField>> = {}) {
  return render(
    <ColourField
      value={null}
      note=""
      onChange={jest.fn()}
      onChangeNote={jest.fn()}
      {...props}
    />,
  );
}

describe('ColourField', () => {
  it('writes the canonical colour name when a swatch is tapped', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await renderField({ onChange });

    fireEvent.press(getByLabelText('Blue'));

    expect(onChange).toHaveBeenCalledWith('Blue');
  });

  it('shows the NAME label on every swatch (the a11y guarantee)', async () => {
    const { getByText, getByLabelText } = await renderField();

    for (const colour of CAR_COLOURS) {
      // Visible text label…
      expect(getByText(colour.name)).toBeTruthy();
      // …and the swatch is a labelled radio.
      expect(getByLabelText(colour.name)).toBeTruthy();
    }
  });

  it('marks only the selected swatch as checked', async () => {
    const { getByLabelText } = await renderField({ value: 'Silver' });

    expect(getByLabelText('Silver').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Blue').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('borders EVERY swatch, pale and dark alike, so none can vanish', async () => {
    // Was "borders light swatches ... and leaves dark ones plain", which pinned
    // an assumption that only held while the surface behind a swatch was always
    // white. Dark mode inverted it: Black #1A1A1A on a #1E1E1E card is 1.03:1,
    // so the plain-by-design half became the invisible half.
    const { getByTestId } = await renderField();

    const white = StyleSheet.flatten(getByTestId('colour-swatch-White').props.style);
    const black = StyleSheet.flatten(getByTestId('colour-swatch-Black').props.style);

    expect(white.borderWidth).toBe(1);
    expect(black.borderWidth).toBe(1);
  });

  it('does not open the note sheet for a plain colour', async () => {
    const onChange = jest.fn();
    const { getByLabelText, queryByLabelText } = await renderField({ onChange });

    await act(async () => {
      fireEvent.press(getByLabelText('Blue'));
    });

    expect(onChange).toHaveBeenCalledWith('Blue');
    // No sheet, so its input never mounts.
    expect(queryByLabelText(NOTE_INPUT_LABEL)).toBeNull();
  });

  it('opens the note sheet immediately when an escape colour is tapped', async () => {
    const onChange = jest.fn();
    const onChangeNote = jest.fn();
    const { getByLabelText, queryByLabelText } = await renderField({ onChange, onChangeNote });

    // The sheet input isn't mounted until the escape swatch opens the sheet.
    expect(queryByLabelText(NOTE_INPUT_LABEL)).toBeNull();

    await act(async () => {
      fireEvent.press(getByLabelText('Multicolour / wrapped'));
    });

    expect(onChange).toHaveBeenCalledWith('Multicolour / wrapped');

    const noteInput = getByLabelText(NOTE_INPUT_LABEL);
    fireEvent.changeText(noteInput, 'matte black wrap over silver');

    expect(onChangeNote).toHaveBeenCalledWith('matte black wrap over silver');
  });

  it('pre-selects the swatch matching a DVLA-mapped colour', async () => {
    // The (stubbed) plate lookup would map "SILVER" → "Silver" and set it.
    const { getByLabelText } = await renderField({ value: colourFromDvla('SILVER') });

    expect(getByLabelText('Silver').props.accessibilityState).toMatchObject({ checked: true });
  });
});

/** ColourField with its value and note held in state, as the step holds them. */
function Stateful({ onDone }: { onDone?: () => void }) {
  const [colour, setColour] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  return (
    <ColourField
      value={colour}
      note={note}
      onChange={setColour}
      onChangeNote={setNote}
      onDone={onDone}
    />
  );
}

describe('ColourField — the V5C palette and smarter escapes (2026-10-12)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('offers every V5C colour — Beige, Maroon, Turquoise, Pink and Cream among them', async () => {
    const { getByLabelText, queryByLabelText } = await renderField();
    for (const name of ['Brown', 'Beige', 'Maroon', 'Turquoise', 'Pink', 'Cream']) {
      expect(getByLabelText(name)).toBeTruthy();
    }
    expect(queryByLabelText('Brown / Beige')).toBeNull();
  });

  it('⚠️ an old "Brown / Beige" opens with Brown selected', async () => {
    const { getByLabelText } = await renderField({ value: 'Brown / Beige' });
    expect(getByLabelText('Brown').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('says what is chosen in words, and the chosen name goes bold', async () => {
    const { getByTestId, getByText } = await renderField({ value: 'Blue' });
    expect(getByTestId('colour-summary').props.children).toBe('Selected: Blue');
    const chosen = StyleSheet.flatten(getByText('Blue').props.style);
    const other = StyleSheet.flatten(getByText('Red').props.style);
    expect(chosen.fontFamily).not.toBe(other.fontFamily);
  });

  it('"Other" asks what colour it is — and Done waits for an answer', async () => {
    const onDone = jest.fn();
    const view = await render(<Stateful onDone={onDone} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText('Other'));
    });
    expect(view.getByText('What colour is it?')).toBeTruthy();
    const done = view.getByRole('button', { name: 'Done' });
    expect(done.props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('colour-note-input'), 'Teal');
    });
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Done' }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('colour-summary').props.children).toBe('Selected: Other — Teal');
  });

  it('the wrap asks to describe it, and its note is optional', async () => {
    const onDone = jest.fn();
    const view = await render(<Stateful onDone={onDone} />);
    await act(async () => {
      fireEvent.press(view.getByLabelText('Multicolour / wrapped'));
    });
    expect(view.getByText('Describe the wrap')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Done' }));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('focuses the box once the sheet has risen, and Done takes the keyboard with it', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    const view = await render(<Stateful />);
    await act(async () => {
      fireEvent.press(view.getByLabelText('Multicolour / wrapped'));
    });
    // Not focused as it mounts: no autoFocus.
    expect(view.getByTestId('colour-note-input').props.autoFocus).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: 'Done' }));
    });
    expect(dismiss).toHaveBeenCalled();
  });
});
