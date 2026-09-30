/**
 * WHAT:  Tests for ReportSafetySheet — the safety moment before a report:
 *          - it shows the notice's title and all three points, and says them
 *            to a screen reader when it opens;
 *          - "I'm at a safe distance" starts the report only once the sheet
 *            has FINISHED closing, and leaves the in-memory proof for that post;
 *          - closing it any other way never starts the report;
 *          - one open, one answer: a double tap, a second open and a stray
 *            second close all do nothing, and a close after unmount navigates
 *            nowhere;
 *          - "Call 999" dials and stays open, and says so if the device can't;
 *          - each outcome is logged once.
 * WHY:   This sheet is the only thing between "I've seen this car" and the
 *        camera (SECURITY_AND_TRUST §1). A dismissal that started the report
 *        would make the notice skippable by a swipe; a stray close read as a
 *        cancel would throw someone out of a report they'd begun; a silent
 *        999 button fails at the worst moment. The mock's close can be HELD,
 *        so "after it has closed" is proven rather than assumed (the first
 *        version's mock closed synchronously and would have passed either way).
 * LINKS: src/features/sightings/components/ReportSafetySheet.tsx;
 *        src/features/sightings/lib/safetyAck.ts; src/shared/ui/SafetyNotice.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { AccessibilityInfo, Linking } from 'react-native';

import {
  SAFETY_999_LINE,
  SAFETY_DISTANCE_LINE,
  SAFETY_NOTICE_TITLE,
  SAFETY_POINTS_LABEL,
  SAFETY_RULE_LINE,
  ToastProvider,
} from '@/shared/ui';

import { hasFreshSafetyAck, resetSafetyAck } from '../lib/safetyAck';
import { ReportSafetySheet, SAFETY_CONTINUE_LABEL, type ReportSafetySheetRef } from './ReportSafetySheet';

// A visibility-aware gorhom boundary whose close can be HELD: with
// `mockHoldClose.on`, dismiss() hides nothing until finishClose() runs, the
// way the real 250ms slide-down does. The mock draws no scrim, so the open
// modal is kept too: its dismiss() is what a swipe, a scrim tap and Back all
// end in.
const mockModal: {
  current: { dismiss: () => void; finishClose: () => void } | null;
} = { current: null };
const mockHoldClose = { on: false };
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => {
      mockModal.current = this;
      this.setState({ visible: true });
    };
    finishClose = () => {
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    dismiss = () => {
      if (!this.state.visible) return;
      if (!mockHoldClose.on) this.finishClose();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

/** The `safety_sheet` actions logged so far, in order. */
const loggedActions = () =>
  mockLogInfo.mock.calls
    .filter(([event]) => event === 'safety_sheet')
    .map(([, fields]) => (fields as { action: string }).action);

/** A swipe down, a scrim tap or Back: all end in the modal's own dismiss. */
const dismissBySwipe = () =>
  act(async () => {
    mockModal.current?.dismiss();
  });

async function openSheet(onCancel = jest.fn()) {
  const ref = createRef<ReportSafetySheetRef>();
  const onContinue = jest.fn();
  const view = await render(
    <ToastProvider>
      <ReportSafetySheet ref={ref} source="detail" onCancel={onCancel} />
    </ToastProvider>,
  );
  await act(async () => {
    ref.current?.open({ postId: 'p1', onContinue });
  });
  return { view, ref, onContinue, onCancel };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHoldClose.on = false;
  resetSafetyAck();
});

