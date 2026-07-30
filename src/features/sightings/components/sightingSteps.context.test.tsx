/**
 * WHAT:  Tests for the rebuilt ContextStep — the prominent Skip row (onSkip),
 *        the "What's it doing?" CardSelect single-select, the follow-up
 *        BottomSheet (tapping Parked/Driving opens the likelihood chips /
 *        CompassPicker in a sheet; picking answers AND dismisses; swiping
 *        away answers nothing) with its summary/edit row under the cards,
 *        the "Add more detail" expander (collapsed on a fresh report,
 *        auto-open when detail already exists) that gates the condition
 *        chips, the "Could you see…?" confirmable-mark checkmarks, the 3-way
 *        people question with its fixed inline safety line, and the note —
 *        plus CompassPicker's own select/clear semantics.
 * WHY:   The context step encodes DOMAIN facts in ONE shared array
 *        (contextFlags): a wiring slip either double-stores mutually exclusive
 *        states, strands a stale follow-up under the wrong state ("Parked ·
 *        likely to stay" lingering under "Driving" misleads the owner), or
 *        drops the condition chips when a state is toggled. The sheet is a
 *        SPEED device — but a swiped-away sheet must never fabricate an
 *        answer, and the row must honestly show what was (not) said. The
 *        expander must never HIDE existing detail (auto-open), and the safety
 *        line is a SECURITY_AND_TRUST register that must appear exactly when
 *        people are present, behind that door.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (ContextStep);
 *        src/features/sightings/components/CompassPicker.tsx;
 *        src/shared/ui/BottomSheet.tsx (open/close ref contract);
 *        src/shared/ui/CardSelect.tsx (radio-card semantics);
 *        src/features/sightings/types.ts (flag vocabularies); docs/TESTING.md.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useState } from 'react';

import { DRIVING_DIRECTIONS, type ReportSightingAnswers } from '../types';
import { CompassPicker } from './CompassPicker';
import { ContextStep } from './sightingSteps';

// Load-boundary mocks: importing sightingSteps pulls the WHOLE step module in
// (camera, map, image pipeline) even though ContextStep renders none of it —
// same mock set as sightingSteps.test.tsx plus the sheet the follow-ups live
// in. The global reanimated mock (moduleNameMapper) covers FadeIn.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  requestForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ granted: true, canAskAgain: true }),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  watchPositionAsync: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));
jest.mock('react-native-gesture-handler', () => {
  const chain = () => {
    const gesture: Record<string, unknown> = {};
    for (const method of [
      'enabled',
      'activateAfterLongPress',
      'onStart',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ]) {
      gesture[method] = () => gesture;
    }
    return gesture;
  };
  return {
    Gesture: { Pan: chain },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);
// The follow-up sheet's boundary — the house visibility-aware modal mock
// (same as PhotoGridPicker.test.tsx): present()/dismiss() toggle children.
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
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

/** The fixed inline safety register — pinned word-for-word (SAFETY copy). */
const SAFETY_LINE = 'Don’t approach — your report is enough.';

/** The CardSelect radio cards read "label. description" to a screen reader —
 *  the step's tap targets, pinned with their one-line subtexts. */
const PARKED_CARD = 'Parked. Sitting unattended';
const DRIVING_CARD = 'Driving. On the move right now';
const LOADED_CARD = 'Being loaded or towed. On or going onto another vehicle';

const MARKS = [
  { id: 'm1', description: 'Cracked nearside wing mirror' },
  { id: 'm2', description: 'Bee sticker on the boot' },
];

/** The answers bag after the last user interaction — what the wizard would
 *  submit. Written by the harness's setAnswers wrapper (every assertion on it
 *  follows a press), never during render (react-hooks/globals). */
let latest: Partial<ReportSightingAnswers> = {};

/** Drives ContextStep the way the wizard does: one controlled answers bag
 *  plus the framework's onSkip. */
function Harness({
  initial,
  onSkip,
}: {
  initial?: Partial<ReportSightingAnswers>;
  onSkip?: () => void;
}) {
  const [answers, setAnswers] = useState<Partial<ReportSightingAnswers>>(initial ?? {});
  const applyPatch = (patch: Partial<ReportSightingAnswers>) => {
    setAnswers((current) => {
      latest = { ...current, ...patch };
      return latest;
    });
  };
  return <ContextStep answers={answers} setAnswers={applyPatch} onSkip={onSkip} />;
}

async function renderStep(initial?: Partial<ReportSightingAnswers>, onSkip?: () => void) {
  let view!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    view = await render(<Harness initial={initial} onSkip={onSkip} />);
  });
  return view;
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

/** Opens the "Add more detail" expander — the door in front of conditions,
 *  marks, people, and the note. */
