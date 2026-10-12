/**
 * WHAT:  Tests for PaintFinishSheet — the four finishes and "Not sure" (null),
 *        one tap answers and closes it, a swipe is not an answer, a double
 *        open presents once, a second tap while it closes is ignored, and only
 *        a stored finish is ticked.
 * WHY:   The colour step moves on when this sheet reports a pick (owner
 *        request, 2026-10-12), so "picked" vs "swiped away" decides whether
 *        the wizard moves — a wrong answer there skips a step or strands one.
 * LINKS: ./PaintFinishSheet.tsx; ./postSteps.tsx (ColourStep).
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { PaintFinishSheet, type PaintFinishSheetRef } from './PaintFinishSheet';

jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);

// Counts presents, so a double open can be caught presenting twice.
let mockPresents = 0;
// The ColourField suite's visibility-aware modal: open()/close() gate children
// and a dismiss fires onDismiss, as the real one does once it has closed.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present() {
      mockPresents += 1;
      this.setState({ visible: true });
    }
    dismiss() {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    }
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

function setup(value: React.ComponentProps<typeof PaintFinishSheet>['value'] = null) {
  const ref = React.createRef<PaintFinishSheetRef>();
  const onPick = jest.fn();
  const onClosed = jest.fn();
  const view = render(
    <PaintFinishSheet ref={ref} value={value} onPick={onPick} onClosed={onClosed} />,
  );
  return { ref, onPick, onClosed, view };
}

beforeEach(() => {
  mockPresents = 0;
});

describe('PaintFinishSheet', () => {
  it('offers the four finishes, each saying what it looks like, then "Not sure"', async () => {
    const { ref, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());

    expect(screen.getByText('What’s the paint finish?')).toBeTruthy();
    for (const label of ['Metallic', 'Matt', 'Pearl', 'Two-tone roof', 'Not sure']) {
      expect(screen.getByRole('radio', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    expect(screen.getByText('Sparkles in sunlight')).toBeTruthy();
  });

  it('asks about THIS colour, in a sentence', async () => {
    const ref = React.createRef<PaintFinishSheetRef>();
    const screen = await render(
      <PaintFinishSheet ref={ref} colour="Blue" value={null} onPick={jest.fn()} />,
    );
    await act(async () => ref.current?.open());
    expect(screen.getByText('What’s the finish on the blue?')).toBeTruthy();
    expect(screen.getByLabelText('What’s the finish on the blue?').props.accessibilityRole).toBe(
      'radiogroup',
    );
  });

  it('⚠️ speaks each line as part of its name — a hint goes unheard with hints off', async () => {
    const { ref, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());

    const metallic = screen.getByRole('radio', { name: 'Metallic, Sparkles in sunlight' });
    expect(metallic.props.accessibilityHint).toBeUndefined();
    expect(screen.getByRole('radio', { name: 'Not sure' })).toBeTruthy();
  });

  it('one tap answers and closes it — and says it was a pick', async () => {
    const { ref, onPick, onClosed, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());

    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: /^Pearl/ }));
    });

    expect(onPick).toHaveBeenCalledWith('pearl');
    expect(onClosed).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('radio', { name: /^Pearl/ })).toBeNull();
  });

  it('"Not sure" is an answer too — it stores nothing', async () => {
    const { ref, onPick, onClosed, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());

    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: /^Not sure/ }));
    });

    expect(onPick).toHaveBeenCalledWith(null);
    expect(onClosed).toHaveBeenCalledWith(true);
  });

  it('⚠️ closed without a tap is NOT an answer', async () => {
    const { ref, onPick, onClosed, view } = setup();
    await view;
    await act(async () => ref.current?.open());

    // A swipe, the scrim or Back — all end in the modal's dismiss.
    await act(async () => ref.current?.close());

    expect(onPick).not.toHaveBeenCalled();
    expect(onClosed).toHaveBeenCalledWith(false);
  });

  it('a double-tapped Next presents it once', async () => {
    const { ref, view } = setup();
    await view;
    await act(async () => {
      ref.current?.open();
      ref.current?.open();
    });

    expect(mockPresents).toBe(1);
  });

  it('⚠️ never wedges: a later Next tries again even if no dismiss ever came', async () => {
    // gorhom can skip a present silently — then no onDismiss ever fires. A
    // latch cleared only by onDismiss would swallow every Next after it.
    const now = jest.spyOn(performance, 'now');
    const { ref, view } = setup();
    await view;
    now.mockReturnValue(1000);
    await act(async () => ref.current?.open());
    now.mockReturnValue(2000); // a deliberate Next, well after a double-tap
    await act(async () => ref.current?.open());

    expect(mockPresents).toBe(2);
    now.mockRestore();
  });

  it('a second tap while it closes is ignored', async () => {
    const { ref, onPick, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());
    const metallic = screen.getByRole('radio', { name: /^Metallic/ });
    const matt = screen.getByRole('radio', { name: /^Matt/ });

    await act(async () => {
      fireEvent.press(metallic);
      fireEvent.press(matt);
    });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('metallic');
  });

  it('reopens fresh after a pick — the next tap counts', async () => {
    const { ref, onPick, view } = setup();
    const screen = await view;
    await act(async () => ref.current?.open());
    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: /^Metallic/ }));
    });
    await act(async () => ref.current?.open());
    await act(async () => {
      fireEvent.press(screen.getByRole('radio', { name: /^Matt/ }));
    });

    expect(onPick).toHaveBeenLastCalledWith('matte');
  });

  it('ticks only a stored finish — never "Not sure"', async () => {
    const stored = setup('pearl');
    const withPearl = await stored.view;
    await act(async () => stored.ref.current?.open());
    expect(withPearl.getByRole('radio', { name: /^Pearl/ }).props.accessibilityState).toMatchObject(
      {
        checked: true,
      },
    );
    expect(
      withPearl.getByRole('radio', { name: /^Metallic/ }).props.accessibilityState,
    ).toMatchObject({
      checked: false,
    });
    await withPearl.unmount();

    // null can't tell "chose Not sure" from "never asked", so nothing is ticked.
    const none = setup(null);
    const withNone = await none.view;
    await act(async () => none.ref.current?.open());
    expect(
      withNone.getByRole('radio', { name: /^Not sure/ }).props.accessibilityState,
    ).toMatchObject({
      checked: false,
    });
  });
});