describe('ReportSafetySheet', () => {
  it('shows the notice title and all three points, and speaks them on open', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { view } = await openSheet();

    expect(view.getByRole('header', { name: SAFETY_NOTICE_TITLE })).toBeTruthy();
    for (const line of [SAFETY_RULE_LINE, SAFETY_DISTANCE_LINE, SAFETY_999_LINE]) {
      expect(view.getByText(line)).toBeTruthy();
    }
    expect(view.getByRole('alert')).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(`${SAFETY_NOTICE_TITLE}. ${SAFETY_POINTS_LABEL}`);
    expect(loggedActions()).toEqual(['shown']);
    announce.mockRestore();
  });

  it('starts the report only once the sheet has finished closing', async () => {
    mockHoldClose.on = true;
    const { view, onContinue, onCancel } = await openSheet();

    await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));
    // Still sliding down: nothing has been pushed under it yet.
    expect(onContinue).not.toHaveBeenCalled();
    expect(hasFreshSafetyAck('p1')).toBe(false);

    await act(async () => mockModal.current?.finishClose());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(hasFreshSafetyAck('p1')).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(loggedActions()).toEqual(['shown', 'continued']);
  });

  it('never starts the report, or leaves the proof, when closed any other way', async () => {
    const { onContinue, onCancel } = await openSheet();

    await dismissBySwipe();

    expect(onContinue).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(hasFreshSafetyAck('p1')).toBe(false);
    expect(loggedActions()).toEqual(['shown', 'dismissed']);
  });

  it('answers once: a double tap, a second open and a stray second close do nothing', async () => {
    mockHoldClose.on = true;
    const { view, ref, onContinue, onCancel } = await openSheet();
    const other = jest.fn();

    await act(async () => ref.current?.open({ postId: 'p2', onContinue: other }));
    await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));
    await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));
    await act(async () => mockModal.current?.finishClose());
    await act(async () => mockModal.current?.finishClose());

    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(loggedActions()).toEqual(['shown', 'continued']);
  });

  it('navigates nowhere when it closes after its screen has gone', async () => {
    mockHoldClose.on = true;
    const { view, onContinue, onCancel } = await openSheet();
    const modal = mockModal.current;

    await view.unmount();
    await act(async () => modal?.finishClose());

    expect(onContinue).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('dials 999 and stays open', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    const { view, onContinue } = await openSheet();

    await fireEvent.press(view.getByRole('button', { name: 'Call 9 9 9, emergency' }));

    expect(openURL).toHaveBeenCalledWith('tel:999');
    expect(onContinue).not.toHaveBeenCalled();
    expect(view.getByTestId('report-safety-sheet')).toBeTruthy();
    expect(loggedActions()).toEqual(['shown', 'call_999']);
    openURL.mockRestore();
  });

  it('says so when the device can’t make calls, rather than doing nothing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no telephony'));
    const { view } = await openSheet();

    await fireEvent.press(view.getByRole('button', { name: 'Call 9 9 9, emergency' }));
    await act(async () => {});

    expect(view.getByText('This device can’t make calls. Call 999 from a phone.')).toBeTruthy();
    expect(mockLogWarn).toHaveBeenCalledWith('call_999_failed', { source: 'detail' });
    openURL.mockRestore();
  });

  it('lets a stuck open be replaced after a few seconds, but never a confirmed one', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(1_000);
      mockHoldClose.on = true;
      const { view, ref, onContinue } = await openSheet();

      // A present that never reported back: 4s later a new tap takes over.
      const replacement = jest.fn();
      nowSpy.mockReturnValue(5_000);
      await act(async () => ref.current?.open({ postId: 'p2', onContinue: replacement }));
      await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));

      // Confirmed and closing: a later tap must not read that close as a cancel.
      nowSpy.mockReturnValue(20_000);
      await act(async () => ref.current?.open({ postId: 'p3', onContinue: jest.fn() }));
      await act(async () => mockModal.current?.finishClose());

      expect(onContinue).not.toHaveBeenCalled();
      expect(replacement).toHaveBeenCalledTimes(1);
      expect(hasFreshSafetyAck('p2', 20_001)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('forgets a cancelled report: confirming the next one starts only that', async () => {
    const { view, ref, onContinue } = await openSheet();
    const second = jest.fn();

    await dismissBySwipe();
    await act(async () => ref.current?.open({ postId: 'p2', onContinue: second }));
    await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(hasFreshSafetyAck('p2')).toBe(true);
  });
});