async function openMore(
  getByLabelText: (label: string) => Parameters<typeof fireEvent.press>[0],
) {
  await press(getByLabelText('Add more detail'));
}

/** Swipes the follow-up sheet away without answering — driven through the
 *  sheet's accessibility-escape path (the mock renders no backdrop; fireEvent
 *  walks up from sheet content to the scroll view carrying the handler). */
async function dismissSheet(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent(
      view.getByText('Not sure? Just swipe this away — it’s optional.'),
      'accessibilityEscape',
    );
  });
}

beforeEach(() => {
  latest = {};
});

describe('ContextStep — the prominent Skip', () => {
  it('advances via the framework onSkip without touching the answers', async () => {
    const onSkip = jest.fn();
    const { getByLabelText } = await renderStep(undefined, onSkip);
    await press(getByLabelText('Skip this step'));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(latest).toEqual({}); // skipping wrote nothing
  });
});

describe('ContextStep — vehicle state (CardSelect single-select)', () => {
  it('stores exactly the tapped state flag in contextFlags and checks its card', async () => {
    const { getByLabelText } = await renderStep();
    await press(getByLabelText(PARKED_CARD));
    expect(latest.contextFlags).toEqual(['parked']);
    expect(getByLabelText(PARKED_CARD)).toBeChecked();
    expect(getByLabelText(DRIVING_CARD)).not.toBeChecked();
  });

  it('switching parked → driving REPLACES the flag and clears parkedLikelihood', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['parked'],
      parkedLikelihood: 'settled',
    });
    await press(getByLabelText(DRIVING_CARD));
    expect(latest.contextFlags).toEqual(['driving']);
    expect(latest.parkedLikelihood).toBeUndefined();
  });

  it('switching driving → parked REPLACES the flag and clears the direction', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['driving'],
      direction: 'NE',
    });
    await press(getByLabelText(PARKED_CARD));
    expect(latest.contextFlags).toEqual(['parked']);
    expect(latest.direction).toBeUndefined();
  });

  it('tapping the selected state again clears it, its follow-up, and the row', async () => {
    const { getByLabelText, queryByTestId } = await renderStep({
      contextFlags: ['parked'],
      parkedLikelihood: 'street',
    });
    await press(getByLabelText(PARKED_CARD));
    expect(latest.contextFlags).toEqual([]);
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(queryByTestId('follow-up-row')).toBeNull();
  });
});

describe('ContextStep — the follow-up sheet and its summary row', () => {
  it('tapping Parked opens the likelihood sheet; picking answers, dismisses, and fills the row', async () => {
    const view = await renderStep();
    await press(view.getByLabelText(PARKED_CARD));

    // The sheet is up with the ONE follow-up question…
    expect(view.getByLabelText('Looks settled')).toBeTruthy();
    await press(view.getByLabelText('Looks settled'));

    // …picking wrote the answer AND closed the sheet…
    expect(latest.parkedLikelihood).toBe('settled');
    expect(view.queryByLabelText('Street parked')).toBeNull();

    // …and the editable row under the cards now carries it.
    const row = view.getByTestId('follow-up-row');
    expect(within(row).getByText('Likely to stay?')).toBeTruthy();
    expect(within(row).getByText('Looks settled')).toBeTruthy();
  });

  it('tapping Driving opens the compass; picking a direction answers, dismisses, and fills the row', async () => {
    const view = await renderStep();
    await press(view.getByLabelText(DRIVING_CARD));

    expect(view.getByTestId('compass-picker')).toBeTruthy();
    await press(view.getByTestId('compass-NE'));

    expect(latest.direction).toBe('NE');
    expect(view.queryByTestId('compass-picker')).toBeNull();

    const row = view.getByTestId('follow-up-row');
    expect(within(row).getByText('Which way was it heading?')).toBeTruthy();
    expect(within(row).getByText('NE')).toBeTruthy();
  });

  it('shows the row only while parked or driving is selected — never for loaded/unset', async () => {
    const view = await renderStep();
    expect(view.queryByTestId('follow-up-row')).toBeNull();

    await press(view.getByLabelText(LOADED_CARD));
    expect(view.queryByTestId('follow-up-row')).toBeNull();

    await press(view.getByLabelText(PARKED_CARD));
    expect(view.getByTestId('follow-up-row')).toBeTruthy();
  });

  it('dismissing the sheet without picking leaves the answer unset — the row reads "Add"', async () => {
    const view = await renderStep();
    await press(view.getByLabelText(PARKED_CARD));
    expect(view.getByLabelText('Looks settled')).toBeTruthy();

    await dismissSheet(view);

    expect(view.queryByLabelText('Looks settled')).toBeNull(); // sheet gone
    expect(latest.parkedLikelihood).toBeUndefined(); // nothing fabricated
    expect(within(view.getByTestId('follow-up-row')).getByText('Add')).toBeTruthy();
  });

  it('the row reopens the sheet to edit the answer', async () => {
    const view = await renderStep({ contextFlags: ['parked'], parkedLikelihood: 'settled' });
    expect(view.queryByLabelText('Street parked')).toBeNull(); // sheet closed at rest

    await press(view.getByTestId('follow-up-row'));
    await press(view.getByLabelText('Street parked'));

    expect(latest.parkedLikelihood).toBe('street');
    expect(within(view.getByTestId('follow-up-row')).getByText('Street parked')).toBeTruthy();
  });

  it('picking the already-chosen likelihood clears it (tap-again-clear survives the sheet)', async () => {
    const view = await renderStep({ contextFlags: ['parked'], parkedLikelihood: 'settled' });
    await press(view.getByTestId('follow-up-row'));
    await press(view.getByLabelText('Looks settled'));

    expect(latest.parkedLikelihood).toBeUndefined();
    expect(within(view.getByTestId('follow-up-row')).getByText('Add')).toBeTruthy();
  });

  it('clearing the direction keeps the compass sheet open for a re-pick', async () => {
    const view = await renderStep({ contextFlags: ['driving'], direction: 'NE' });
    await press(view.getByTestId('follow-up-row'));

    await press(view.getByTestId('compass-NE')); // tap the selected cell → clear
    expect(latest.direction).toBeUndefined();
    // A clear is not an answer — the sheet stays for a corrected pick.
    expect(view.getByTestId('compass-picker')).toBeTruthy();
  });
});

