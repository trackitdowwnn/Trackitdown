/**
 * WHAT:  Tests for ConfirmDialog — hidden until opened, confirm fires the
 *        callback and closes, cancel/dismiss close WITHOUT confirming (and
 *        fire onDismiss), destructive renders the danger button.
 * WHY:   This guards sign-out and account deletion; a dialog that confirms
 *        on dismiss (or vice versa) turns a safety stop into a footgun.
 * LINKS: src/shared/ui/ConfirmDialog.tsx; src/shared/ui/BottomSheet.tsx;
 *        docs/TESTING.md. Sheet library mocked as in BottomSheet.test.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';

import { ConfirmDialog, type ConfirmDialogRef } from './ConfirmDialog';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => this.setState({ visible: true });
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const ReactNative = require('react-native');
  return {
    ...mock,
    BottomSheetModal: VisibilityAwareBottomSheetModal,
    BottomSheetScrollView: (props: object) => React.createElement(ReactNative.ScrollView, props),
  };
});

function setup(destructive = false) {
  const ref = createRef<ConfirmDialogRef>();
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();
  const view = render(
    <ConfirmDialog
      ref={ref}
      title="Sign out?"
      body="You can sign back in any time."
      confirmLabel="Sign out"
      destructive={destructive}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />,
  );
  return { ref, onConfirm, onDismiss, view };
}

describe('ConfirmDialog', () => {
  it('is hidden until opened, then shows title, body, and both actions', async () => {
    const { ref, view } = setup();
    const { queryByText, getByText } = await view;
    expect(queryByText('Sign out?')).toBeNull();
    await act(async () => {
      ref.current?.open();
    });
    expect(getByText('Sign out?')).toBeTruthy();
    expect(getByText('You can sign back in any time.')).toBeTruthy();
    expect(getByText('Sign out')).toBeTruthy();
    expect(getByText('Cancel')).toBeTruthy();
  });

  it('confirm fires onConfirm, closes, and does NOT fire onDismiss', async () => {
    const { ref, onConfirm, onDismiss, view } = setup();
    const { getByText, queryByText } = await view;
    await act(async () => {
      ref.current?.open();
    });
    await act(async () => {
      fireEvent.press(getByText('Sign out'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(queryByText('Sign out?')).toBeNull();
  });

  it('cancel closes without confirming and fires onDismiss', async () => {
    const { ref, onConfirm, onDismiss, view } = setup();
    const { getByText, queryByText } = await view;
    await act(async () => {
      ref.current?.open();
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(queryByText('Sign out?')).toBeNull();
  });

  it('acknowledge mode shows a single button and no cancel', async () => {
    const ref = createRef<ConfirmDialogRef>();
    const view = await render(
      <ConfirmDialog
        ref={ref}
        title="Can't delete just yet"
        body="A bounty is still held."
        confirmLabel="Got it"
        acknowledge
        onConfirm={() => {}}
      />,
    );
    await act(async () => {
      ref.current?.open();
    });
    expect(view.getByText('Got it')).toBeTruthy();
    expect(view.queryByText('Cancel')).toBeNull();
  });

  it('re-opening after a confirm treats the next dismissal freshly', async () => {
    const { ref, onConfirm, onDismiss, view } = setup();
    const { getByText } = await view;
    await act(async () => {
      ref.current?.open();
    });
    await act(async () => {
      fireEvent.press(getByText('Sign out'));
    });
    await act(async () => {
      ref.current?.open();
    });
    await act(async () => {
      fireEvent.press(getByText('Cancel'));
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
