/**
 * WHAT:  Tests for the TextField primitive — render of label/helper/error, the
 *        variant behaviours (plate uppercasing, email keyboard), disabled, and
 *        the onChangeText / onBlur callbacks.
 * WHY:   TextField backs every form in the app; broken labelling, a swallowed
 *        change event, or a plate that doesn't uppercase would silently degrade
 *        the whole posting/auth experience.
 * LINKS: src/shared/ui/TextField.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { TextField } from './TextField';

describe('TextField', () => {
  // 2026-10-08: both animations ran at mount, to the value they already held —
  // a JS-thread timing in the middle of every wizard slide.
  it('runs no animation when it mounts, only when focus or value changes', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    try {
      const view = await render(<TextField label="Name" value="Sam" onChangeText={jest.fn()} />);
      expect(timing).not.toHaveBeenCalled();

      await act(async () => {
        await fireEvent(view.getByLabelText('Name'), 'focus');
      });
      expect(timing).toHaveBeenCalledTimes(1); // the border tint; the label was already up
      await act(async () => view.unmount()); // stops the tint mid-flight
    } finally {
      timing.mockRestore();
    }
  });

  it('shows the floating label and helper, revealing the placeholder only on focus', async () => {
    const { getByText, getByTestId } = await render(
      <TextField
        testID="email-input"
        label="Email"
        placeholder="you@example.com"
        helperText="We'll never share it"
        value=""
        onChangeText={() => {}}
      />,
    );
    // The visual label is hidden from the a11y tree (the input's
    // accessibilityLabel carries the name), so include hidden elements here.
    expect(getByText('Email', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText("We'll never share it")).toBeTruthy();
    // The floating label doubles as the placeholder, so the format hint stays
    // hidden until the field is focused, then appears.
    expect(getByTestId('email-input').props.placeholder).toBeUndefined();
    await fireEvent(getByTestId('email-input'), 'focus');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250)); // the 200ms focus animation
    });
    await waitFor(() =>
      expect(getByTestId('email-input').props.placeholder).toBe('you@example.com'),
    );
  });

  it('shows the error message and hides the helper text when errored', async () => {
    const { getByText, queryByText } = await render(
      <TextField
        label="Email"
        helperText="hint"
        error="Enter a valid email"
        value=""
        onChangeText={() => {}}
      />,
    );
    expect(getByText('Enter a valid email')).toBeTruthy();
    expect(queryByText('hint')).toBeNull();
  });

  it('calls onChangeText as the user types', async () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <TextField placeholder="name" value="" onChangeText={onChangeText} />,
    );
    await fireEvent.changeText(getByPlaceholderText('name'), 'Jane');
    expect(onChangeText).toHaveBeenCalledWith('Jane');
  });

  it('drops NUL characters as they arrive — the database can’t store them', async () => {
    const NUL = String.fromCharCode(0);
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <TextField placeholder="name" value="" onChangeText={onChangeText} />,
    );
    await act(async () => {
      await fireEvent.changeText(getByPlaceholderText('name'), `Ja${NUL}ne${NUL}`);
    });
    expect(onChangeText).toHaveBeenLastCalledWith('Jane');
  });

  it('uppercases input for the plate variant', async () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <TextField variant="plate" placeholder="plate" value="" onChangeText={onChangeText} />,
    );
    await fireEvent.changeText(getByPlaceholderText('plate'), 'ab12cde');
    expect(onChangeText).toHaveBeenCalledWith('AB12CDE');
  });

  it('applies the email keyboard and disables autocapitalisation', async () => {
    const { getByPlaceholderText } = await render(
      <TextField variant="email" placeholder="email" value="" onChangeText={() => {}} />,
    );
    const input = getByPlaceholderText('email');
    expect(input.props.keyboardType).toBe('email-address');
    expect(input.props.autoCapitalize).toBe('none');
  });

  it('is not editable when disabled', async () => {
    const { getByPlaceholderText } = await render(
      <TextField placeholder="name" disabled value="" onChangeText={() => {}} />,
    );
    expect(getByPlaceholderText('name').props.editable).toBe(false);
  });

  it('fires onBlur when the field loses focus', async () => {
    const onBlur = jest.fn();
    const { getByPlaceholderText } = await render(
      <TextField placeholder="name" value="" onChangeText={() => {}} onBlur={onBlur} />,
    );
    await fireEvent(getByPlaceholderText('name'), 'blur');
    expect(onBlur).toHaveBeenCalled();
  });

  describe('labelPlacement="above" (owner, 2026-10-16: "labels all over the place")', () => {
    it('puts the label, then its hint, over the box — and never moves them', async () => {
      const timing = jest.spyOn(Animated, 'timing');
      try {
        const view = await render(
          <TextField
            testID="sort-code"
            labelPlacement="above"
            label="Sort code"
            helperText="6 digits"
            placeholder="12-34-56"
            value=""
            onChangeText={jest.fn()}
          />,
        );
        const tree = JSON.stringify(view.toJSON());
        expect(tree.indexOf('"Sort code"')).toBeLessThan(tree.indexOf('"6 digits"'));
        expect(tree.indexOf('"6 digits"')).toBeLessThan(tree.indexOf('"sort-code"'));
        // A real placeholder, shown before focus: the label isn't in the box.
        expect(view.getByTestId('sort-code').props.placeholder).toBe('12-34-56');

        await act(async () => {
          await fireEvent(view.getByTestId('sort-code'), 'focus');
        });
        await act(async () => {
          await fireEvent.changeText(view.getByTestId('sort-code'), '1');
        });
        // Only the border tint animates; no label float.
        expect(timing).toHaveBeenCalledTimes(1);
        await act(async () => view.unmount());
      } finally {
        timing.mockRestore();
      }
    });

    it('gives a screen reader the label as the name and the hint as the hint, once', async () => {
      const view = await render(
        <TextField
          testID="sort-code"
          labelPlacement="above"
          label="Sort code"
          helperText="6 digits"
          value=""
          onChangeText={jest.fn()}
        />,
      );
      const input = view.getByTestId('sort-code');
      expect(input.props.accessibilityLabel).toBe('Sort code');
      expect(input.props.accessibilityHint).toBe('6 digits');
      // The visible pair is hidden, so it isn't read twice.
      expect(view.queryByText('Sort code')).toBeNull();
      expect(view.getByText('Sort code', { includeHiddenElements: true })).toBeTruthy();
    });

    it('keeps the hint above and puts an error below the box', async () => {
      const view = await render(
        <TextField
          testID="sort-code"
          labelPlacement="above"
          label="Sort code"
          helperText="6 digits"
          error="A sort code is 6 digits"
          value="12"
          onChangeText={jest.fn()}
        />,
      );
      const tree = JSON.stringify(view.toJSON());
      expect(tree.indexOf('"6 digits"')).toBeLessThan(tree.indexOf('"sort-code"'));
      expect(tree.indexOf('"sort-code"')).toBeLessThan(tree.indexOf('"A sort code is 6 digits"'));
      expect(view.getByTestId('sort-code').props.accessibilityLabel).toBe(
        'Sort code, error: A sort code is 6 digits',
      );
    });
  });
});
