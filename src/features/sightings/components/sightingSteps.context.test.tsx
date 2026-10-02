/**
 * WHAT:  Tests for the redesigned ContextStep (2026-10-01): one page of chip
 *        questions, every one visible:
 *          - "What was it doing?" (single), with its inline follow-ups:
 *            "Did it look like it was staying?" for Parked, the compass for
 *            Moving;
 *          - "Anyone in or near it?" (single) and its fixed safety line,
 *            announced as it appears;
 *          - "Its condition" (multi; "Looks intact" exclusive);
 *          - the owner's marks as photo rows;
 *          - the note (multiline, with a counter).
 *        Each single question offers "Not sure", which stores nothing but is
 *        remembered for the UI. Plus CompassPicker's own select/clear.
 * WHY:   The step writes DOMAIN facts into one shared array (contextFlags): a
 *        wiring slip double-stores exclusive states, strands a follow-up under
 *        the wrong state ("looks parked up" under "Moving" misleads the
 *        owner), or loses the conditions when the state changes. "Not sure"
 *        must never become a stored answer. The safety line is a
 *        SECURITY_AND_TRUST register that must show exactly when people are
 *        present or the spotter can't tell, pinned word for word.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (ContextStep);
 *        src/features/sightings/lib/contextLabels.ts (the chip words);
 *        src/features/sightings/components/CompassPicker.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { SAFETY_PRESENCE_LINE } from '@/shared/ui';

import { DRIVING_DIRECTIONS, type ReportSightingAnswers } from '../types';
import { CompassPicker } from './CompassPicker';
import { ContextStep } from './sightingSteps';

// Load-boundary mocks: importing sightingSteps pulls the WHOLE step module in
// (camera, map, image pipeline) even though ContextStep renders none of it —
// same mock set as sightingSteps.test.tsx. The global reanimated mock
// (moduleNameMapper) covers FadeIn and LayoutAnimationConfig.
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
// No sheet on this step any more, but the @/shared/ui barrel still exports
// BottomSheet, so the library needs its stub to load.
jest.mock('@gorhom/bottom-sheet', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@gorhom/bottom-sheet/mock'),
);
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

const MARKS = [
  { id: 'm1', description: 'Cracked nearside wing mirror', photoUrl: 'https://example.test/m1.jpg' },
  { id: 'm2', description: 'Bee sticker on the boot' },
];

/** The answers bag after the last user interaction — what the wizard would
 *  submit. Written by the harness's setAnswers wrapper (every assertion on it
 *  follows a press), never during render (react-hooks/globals). */
let latest: Partial<ReportSightingAnswers> = {};

/** Drives ContextStep the way the wizard does: one controlled answers bag. */
function Harness({ initial }: { initial?: Partial<ReportSightingAnswers> }) {
  const [answers, setAnswers] = useState<Partial<ReportSightingAnswers>>(initial ?? {});
  const applyPatch = (patch: Partial<ReportSightingAnswers>) => {
    setAnswers((current) => {
      latest = { ...current, ...patch };
      return latest;
    });
  };
  return <ContextStep answers={answers} setAnswers={applyPatch} />;
}

type View = Awaited<ReturnType<typeof render>>;

