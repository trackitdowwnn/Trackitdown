/**
 * WHAT:  Tests for ChoiceChipsMulti — add/remove toggling returns the full next
 *        selection, checked-state semantics per chip, and the optional `max`
 *        cap disabling unselected chips while still allowing deselection.
 * WHY:   These chips carry the post-a-car features answer; a chip that toggles
 *        the wrong way or misreports its checked/disabled state to a screen
 *        reader corrupts what the owner thinks they've picked.
 * LINKS: src/shared/ui/ChoiceChipsMulti.tsx, docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';

import { ChoiceChipsMulti } from './ChoiceChipsMulti';

const OPTIONS = [
  { value: 'roof_rack', label: 'Roof rack' },
  { value: 'tow_bar', label: 'Tow bar' },
  { value: 'dashcam', label: 'Dashcam' },
];

describe('ChoiceChipsMulti', () => {
  it('adds a value to the selection when an unselected chip is tapped', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <ChoiceChipsMulti options={OPTIONS} value={['roof_rack']} onChange={onChange} />,
    );

    fireEvent.press(getByLabelText('Tow bar'));

    expect(onChange).toHaveBeenCalledWith(['roof_rack', 'tow_bar']);
  });

  it('removes a value when a selected chip is tapped', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <ChoiceChipsMulti options={OPTIONS} value={['roof_rack', 'tow_bar']} onChange={onChange} />,
    );

    fireEvent.press(getByLabelText('Roof rack'));

    expect(onChange).toHaveBeenCalledWith(['tow_bar']);
  });

  it('reports each chip’s checked state to assistive tech', async () => {
    const { getByLabelText } = await render(
      <ChoiceChipsMulti options={OPTIONS} value={['dashcam']} onChange={() => {}} />,
    );

    expect(getByLabelText('Dashcam').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Roof rack').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('disables unselected chips at the cap but still allows deselection', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <ChoiceChipsMulti
        options={OPTIONS}
        value={['roof_rack', 'tow_bar']}
        onChange={onChange}
        max={2}
      />,
    );

    const unselected = getByLabelText('Dashcam');
    expect(unselected.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(unselected);
    expect(onChange).not.toHaveBeenCalled();

    // A selected chip is never blocked — you can always drop back under the cap.
    fireEvent.press(getByLabelText('Roof rack'));
    expect(onChange).toHaveBeenCalledWith(['tow_bar']);
  });
});
