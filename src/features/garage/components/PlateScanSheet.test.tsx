/**
 * WHAT:  Tests for the scan confirmation sheet.
 * WHY:   This sheet is the ONLY check on an OCR read. There is no DVLA lookup
 *        in this app, so if a wrong plate can reach the field without the owner
 *        agreeing to it, nothing downstream will catch it. The tests therefore
 *        care about one thing above all: a plate is written ONLY on an explicit
 *        confirmation.
 * LINKS: ./PlateScanSheet.tsx; src/shared/lib/plateCandidates.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PlateCandidate } from '@/shared/lib/plateCandidates';
import { PlateScanSheet } from './PlateScanSheet';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// Render sheet content inline — the real modal is portalled and never mounts
// its children in a test renderer.
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  class AlwaysOpenModal extends React.Component {
    present = () => {};
    dismiss = () => {};
    render() {
      return this.props.children;
    }
  }
  return {
    ...mock,
    BottomSheetModal: AlwaysOpenModal,
    BottomSheetScrollView: (props: object) =>
      React.createElement(ReactNative.ScrollView, props),
  };
});

const candidate = (canon: string, display: string): PlateCandidate => ({
  canon,
  display,
  format: 'current',
  coercions: 0,
});

const ONE = [candidate('AB12CDE', 'AB12 CDE')];
const THREE = [
  candidate('AB12CDE', 'AB12 CDE'),
  candidate('XY34ZZZ', 'XY34 ZZZ'),
  candidate('LM56NOP', 'LM56 NOP'),
];

describe('with candidates', () => {
  it('shows the read plate and confirms it', async () => {
    const onConfirm = jest.fn();
    const { getByText } = await act(async () =>
      render(<PlateScanSheet candidates={ONE} onConfirm={onConfirm} />),
    );

    expect(getByText('AB12 CDE')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Yes, that's it"));
    });
    // Canonical, not the display form — the caller decides how to store it.
    expect(onConfirm).toHaveBeenCalledWith('AB12CDE');
  });

  it('offers up to three and confirms the one chosen', async () => {
    const onConfirm = jest.fn();
    const { getByText, getByTestId } = await act(async () =>
      render(<PlateScanSheet candidates={THREE} onConfirm={onConfirm} />),
    );

    await act(async () => {
      fireEvent.press(getByTestId('plate-candidate-XY34ZZZ'));
    });
    await act(async () => {
      fireEvent.press(getByText("Yes, that's it"));
    });
    expect(onConfirm).toHaveBeenCalledWith('XY34ZZZ');
  });

  it('defaults to the highest-ranked candidate', async () => {
    const onConfirm = jest.fn();
    const { getByText } = await act(async () =>
      render(<PlateScanSheet candidates={THREE} onConfirm={onConfirm} />),
    );
    // Confirm without choosing — the best guess should already be selected, so
    // the common case is one tap.
    await act(async () => {
      fireEvent.press(getByText("Yes, that's it"));
    });
    expect(onConfirm).toHaveBeenCalledWith('AB12CDE');
  });

  it('never confirms when the user chooses to type instead', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await act(async () =>
      render(
        <PlateScanSheet candidates={ONE} onConfirm={onConfirm} onDismiss={onDismiss} />,
      ),
    );

    await act(async () => {
      fireEvent.press(getByText("No, I'll type it"));
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// The photos-step path: the owner already typed something and the recogniser
// read something else. That is a DISAGREEMENT, not a discovery, and the sheet
// must not quietly imply the machine wins — a plate is easy to misread from a
// photo, and they were looking at the actual car.
describe('when it disagrees with a typed plate', () => {
  it('asks which is right, and names keeping theirs', async () => {
    const { getByText } = await act(async () =>
      render(
        <PlateScanSheet candidates={ONE} existingPlate="XY34 ZZZ" onConfirm={jest.fn()} />,
      ),
    );

    expect(getByText('Which one is right?')).toBeTruthy();
    // An explicit named option, never a bare "No" that reads as conceding.
    expect(getByText('Keep XY34 ZZZ')).toBeTruthy();
  });

  it('keeping their plate confirms nothing', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await act(async () =>
      render(
        <PlateScanSheet
          candidates={ONE}
          existingPlate="XY34 ZZZ"
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />,
      ),
    );

    await act(async () => {
      fireEvent.press(getByText('Keep XY34 ZZZ'));
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled(); // their typed plate is untouched
  });

  it('asks the DISCOVERY question instead when the field was empty', async () => {
    const { getByText } = await act(async () =>
      render(<PlateScanSheet candidates={ONE} onConfirm={jest.fn()} />),
    );
    expect(getByText('Is this your registration?')).toBeTruthy();
  });
});

describe('when permission was refused', () => {
  it('explains it here rather than needing a toast provider', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = await act(async () =>
      render(
        <PlateScanSheet
          candidates={[]}
          blocked
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />,
      ),
    );

    expect(getByText('Photo access is off')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Type it instead'));
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never shows candidates, even if some were left over from a previous scan', async () => {
    const { queryByText, getByText } = await act(async () =>
      render(<PlateScanSheet candidates={ONE} blocked onConfirm={jest.fn()} />),
    );
    expect(getByText('Photo access is off')).toBeTruthy();
    expect(queryByText('AB12 CDE')).toBeNull();
  });
});

describe('when nothing was read', () => {
  it('is kind about it and offers typing, never a dead end', async () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    const { getByText, queryByText } = await act(async () =>
      render(
        <PlateScanSheet candidates={[]} onConfirm={onConfirm} onDismiss={onDismiss} />,
      ),
    );

    expect(getByText("Couldn't read it")).toBeTruthy();
    // House voice: no error codes, no blame, a way forward.
    expect(queryByText(/failed/i)).toBeNull();
    expect(queryByText(/error/i)).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('Type it instead'));
    });
    expect(onDismiss).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
