/**
 * WHAT:  Tests for ListRow — render variants (value, subtitle, destructive),
 *        press wiring, disabled state, chevron-only-when-pressable, and the
 *        combined accessibility label.
 * WHY:   Every settings row in the app rides on this; a swallowed press or a
 *        missing value in the spoken label breaks hub screens everywhere.
 * LINKS: src/shared/ui/ListRow.tsx; docs/TESTING.md.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';

import { ListRow } from './ListRow';

// Lucide ships ESM Jest can't parse; the row only needs SOME component.
const StubIcon = (() => <View />) as never;

describe('ListRow', () => {
  it('renders title, value, and subtitle', async () => {
    const { getByText } = await render(
      <ListRow title="Payouts" value="Payouts ready" subtitle="Via Stripe" />,
    );
    expect(getByText('Payouts')).toBeTruthy();
    expect(getByText('Payouts ready')).toBeTruthy();
    expect(getByText('Via Stripe')).toBeTruthy();
  });

  it('fires onPress and exposes a button role', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ListRow title="Notifications" icon={StubIcon} onPress={onPress} testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalled();
    expect(getByTestId('row').props.accessibilityRole).toBe('button');
  });

  it('disabled rows are inert', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ListRow title="Alert radius" onPress={onPress} disabled testID="row" />,
    );
    fireEvent.press(getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('row').props.accessibilityState).toEqual({ disabled: true });
  });

  describe('as a chooser row', () => {
    it('announces itself as a radio, not a button', async () => {
      // The distinction matters: "button, selected" reads as a toggle that is
      // ON; "radio, selected" reads as this-one-of-several, which is what a
      // collection picker actually is.
      const { getByTestId } = await render(
        <ListRow title="My commute" selected onPress={() => {}} testID="row" />,
      );
      expect(getByTestId('row').props.accessibilityRole).toBe('radio');
      expect(getByTestId('row').props.accessibilityState).toEqual({
        disabled: false,
        selected: true,
      });
    });

    it('an unchosen row still announces its selection state', async () => {
      // `selected={false}` must reach the accessibility state, or a screen
      // reader hears a group where nothing is ever the answer.
      const { getByTestId } = await render(
        <ListRow title="Near work" selected={false} onPress={() => {}} testID="row" />,
      );
      expect(getByTestId('row').props.accessibilityRole).toBe('radio');
      expect(getByTestId('row').props.accessibilityState).toEqual({
        disabled: false,
        selected: false,
      });
    });

    it('leaves ordinary rows as buttons with no selection state', async () => {
      // Omitting the prop must not turn every settings row in the app into a
      // radio that claims to be unselected.
      const { getByTestId } = await render(
        <ListRow title="Notifications" onPress={() => {}} testID="row" />,
      );
      expect(getByTestId('row').props.accessibilityRole).toBe('button');
      expect(getByTestId('row').props.accessibilityState).toEqual({ disabled: false });
    });
  });

  it('speaks title, value, and subtitle together', async () => {
    const { getByTestId } = await render(
      <ListRow
        title="Payouts"
        value="Action needed"
        subtitle="Via Stripe"
        onPress={() => {}}
        testID="row"
      />,
    );
    expect(getByTestId('row').props.accessibilityLabel).toBe(
      'Payouts, Action needed, Via Stripe',
    );
  });
});

describe('⚠️ the value at large text', () => {
  /** Drive the text scale. Restored in afterEach — a leaked Dimensions spy
   *  pins fontScale for every later test in the file, which has bitten this
   *  codebase before. */
  const setFontScale = (fontScale: number) =>
    jest
      .spyOn(Dimensions, 'get')
      .mockReturnValue({ width: 390, height: 844, scale: 2, fontScale });

  afterEach(() => jest.restoreAllMocks());

  it('sits beside the title at normal text size', async () => {
    setFontScale(1);

    const { getByTestId } = await render(
      <ListRow title="Notifications" value="Not allowed" onPress={() => {}} testID="row" />,
    );

    // Beside: the value is a direct child of the ROW, not of the text block.
    const row = getByTestId('row');
    const rowChildTexts = row.children.filter(
      (child) => typeof child !== 'string' && child.type === 'Text',
    );
    expect(rowChildTexts).toHaveLength(1);
  });

  it('⚠️ moves UNDER the title at 200%, so the title is not the half that clips', async () => {
    // `flexShrink: 1` alone did not achieve this and a comment here once said
    // it did. Yoga reads the text block's `flex: 1` as basis 0, so it carries
    // no shrink weight: the value takes its intrinsic width first and the
    // title absorbs every bit of the squeeze. At this scale that rendered
    // "Not allowed" in full beside "Notific…".
    setFontScale(2);

    const { getByTestId } = await render(
      <ListRow title="Notifications" value="Not allowed" onPress={() => {}} testID="row" />,
    );

    const row = getByTestId('row');
    const rowChildTexts = row.children.filter(
      (child) => typeof child !== 'string' && child.type === 'Text',
    );
    // No value beside the title any more — it has moved inside the text block.
    expect(rowChildTexts).toHaveLength(0);
  });

  it('says the same thing to a screen reader either way', async () => {
    // The label joins title, value and subtitle, so the layout switch must be
    // invisible to assistive tech.
    setFontScale(2);
    const { getByTestId } = await render(
      <ListRow title="Notifications" value="Not allowed" onPress={() => {}} testID="row" />,
    );

    expect(getByTestId('row').props.accessibilityLabel).toBe('Notifications, Not allowed');
  });
});
