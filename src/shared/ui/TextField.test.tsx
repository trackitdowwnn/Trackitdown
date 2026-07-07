/**
 * WHAT:  Tests for the TextField primitive — render of label/helper/error, the
 *        variant behaviours (plate uppercasing, email keyboard), disabled, and
 *        the onChangeText / onBlur callbacks.
 * WHY:   TextField backs every form in the app; broken labelling, a swallowed
 *        change event, or a plate that doesn't uppercase would silently degrade
 *        the whole posting/auth experience.
 * LINKS: src/shared/ui/TextField.tsx, docs/TESTING.md.
 */

import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { TextField } from './TextField';

describe('TextField', () => {
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
    fireEvent(getByTestId('email-input'), 'focus');
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
    fireEvent.changeText(getByPlaceholderText('name'), 'Jane');
    expect(onChangeText).toHaveBeenCalledWith('Jane');
  });

  it('uppercases input for the plate variant', async () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = await render(
      <TextField variant="plate" placeholder="plate" value="" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByPlaceholderText('plate'), 'ab12cde');
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
    fireEvent(getByPlaceholderText('name'), 'blur');
    expect(onBlur).toHaveBeenCalled();
  });
});