async function renderStep(initial?: Partial<ReportSightingAnswers>) {
  let view!: View;
  await act(async () => {
    view = await render(<Harness initial={initial} />);
  });
  return view;
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

/** A chip inside one question's row (each row has its own "Not sure"). */
const chip = (view: View, row: string, name: string) =>
  within(view.getByTestId(row)).getByRole('radio', { name });

/** The direction's "Not sure": a lone checkbox under the compass. */
const directionUnsure = (view: View) =>
  within(view.getByTestId('context-direction-unsure')).getByRole('checkbox', {
    name: 'Not sure which way it went',
  });

beforeEach(() => {
  latest = {};
});

describe('ContextStep — one page, every question visible', () => {
  it('shows every question at once: no drawer, no sheet, no in-body Skip', async () => {
    const view = await renderStep({ confirmableFeatures: MARKS });
    for (const title of [
      'What was it doing?',
      'Anyone in or near it?',
      'Its condition',
      'Could you see any of these?',
    ]) {
      expect(view.getByRole('header', { name: title })).toBeTruthy();
    }
    expect(view.getByLabelText('A note for the owner (optional)')).toBeTruthy();
    expect(view.queryByLabelText('Add more detail')).toBeNull();
    expect(view.queryByLabelText('Skip this step')).toBeNull();
  });

  it('counts what has been added (and "Not sure" is not a detail)', async () => {
    const view = await renderStep();
    // Always there, so the page never jumps on the first tap.
    expect(view.getByTestId('context-count')).toHaveTextContent('Nothing added yet');
    await press(chip(view, 'context-state', 'Parked'));
    expect(view.getByTestId('context-count')).toHaveTextContent('1 detail added');
    await press(chip(view, 'context-people', 'Not sure'));
    expect(view.getByTestId('context-count')).toHaveTextContent('1 detail added');
  });
});

describe('ContextStep — what it was doing', () => {
  it('stores exactly the tapped state, and tapping it again clears it', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual(['driving']);
    expect(chip(view, 'context-state', 'Moving')).toBeChecked();

    await press(chip(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual([]);
  });

  it('switching state REPLACES the flag and clears the old follow-up', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Parked'));
    await press(chip(view, 'context-staying', 'Looks parked up'));
    expect(latest.parkedLikelihood).toBe('settled');

    await press(chip(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual(['driving']);
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(view.queryByTestId('context-staying')).toBeNull();
  });

  it('"Not sure" stores nothing, shows as chosen, and drops any state', async () => {
    const view = await renderStep({ contextFlags: ['parked'], parkedLikelihood: 'moving' });
    await press(chip(view, 'context-state', 'Not sure'));
    expect(latest.contextFlags).toEqual([]);
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['state']);
    expect(chip(view, 'context-state', 'Not sure')).toBeChecked();

    // A real answer replaces the "not sure".
    await press(chip(view, 'context-state', 'Being loaded or towed'));
    expect(latest.contextFlags).toEqual(['being_loaded']);
    expect(latest.contextUnsure).toEqual([]);
  });
});

describe('ContextStep — the inline follow-ups', () => {
  it('Parked asks whether it looked like it was staying, inline', async () => {
    const view = await renderStep();
    expect(view.queryByRole('header', { name: 'Did it look like it was staying?' })).toBeNull();
    await press(chip(view, 'context-state', 'Parked'));
    expect(view.getByRole('header', { name: 'Did it look like it was staying?' })).toBeTruthy();

    await press(chip(view, 'context-staying', 'Looks about to move'));
    expect(latest.parkedLikelihood).toBe('moving');
    await press(chip(view, 'context-staying', 'Not sure'));
    expect(latest.parkedLikelihood).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['staying']);
  });

  it('Moving shows the compass inline; a direction is stored and named', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Moving'));
    expect(view.getByText('Tap where it went.')).toBeTruthy();
    await press(view.getByTestId('compass-NE'));
    expect(latest.direction).toBe('NE');
    expect(view.getByText('Heading north-east')).toBeTruthy();

    await press(directionUnsure(view));
    expect(latest.direction).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['direction']);
    expect(directionUnsure(view)).toBeChecked();
  });

  it('a follow-up\'s "Not sure" goes with its state', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Parked'));
    await press(chip(view, 'context-staying', 'Not sure'));
    await press(chip(view, 'context-state', 'Moving'));
    expect(latest.contextUnsure).toEqual([]);

    // ...and the direction's goes when Moving is left.
    await press(directionUnsure(view));
    expect(latest.contextUnsure).toEqual(['direction']);
    await press(chip(view, 'context-state', 'Parked'));
    expect(latest.contextUnsure).toEqual([]);
  });

  it('a compass tap replaces the direction\'s "Not sure", and vice versa', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Moving'));
    await press(directionUnsure(view));
    await press(view.getByTestId('compass-S'));
    expect(latest.direction).toBe('S');
    expect(latest.contextUnsure).toEqual([]);

    await press(directionUnsure(view));
    expect(latest.direction).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['direction']);
    // A second tap on "Not sure" clears it, leaving nothing chosen.
    await press(directionUnsure(view));
    expect(latest.direction).toBeUndefined();
    expect(latest.contextUnsure).toEqual([]);
  });

  it('a second tap on "Not sure" clears it, like any chip', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Not sure'));
    await press(chip(view, 'context-state', 'Not sure'));
    expect(latest.contextUnsure).toEqual([]);
    expect(chip(view, 'context-state', 'Not sure')).not.toBeChecked();

    await press(chip(view, 'context-state', 'Parked'));
    await press(chip(view, 'context-staying', 'Not sure'));
    await press(chip(view, 'context-staying', 'Not sure'));
    expect(latest.contextUnsure).toEqual([]);

    await press(chip(view, 'context-people', 'Not sure'));
    await press(chip(view, 'context-people', 'Not sure'));
    expect(latest.contextUnsure).toEqual([]);
  });

  it('tells screen readers the chosen chip clears on a second tap', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Parked'));
    expect(chip(view, 'context-state', 'Parked').props.accessibilityHint).toBe('Double tap to clear');
    expect(chip(view, 'context-state', 'Moving').props.accessibilityHint).toBeUndefined();
  });

  it('shows no follow-up for loaded, unsure or unset', async () => {
    const view = await renderStep();
    const noFollowUp = () => {
      expect(view.queryByTestId('context-staying')).toBeNull();
      expect(view.queryByTestId('compass-picker')).toBeNull();
    };
    noFollowUp();
    await press(chip(view, 'context-state', 'Being loaded or towed'));
    noFollowUp();
    await press(chip(view, 'context-state', 'Not sure'));
    noFollowUp();
  });
});

