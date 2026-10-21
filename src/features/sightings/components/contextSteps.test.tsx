/**
 * WHAT:  Tests for the report's context steps, one question each (2026-10-20):
 *        state (with "Not sure"), the follow-ups (staying; the compass and its
 *        "Not sure"), people and its fixed safety line, condition ("Looks
 *        intact" exclusive; "Being stripped" brings the line up too), the
 *        owner's marks, the note — each card's words and line, a second tap
 *        clearing, auto-advance on a single pick, and NEVER past the safety
 *        line. Plus CompassPicker's own select/clear.
 * WHY:   The steps write DOMAIN facts into one shared answers bag: a wiring
 *        slip double-stores exclusive states, strands a follow-up under the
 *        wrong state, or loses the conditions. "Not sure" must never become a
 *        stored answer. The safety line is a SECURITY_AND_TRUST register that
 *        must show exactly when people are (or may be) there, pinned word for
 *        word — and a speed flow's auto-advance must never carry the screen
 *        past it.
 * LINKS: src/features/sightings/components/contextSteps.tsx;
 *        src/features/sightings/lib/contextAnswers.ts (the rules, tested on
 *        their own); src/features/sightings/components/CompassPicker.tsx.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useState, type ComponentType } from 'react';
import { AccessibilityInfo } from 'react-native';

import { SAFETY_999_LINE, SAFETY_PRESENCE_LINE } from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import { DRIVING_DIRECTIONS, type ReportSightingAnswers } from '../types';
import { CompassPicker } from './CompassPicker';
import {
  ConditionStep,
  DirectionStep,
  MarksStep,
  NoteStep,
  PeopleStep,
  StateStep,
  StayingStep,
} from './contextSteps';

// Load-boundary mocks: the @/shared/ui barrel pulls the camera, the map and
// the sheet library in even though these steps render none of them.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));
jest.mock(
  'react-native-safe-area-context',
  () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
    require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@gorhom/bottom-sheet/mock'),
);

/** The fixed inline safety register — pinned word-for-word (SAFETY copy). */
const SAFETY_LINE = 'Don’t approach — your report is enough.';
/** …and, for a crime in progress, the app's 999 line under it. */
const LINE_999 = 'If a crime is in progress, call 999.';

const MARKS = [
  {
    id: 'm1',
    description: 'Cracked nearside wing mirror',
    photoUrl: 'https://example.test/m1.jpg',
  },
  { id: 'm2', description: 'Bee sticker on the boot' },
];

type Answers = Partial<ReportSightingAnswers>;
type StepProps = WizardStepProps<ReportSightingAnswers>;

/** The answers bag after the last interaction — what the wizard would submit.
 *  Written by the harness's setAnswers wrapper, never during render. */
let latest: Answers = {};
const advanceSoon = jest.fn();
const cancelAdvanceSoon = jest.fn();

/** Drives a step the way the wizard does: one controlled answers bag. */
function Harness({ Step, initial }: { Step: ComponentType<StepProps>; initial?: Answers }) {
  const [answers, setAnswers] = useState<Answers>(initial ?? {});
  const applyPatch = (patch: Answers) => {
    setAnswers((current) => {
      latest = { ...current, ...patch };
      return latest;
    });
  };
  return (
    <Step
      answers={answers}
      setAnswers={applyPatch}
      advanceSoon={advanceSoon}
      cancelAdvanceSoon={cancelAdvanceSoon}
    />
  );
}

type View = Awaited<ReturnType<typeof render>>;