describe('ContextStep — the "Add more detail" expander', () => {
  it('is collapsed on a fresh report: one question, everything else behind the door', async () => {
    const { getByLabelText, queryByText, queryByLabelText } = await renderStep({
      confirmableFeatures: MARKS,
    });
    expect(getByLabelText('Add more detail')).not.toBeExpanded();
    expect(queryByText('Condition at a glance')).toBeNull();
    expect(queryByText('Could you see…?')).toBeNull();
    expect(queryByText('Anyone around?')).toBeNull();
    expect(queryByLabelText('Anything else? (optional)')).toBeNull();
    // The one-glance question stays out front.
    expect(getByLabelText(PARKED_CARD)).toBeTruthy();
  });

  it('opening reveals conditions, marks, people, and the note; closing hides them again', async () => {
    const { getByLabelText, getByText, queryByText } = await renderStep({
      confirmableFeatures: MARKS,
    });
    await openMore(getByLabelText);

    expect(getByLabelText('Hide extra detail')).toBeExpanded();
    expect(getByText('Condition at a glance')).toBeTruthy();
    expect(getByText('Could you see…?')).toBeTruthy();
    expect(getByText('Anyone around?')).toBeTruthy();
    expect(getByLabelText('Anything else? (optional)')).toBeTruthy();

    await press(getByLabelText('Hide extra detail'));
    expect(queryByText('Condition at a glance')).toBeNull();
    expect(getByLabelText('Add more detail')).not.toBeExpanded();
  });

  it('auto-opens when the answers already carry a condition flag', async () => {
    const { getByText, getByLabelText } = await renderStep({
      contextFlags: ['parked', 'damage_visible'],
    });
    expect(getByLabelText('Hide extra detail')).toBeExpanded();
    expect(getByText('Condition at a glance')).toBeTruthy();
  });

  it('auto-opens for a recorded people answer — the safety line must not hide', async () => {
    const { getByText } = await renderStep({ peoplePresence: 'nearby' });
    expect(getByText('Anyone around?')).toBeTruthy();
    expect(getByText(SAFETY_LINE)).toBeTruthy();
  });

  it('auto-opens when marks were confirmed or a note was written', async () => {
    const confirmed = await renderStep({
      confirmableFeatures: MARKS,
      confirmedFeatureIds: ['m1'],
    });
    expect(confirmed.getByText('Could you see…?')).toBeTruthy();
    await confirmed.unmount(); // async in this RNTL — un-awaited it poisons later renders

    const noted = await renderStep({ note: 'white transit following it' });
    expect(noted.getByLabelText('Anything else? (optional)')).toBeTruthy();
  });

  it('stays collapsed when only the front question was answered (state + follow-up)', async () => {
    const { getByLabelText, queryByText } = await renderStep({
      contextFlags: ['driving'],
      direction: 'NE',
    });
    expect(getByLabelText('Add more detail')).not.toBeExpanded();
    expect(queryByText('Anyone around?')).toBeNull();
  });
});

