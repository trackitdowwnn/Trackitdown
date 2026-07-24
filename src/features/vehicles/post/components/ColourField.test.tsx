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
 *        src/features/vehicles/post/lib/carColours.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ColourField } from './ColourField';
import { CAR_COLOURS, colourFromDvla } from '../lib/carColours';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// BottomSheet is gorhom-based; reuse the visibility-aware boundary mock the
// BottomSheet/DateTimeField suites established so open()/close() gate children.
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

  it('borders light swatches so they stay visible, and leaves dark ones plain', async () => {
    const { getByTestId } = await renderField();

    const white = StyleSheet.flatten(getByTestId('colour-swatch-White').props.style);
    const black = StyleSheet.flatten(getByTestId('colour-swatch-Black').props.style);

    expect(white.borderWidth).toBe(1);
    expect(black.borderWidth).toBeUndefined();
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