async function renderStep(Step: ComponentType<StepProps>, initial?: Answers) {
  let view!: View;
  await act(async () => {
    view = await render(<Harness Step={Step} initial={initial} />);
  });
  return view;
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A card by its title (its spoken name is "title. line"). */
const card = (view: View, group: string, title: string, role: 'radio' | 'checkbox' = 'radio') =>
  within(view.getByTestId(group)).getByRole(role, {
    name: new RegExp(`^${escape(title)}(\\. |$)`),
  });

beforeEach(() => {
  latest = {};
  advanceSoon.mockClear();
  cancelAdvanceSoon.mockClear();
});

describe('what was it doing?', () => {
  it('offers each answer as a card with its line, and "Not sure" last', async () => {
    const view = await renderStep(StateStep);
    expect(view.getByText('Standing still in a space')).toBeTruthy();
    expect(view.getByText('Being driven on the road')).toBeTruthy();
    expect(view.getByText('On a trailer, truck or tow')).toBeTruthy();
    const names = within(view.getByTestId('context-state'))
      .getAllByRole('radio')
      .map((node) => node.props.accessibilityLabel);
    expect(names.at(-1)).toBe('Not sure');
  });

  it('stores exactly the tapped state, moves on — and a second tap clears and stays', async () => {
    const view = await renderStep(StateStep);
    await press(card(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual(['driving']);
    expect(card(view, 'context-state', 'Moving')).toBeChecked();
    expect(advanceSoon).toHaveBeenCalledTimes(1);

    await press(card(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual([]);
    expect(advanceSoon).toHaveBeenCalledTimes(1);
    // Cleared inside the beat: the beat already running is dropped too.
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
  });

  it('"Not sure" stores nothing, shows as chosen, and drops any state and its follow-up', async () => {
    const view = await renderStep(StateStep, {
      contextFlags: ['parked'],
      parkedLikelihood: 'moving',
    });
    await press(card(view, 'context-state', 'Not sure'));
    expect(latest.contextFlags).toEqual([]);
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['state']);
    expect(card(view, 'context-state', 'Not sure')).toBeChecked();
    expect(advanceSoon).toHaveBeenCalled();
  });

  it('switching state keeps the conditions and drops the old follow-up', async () => {
    const view = await renderStep(StateStep, {
      contextFlags: ['parked', 'damage_visible'],
      parkedLikelihood: 'settled',
    });
    await press(card(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual(['driving', 'damage_visible']);
    expect(latest.parkedLikelihood).toBeUndefined();
  });

  it('⚠️ SAFETY: "Being loaded or towed" stays, shows the line with 999, and says it', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    announce.mockClear();
    try {
      const view = await renderStep(StateStep);
      await press(card(view, 'context-state', 'Being loaded or towed'));
      expect(advanceSoon).not.toHaveBeenCalled();
      expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
      expect(view.getByText(SAFETY_LINE)).toBeTruthy();
      expect(view.getByText(LINE_999)).toBeTruthy();
      expect(announce).toHaveBeenCalledWith(`${SAFETY_LINE} ${LINE_999}`, { queue: true });

      // Parked instead: the line goes, and the pick moves on.
      await press(card(view, 'context-state', 'Parked'));
      expect(view.queryByText(SAFETY_LINE)).toBeNull();
      expect(advanceSoon).toHaveBeenCalledTimes(1);
    } finally {
      announce.mockRestore();
    }
  });

  it('tells screen readers the chosen card clears on a second tap', async () => {
    const view = await renderStep(StateStep, { contextFlags: ['parked'] });
    expect(card(view, 'context-state', 'Parked').props.accessibilityHint).toBe(
      'Double tap to clear',
    );
    expect(card(view, 'context-state', 'Moving').props.accessibilityHint).toBeUndefined();
  });
});

describe('did it look like it was staying?', () => {
  it('stores the pick and moves on; "Not sure" stores nothing; a second tap clears', async () => {
    const view = await renderStep(StayingStep, { contextFlags: ['parked'] });
    expect(view.getByText('Lights on, or pulling out')).toBeTruthy();
    await press(card(view, 'context-staying', 'Looks about to move'));
    expect(latest.parkedLikelihood).toBe('moving');
    expect(advanceSoon).toHaveBeenCalledTimes(1);

    await press(card(view, 'context-staying', 'Not sure'));
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['staying']);

    await press(card(view, 'context-staying', 'Not sure'));
    expect(latest.contextUnsure).toEqual([]);
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1); // the clear stays
  });
});

describe('which way was it heading?', () => {
  const unsureBox = (view: View) =>
    within(view.getByTestId('context-direction-unsure')).getByRole('checkbox', {
      name: 'Not sure which way it went',
    });

  it('stores and names a direction, and moves on', async () => {
    const view = await renderStep(DirectionStep, { contextFlags: ['driving'] });
    await press(view.getByTestId('compass-NE'));
    expect(latest.direction).toBe('NE');
    expect(view.getByText('Heading north-east')).toBeTruthy();
    expect(advanceSoon).toHaveBeenCalledTimes(1);
  });

  it('a compass tap and "Not sure which way" replace each other; unticking stays', async () => {
    const view = await renderStep(DirectionStep, { contextFlags: ['driving'] });
    await press(unsureBox(view));
    expect(latest.contextUnsure).toEqual(['direction']);
    expect(unsureBox(view)).toBeChecked();
    expect(advanceSoon).toHaveBeenCalledTimes(1);

    await press(view.getByTestId('compass-S'));
    expect(latest.direction).toBe('S');
    expect(latest.contextUnsure).toEqual([]);

    await press(unsureBox(view));
    expect(latest.direction).toBeUndefined();
    await press(unsureBox(view)); // off again: nothing chosen, and it stays
    expect(latest.contextUnsure).toEqual([]);
    expect(advanceSoon).toHaveBeenCalledTimes(3);
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
  });

  it('clearing the heading (a second tap on it) stays', async () => {
    const view = await renderStep(DirectionStep, { contextFlags: ['driving'], direction: 'N' });
    await press(view.getByTestId('compass-N'));
    expect(latest.direction).toBeUndefined();
    expect(advanceSoon).not.toHaveBeenCalled();
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
  });
});

describe('anyone in or near it?', () => {
  it('stores the answer, clears on a second tap, and "Not sure" stores nothing', async () => {
    const view = await renderStep(PeopleStep);
    await press(card(view, 'context-people', 'Someone in it'));
    expect(latest.peoplePresence).toBe('in_vehicle');
    await press(card(view, 'context-people', 'Someone in it'));
    expect(latest.peoplePresence).toBeUndefined();
    await press(card(view, 'context-people', 'Not sure'));
    expect(latest.peoplePresence).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['people']);
  });

  it('shows the fixed safety line for people near or in it, or unsure; never for no one', async () => {
    const view = await renderStep(PeopleStep);
    expect(view.queryByText(SAFETY_LINE)).toBeNull();
    await press(card(view, 'context-people', 'People near it'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
    await press(card(view, 'context-people', 'Someone in it'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
    await press(card(view, 'context-people', 'No one seen'));
    expect(view.queryByText(SAFETY_LINE)).toBeNull();
    // Can't tell is exactly when someone steps closer to check.
    await press(card(view, 'context-people', 'Not sure'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
  });

  it('⚠️ SAFETY: only "No one seen" moves on; every answer that shows the line stays — and cancels a beat already running', async () => {
    const view = await renderStep(PeopleStep);
    await press(card(view, 'context-people', 'No one seen'));
    expect(advanceSoon).toHaveBeenCalledTimes(1);

    // A change of mind inside the beat: the line must be seen.
    await press(card(view, 'context-people', 'People near it'));
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
    await press(card(view, 'context-people', 'Someone in it'));
    await press(card(view, 'context-people', 'Not sure'));
    expect(advanceSoon).toHaveBeenCalledTimes(1);
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(3);
  });

  it('SAFETY: announces the line as it appears (VoiceOver has no live regions)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    announce.mockClear();
    try {
      const view = await renderStep(PeopleStep);
      await press(card(view, 'context-people', 'No one seen'));
      expect(announce).not.toHaveBeenCalled();

      await press(card(view, 'context-people', 'People near it'));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(SAFETY_LINE, { queue: true });

      // Already showing: switching between "showing" answers says it once.
      await press(card(view, 'context-people', 'Someone in it'));
      expect(announce).toHaveBeenCalledTimes(1);

      // Gone and back: said again.
      await press(card(view, 'context-people', 'Someone in it'));
      await press(card(view, 'context-people', 'Not sure'));
      expect(announce).toHaveBeenCalledTimes(2);
    } finally {
      announce.mockRestore();
    }
  });

  it('SAFETY: the lines are the shared constants, word for word', () => {
    expect(SAFETY_PRESENCE_LINE).toBe(SAFETY_LINE);
    expect(SAFETY_999_LINE).toBe(LINE_999);
  });

  it('SAFETY: people near it is not a crime in itself — no 999 line there', async () => {
    const view = await renderStep(PeopleStep);
    await press(card(view, 'context-people', 'People near it'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
    expect(view.queryByText(LINE_999)).toBeNull();
  });
});

describe('its condition', () => {
  const box = (view: View, title: string) => card(view, 'context-condition', title, 'checkbox');

  it('keeps the state in front and the conditions in the order ticked; never moves on', async () => {
    const view = await renderStep(ConditionStep, { contextFlags: ['parked'] });
    await press(box(view, 'Damage visible'));
    await press(box(view, 'Plate changed or missing'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible', 'plate_changed']);
    expect(advanceSoon).not.toHaveBeenCalled();
  });

  it('"Looks intact" is exclusive, both ways', async () => {
    const view = await renderStep(ConditionStep);
    await press(box(view, 'Damage visible'));
    await press(box(view, 'Looks intact'));
    expect(latest.contextFlags).toEqual(['looks_intact']);
    await press(box(view, 'Being stripped'));
    expect(latest.contextFlags).toEqual(['being_stripped']);
  });

  it('⚠️ SAFETY: "Being stripped" shows the line and announces it — people are working on the car', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    announce.mockClear();
    try {
      const view = await renderStep(ConditionStep);
      await press(box(view, 'Damage visible'));
      expect(view.queryByText(SAFETY_LINE)).toBeNull();
      await press(box(view, 'Being stripped'));
      expect(view.getByText(SAFETY_LINE)).toBeTruthy();
      // A crime in progress: 999 under the line, said with it.
      expect(view.getByText(LINE_999)).toBeTruthy();
      expect(announce).toHaveBeenCalledWith(`${SAFETY_LINE} ${LINE_999}`, { queue: true });
      await press(box(view, 'Being stripped'));
      expect(view.queryByText(SAFETY_LINE)).toBeNull();
    } finally {
      announce.mockRestore();
    }
  });
});

describe("the owner's marks", () => {
  it('shows each mark with its photo when there is one, and toggles it', async () => {
    const view = await renderStep(MarksStep, { confirmableFeatures: MARKS });
    expect(view.getByTestId('confirm-mark-m1-photo')).toBeTruthy();
    expect(view.queryByTestId('confirm-mark-m2-photo')).toBeNull();

    await press(view.getByRole('checkbox', { name: 'Bee sticker on the boot' }));
    expect(latest.confirmedFeatureIds).toEqual(['m2']);
    expect(view.getByRole('checkbox', { name: 'Bee sticker on the boot' })).toBeChecked();
    await press(view.getByRole('checkbox', { name: 'Bee sticker on the boot' }));
    expect(latest.confirmedFeatureIds).toEqual([]);
  });
});

describe('the note', () => {
  it('writes the note, and counts it against the limit', async () => {
    const view = await renderStep(NoteStep);
    // The counter is hidden from screen readers on purpose (TextField).
    expect(view.getByText('0/500', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Your note'), 'Two men loading it');
    });
    expect(latest.note).toBe('Two men loading it');
    expect(view.getByText('18/500', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('CompassPicker', () => {
  it('renders all eight direction cells', async () => {
    let view!: View;
    await act(async () => {
      view = await render(<CompassPicker value={undefined} onChange={jest.fn()} />);
    });
    for (const direction of DRIVING_DIRECTIONS) {
      expect(view.getByTestId(`compass-${direction}`)).toBeTruthy();
    }
  });

  it('tap selects a direction; tapping the selected one clears (onChange undefined)', async () => {
    const onChange = jest.fn();
    let view!: View;
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
    let view!: View;
    await act(async () => {
      view = await render(<CompassPicker value="S" onChange={jest.fn()} />);
    });
    expect(view.getByTestId('compass-S')).toBeChecked();
    expect(view.getByTestId('compass-N')).not.toBeChecked();
  });
});