describe('ContextStep — people', () => {
  it('stores the answer, clears on a second tap, and "Not sure" stores nothing', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-people', 'Someone in it'));
    expect(latest.peoplePresence).toBe('in_vehicle');
    await press(chip(view, 'context-people', 'Someone in it'));
    expect(latest.peoplePresence).toBeUndefined();
    await press(chip(view, 'context-people', 'Not sure'));
    expect(latest.peoplePresence).toBeUndefined();
    expect(latest.contextUnsure).toEqual(['people']);
  });

  it('shows the fixed safety line for people near or in it, or unsure; never for no one', async () => {
    const view = await renderStep();
    expect(view.queryByText(SAFETY_LINE)).toBeNull();
    await press(chip(view, 'context-people', 'People near it'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
    await press(chip(view, 'context-people', 'Someone in it'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
    await press(chip(view, 'context-people', 'No one seen'));
    expect(view.queryByText(SAFETY_LINE)).toBeNull();
    // Can't tell is exactly when someone steps closer to check.
    await press(chip(view, 'context-people', 'Not sure'));
    expect(view.getByText(SAFETY_LINE)).toBeTruthy();
  });

  it('SAFETY: announces the line as it appears (VoiceOver has no live regions)', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions');
    // RN's jest setup already mocks it, so the spy carries earlier tests' calls.
    announce.mockClear();
    try {
      const view = await renderStep();
      await press(chip(view, 'context-people', 'No one seen'));
      expect(announce).not.toHaveBeenCalled();

      await press(chip(view, 'context-people', 'People near it'));
      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith(SAFETY_LINE, { queue: true });

      // Already showing: switching between "showing" answers says it once.
      await press(chip(view, 'context-people', 'Someone in it'));
      expect(announce).toHaveBeenCalledTimes(1);

      // Gone and back: said again.
      await press(chip(view, 'context-people', 'Someone in it'));
      await press(chip(view, 'context-people', 'Not sure'));
      expect(announce).toHaveBeenCalledTimes(2);
    } finally {
      announce.mockRestore();
    }
  });

  it('SAFETY: the line is the shared constant, word for word', () => {
    expect(SAFETY_PRESENCE_LINE).toBe(SAFETY_LINE);
  });
});

describe('ContextStep — condition', () => {
  const box = (view: View, name: string) =>
    within(view.getByTestId('context-condition')).getByRole('checkbox', { name });

  it('merges conditions with the state, and they survive a state switch', async () => {
    const view = await renderStep();
    await press(chip(view, 'context-state', 'Parked'));
    await press(box(view, 'Damage visible'));
    await press(box(view, 'Plate changed or missing'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible', 'plate_changed']);

    await press(chip(view, 'context-state', 'Moving'));
    expect(latest.contextFlags).toEqual(['driving', 'damage_visible', 'plate_changed']);
  });

  it('"Looks intact" is exclusive, both ways', async () => {
    const view = await renderStep();
    await press(box(view, 'Damage visible'));
    await press(box(view, 'Looks intact'));
    expect(latest.contextFlags).toEqual(['looks_intact']);
    await press(box(view, 'Being stripped'));
    expect(latest.contextFlags).toEqual(['being_stripped']);
  });
});

describe('ContextStep — the owner\'s marks', () => {
  it('shows each mark with its photo when there is one, and toggles it', async () => {
    const view = await renderStep({ confirmableFeatures: MARKS });
    expect(view.getByTestId('confirm-mark-m1-photo')).toBeTruthy();
    expect(view.queryByTestId('confirm-mark-m2-photo')).toBeNull();

    await press(view.getByRole('checkbox', { name: 'Bee sticker on the boot' }));
    expect(latest.confirmedFeatureIds).toEqual(['m2']);
    expect(view.getByRole('checkbox', { name: 'Bee sticker on the boot' })).toBeChecked();
    await press(view.getByRole('checkbox', { name: 'Bee sticker on the boot' }));
    expect(latest.confirmedFeatureIds).toEqual([]);
  });

  it('leaves the question out when the post has no marks', async () => {
    const view = await renderStep();
    expect(view.queryByRole('header', { name: 'Could you see any of these?' })).toBeNull();
  });
});

describe('ContextStep — the note', () => {
  it('writes the note, and counts it against the limit', async () => {
    const view = await renderStep();
    // The counter is hidden from screen readers on purpose (TextField).
    expect(view.getByText('0/500', { includeHiddenElements: true })).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByLabelText('A note for the owner (optional)'), 'Two men loading it');
    });
    expect(latest.note).toBe('Two men loading it');
    expect(view.getByText('18/500', { includeHiddenElements: true })).toBeTruthy();
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
