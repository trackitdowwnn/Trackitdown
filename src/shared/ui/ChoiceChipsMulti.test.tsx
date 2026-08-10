/**
 * WHAT:  Tests for ChoiceChipsMulti — add/remove toggling returns the full next
 *        selection, checked-state semantics per chip, the optional `max` cap
 *        disabling unselected chips while still allowing deselection, and the
 *        presentation options (colour swatch, horizontal scrolling, bleed).
 * WHY:   These chips carry the post-a-car features answer and the search
 *        sheet's colour/body-type filters; a chip that toggles the wrong way or
 *        misreports its checked/disabled state to a screen reader corrupts what
 *        the user thinks they've picked. The swatch tests exist because a
 *        colour picker is the easiest place to accidentally encode meaning by
 *        colour ALONE — the name must survive every future tidy-up.
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

describe('ChoiceChipsMulti presentation', () => {
  const COLOURS = [
    { value: 'Black', label: 'Black', swatch: '#1A1A1A' },
    { value: 'White', label: 'White', swatch: '#F4F5F7' },
  ];

  it('keeps the NAME when a swatch is shown — colour is never the sole signal', async () => {
    const { getByLabelText, getByText } = await render(
      <ChoiceChipsMulti options={COLOURS} value={[]} onChange={jest.fn()} />,
    );

    // ~4.5% of users have a colour-vision deficiency (DESIGN_SYSTEM), so a
    // swatch may only ever DECORATE the name, never replace it. A future
    // "cleaner" swatch-only redesign has to fail here.
    expect(getByText('Black')).toBeTruthy();
    expect(getByText('White')).toBeTruthy();
    expect(getByLabelText('Black')).toBeTruthy();
  });

  it('hides the swatch itself from assistive tech (the label carries it)', async () => {
    const view = await render(
      <ChoiceChipsMulti options={COLOURS} value={['Black']} onChange={jest.fn()} />,
    );
    expect(view.getByLabelText('Black').props.accessibilityState).toMatchObject({
      checked: true,
    });

    // Assert the DOT's OWN prop. Two weaker versions of this test both passed
    // against a swatch with the prop removed: one asserted only the chip's
    // checked state, the next searched the whole tree for any hidden node and
    // matched the sibling Feather icons instead.
    const swatches = view.getAllByTestId('choice-chip-swatch');
    expect(swatches).toHaveLength(COLOURS.length);
    swatches.forEach((swatch) => {
      expect(swatch.props.importantForAccessibility).toBe('no');
    });
  });

  it('scrolls horizontally rather than wrapping when asked', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ChoiceChipsMulti
        options={COLOURS}
        value={[]}
        onChange={jest.fn()}
        scrollable
        testID="chips"
      />,
    );
    expect(getByTestId('chips-scroller')).toBeTruthy();

    const wrapped = await render(
      <ChoiceChipsMulti options={COLOURS} value={[]} onChange={jest.fn()} testID="plain" />,
    );
    // No scroller unless asked: wrapping stays the default for short groups.
    // Queried on the SECOND render — `queryByTestId` from the first would be
    // vacuously null whatever the component did.
    expect(wrapped.queryByTestId('plain-scroller')).toBeNull();
    expect(queryByTestId('chips-scroller')).toBeTruthy();
  });

  it('negates the container padding when given a bleed', async () => {
    const { getByTestId } = await render(
      <ChoiceChipsMulti
        options={COLOURS}
        value={[]}
        onChange={jest.fn()}
        scrollable
        bleed={16}
        testID="chips"
      />,
    );

    // Without this the card's padding and the scroller's own gutter STACK, and
    // the row sits visibly indented from the label above it.
    const scroller = getByTestId('chips-scroller');
    expect(scroller.props.style).toMatchObject({ marginHorizontal: -16 });
    expect(scroller.props.contentContainerStyle).toMatchObject({ paddingHorizontal: 16 });
  });
});