describe('ContextStep — condition chips (multi-select, behind the expander)', () => {
  it('condition flags MERGE with the state flag in contextFlags', async () => {
    const { getByLabelText } = await renderStep({ contextFlags: ['parked'] });
    await openMore(getByLabelText);
    await press(getByLabelText('Damage visible'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible']);

    await press(getByLabelText('Being stripped'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible', 'being_stripped']);
  });

  it('deselecting a condition keeps the state flag intact', async () => {
    // Existing detail auto-opens the expander — no press needed.
    const { getByLabelText } = await renderStep({
      contextFlags: ['being_loaded', 'plate_changed'],
    });
    await press(getByLabelText('Plate changed or missing'));
    expect(latest.contextFlags).toEqual(['being_loaded']);
  });

  it('conditions survive a state switch (only the state slot is replaced)', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['parked', 'looks_intact'],
    });
    await press(getByLabelText(DRIVING_CARD));
    expect(latest.contextFlags).toEqual(['driving', 'looks_intact']);
  });
});

describe('ContextStep — people presence (behind the expander)', () => {
  it('selecting sets peoplePresence; tapping again clears it', async () => {
    const { getByLabelText } = await renderStep();
    await openMore(getByLabelText);
    await press(getByLabelText('People near it'));
    expect(latest.peoplePresence).toBe('nearby');

    await press(getByLabelText('People near it'));
    expect(latest.peoplePresence).toBeUndefined();
  });

  it('shows the fixed safety line for nearby and in_vehicle — never for nobody/unset', async () => {
    const { getByLabelText, queryByText } = await renderStep();
    await openMore(getByLabelText);
    expect(queryByText(SAFETY_LINE)).toBeNull(); // unset

    await press(getByLabelText('People near it'));
    expect(queryByText(SAFETY_LINE)).toBeTruthy(); // nearby

    await press(getByLabelText('Someone in it'));
    expect(latest.peoplePresence).toBe('in_vehicle');
    expect(queryByText(SAFETY_LINE)).toBeTruthy(); // in_vehicle

    await press(getByLabelText('Nobody around'));
    expect(queryByText(SAFETY_LINE)).toBeNull(); // nobody
  });
});

describe('ContextStep — confirmable marks (behind the expander)', () => {
  it('renders a checkmark row per registered mark and toggles confirmedFeatureIds', async () => {
    const { getByLabelText, getByTestId } = await renderStep({ confirmableFeatures: MARKS });
    await openMore(getByLabelText);

    await press(getByTestId('confirm-mark-m1'));
    expect(latest.confirmedFeatureIds).toEqual(['m1']);
    expect(getByTestId('confirm-mark-m1')).toBeChecked();

    await press(getByTestId('confirm-mark-m2'));
    expect(latest.confirmedFeatureIds).toEqual(['m1', 'm2']);

    // Toggling off removes ONLY that id.
    await press(getByTestId('confirm-mark-m1'));
    expect(latest.confirmedFeatureIds).toEqual(['m2']);
    expect(getByTestId('confirm-mark-m1')).not.toBeChecked();
  });

  it('labels each row with the mark description (screen-reader path)', async () => {
    const { getByLabelText } = await renderStep({ confirmableFeatures: MARKS });
    await openMore(getByLabelText);
    expect(getByLabelText('Cracked nearside wing mirror')).toBeTruthy();
    expect(getByLabelText('Bee sticker on the boot')).toBeTruthy();
  });

  it('omits the "Could you see…?" section when the post has no marks', async () => {
    const { getByLabelText, queryByText } = await renderStep();
    await openMore(getByLabelText);
    expect(queryByText('Could you see…?')).toBeNull();
  });
});

describe('ContextStep — the note (behind the expander)', () => {
  it('typing writes the note into the answers', async () => {
    const { getByLabelText } = await renderStep();
    await openMore(getByLabelText);
    await act(async () => {
      fireEvent.changeText(getByLabelText('Anything else? (optional)'), 'white transit nearby');
    });
    expect(latest.note).toBe('white transit nearby');
  });
});

describe('CompassPicker', () => {
  it('renders all eight direction cells', async () => {
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<CompassPicker value={undefined} onChange={jest.fn()} />);
    });
    for (const direction of DRIVING_DIRECTIONS) {
      expect(view.getByTestId(`compass-${direction}`)).toBeTruthy();
    }
  });

  it('tap selects a direction; tapping the selected one clears (onChange undefined)', async () => {
    const onChange = jest.fn();
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<CompassPicker value={undefined} onChange={onChange} />);
    });
    await press(view.getByTestId('compass-SW'));
    expect(onChange).toHaveBeenCalledWith('SW');

    await act(async () => {
      await view.rerender(<CompassPicker value="SW" onChange={onChange} />);
    });
    await press(view.getByTestId('compass-SW'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('marks only the selected direction as checked', async () => {
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<CompassPicker value="S" onChange={jest.fn()} />);
    });
    expect(view.getByTestId('compass-S')).toBeChecked();
    expect(view.getByTestId('compass-N')).not.toBeChecked();
  });
});
