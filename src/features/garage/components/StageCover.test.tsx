/**
 * WHAT:  Tests for StageCover — the in-place stage dissolve: the new stage is
 *        current at once, the old one leaves on top (hidden from screen
 *        readers, taking no touches), and a stage that comes back mid-fade is
 *        restored fully visible.
 * WHY:   The report flow's stages (pending, chooser, error, form) all change
 *        through this. A review of #141 found the third case broken: error →
 *        retry → error inside the fade left the error page at opacity 0 with
 *        live, invisible buttons — a blank screen exactly when offline.
 * LINKS: src/features/garage/components/StageCover.tsx; docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StageCover } from './StageCover';

// A Reanimated double whose fades do NOT finish on their own: the shared mock
// completes every withTiming instantly, so "mid-fade" — the state the bug
// lived in — could never exist in a test. Here a fade jumps to its target
// value and its completion waits until finishFades() (mutation-checked).
const mockPendingDone: ((finished: boolean) => void)[] = [];
jest.mock('react-native-reanimated', () => {
  const base = jest.requireActual('react-native-reanimated');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useRef } = require('react');
  return {
    ...base,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    useAnimatedStyle: (fn: () => object) => fn(),
    withTiming: (to: number, _config: unknown, done?: (finished: boolean) => void) => {
      if (done) mockPendingDone.push(done);
      return to;
    },
    cancelAnimation: () => {},
  };
});

async function finishFades() {
  await act(async () => {
    mockPendingDone.splice(0).forEach((done) => done(true));
  });
}

const HIDDEN = { includeHiddenElements: true };

function view(stage: string) {
  return (
    <StageCover stageKey={stage}>
      <Text>{`stage ${stage}`}</Text>
    </StageCover>
  );
}

describe('StageCover', () => {
  it('shows the new stage at once, with the old one leaving on top — untouchable, unread', async () => {
    const screen = await render(view('a'));
    await act(async () => {
      screen.rerender(view('b'));
    });

    expect(screen.getByTestId('stage-current')).toHaveTextContent('stage b');
    // Still mid-fade (the double never finishes on its own): it must be inert.
    const leaving = screen.getByTestId('stage-leaving', HIDDEN);
    expect(leaving).toHaveTextContent('stage a');
    expect(leaving.props.pointerEvents).toBe('none');
    expect(leaving.props.accessibilityElementsHidden).toBe(true);
    // Screen readers find only the current stage.
    expect(screen.queryByText('stage a')).toBeNull();
  });

  it('⚠️ a stage that comes back mid-fade is fully visible and touchable again', async () => {
    const screen = await render(view('error'));
    await act(async () => {
      screen.rerender(view('pending'));
    });
    await act(async () => {
      screen.rerender(view('error'));
    });
    // One more render, as any parent update would cause: the style is read
    // from the opacity the layer is left with.
    await act(async () => {
      screen.rerender(view('error'));
    });
    await finishFades();

    const current = screen.getByTestId('stage-current');
    expect(current).toHaveTextContent('stage error');
    expect(current.props.pointerEvents).toBe('auto');
    expect(current).toHaveStyle({ opacity: 1 });
    expect(screen.getByText('stage error')).toBeTruthy();
  });

  it('the leaving layer is removed once its fade ends', async () => {
    const screen = await render(view('a'));
    await act(async () => {
      screen.rerender(view('b'));
    });
    expect(screen.getByTestId('stage-leaving', HIDDEN)).toBeTruthy();
    await finishFades();
    expect(screen.queryByTestId('stage-leaving', HIDDEN)).toBeNull();
  });

  it('the leaving stage fades with its latest content, not its first', async () => {
    const first = (label: string) => (
      <StageCover stageKey="list">
        <Text>{label}</Text>
      </StageCover>
    );
    const screen = await render(first('two cars'));
    await act(async () => {
      screen.rerender(first('one car'));
    });
    await act(async () => {
      screen.rerender(
        <StageCover stageKey="form">
          <Text>form</Text>
        </StageCover>,
      );
    });

    expect(screen.getByTestId('stage-leaving', HIDDEN)).toHaveTextContent('one car');
    expect(screen.getByTestId('stage-current')).toHaveTextContent('form');
  });
});
