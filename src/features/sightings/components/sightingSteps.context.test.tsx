/**
 * WHAT:  Tests for the recomposed ContextStep (context v2) — the single-select
 *        vehicle-state group and its conditional follow-ups (parked →
 *        likelihood chips, driving → CompassPicker), the multi-select
 *        condition chips coexisting with the state flag in contextFlags, the
 *        "Could you see…?" confirmable-mark checkmarks, the 3-way people
 *        selection with its fixed inline safety line, and CompassPicker's own
 *        select/clear semantics.
 * WHY:   The context step encodes DOMAIN facts in ONE shared array
 *        (contextFlags): a wiring slip either double-stores mutually exclusive
 *        states, strands a stale follow-up under the wrong state ("Parked ·
 *        likely to stay" lingering under "Driving" misleads the owner), or
 *        drops the condition chips when a state is toggled. The safety line is
 *        a SECURITY_AND_TRUST register — it must appear exactly when people
 *        are present and never be editable copy.
 * LINKS: src/features/sightings/components/sightingSteps.tsx (ContextStep);
 *        src/features/sightings/components/CompassPicker.tsx;
 *        src/features/sightings/types.ts (flag vocabularies); docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';

import { DRIVING_DIRECTIONS, type ReportSightingAnswers } from '../types';
import { CompassPicker } from './CompassPicker';
import { ContextStep } from './sightingSteps';

// Load-boundary mocks: importing sightingSteps pulls the WHOLE step module in
// (camera, grid, map) even though ContextStep renders none of it — same mock
// set as sightingSteps.test.tsx, minus the camera behaviour it drives.
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
  { id: 'm1', description: 'Cracked nearside wing mirror' },
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

async function renderStep(initial?: Partial<ReportSightingAnswers>) {
  let view!: Awaited<ReturnType<typeof render>>;
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

beforeEach(() => {
  latest = {};
});

describe('ContextStep — vehicle state (single-select)', () => {
  it('stores exactly the tapped state flag in contextFlags', async () => {
    const { getByLabelText } = await renderStep();
    await press(getByLabelText('Parked'));
    expect(latest.contextFlags).toEqual(['parked']);
  });

  it('switching parked → driving REPLACES the flag and clears parkedLikelihood', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['parked'],
      parkedLikelihood: 'settled',
    });
    await press(getByLabelText('Driving'));
    expect(latest.contextFlags).toEqual(['driving']);
    expect(latest.parkedLikelihood).toBeUndefined();
  });

  it('switching driving → parked REPLACES the flag and clears the direction', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['driving'],
      direction: 'NE',
    });
    await press(getByLabelText('Parked'));
    expect(latest.contextFlags).toEqual(['parked']);
    expect(latest.direction).toBeUndefined();
  });

  it('tapping the selected state again clears it (and its follow-up)', async () => {
    const { getByLabelText } = await renderStep({
      contextFlags: ['parked'],
      parkedLikelihood: 'street',
    });
    await press(getByLabelText('Parked'));
    expect(latest.contextFlags).toEqual([]);
    expect(latest.parkedLikelihood).toBeUndefined();
  });
});

describe('ContextStep — conditional follow-ups', () => {
  it('reveals the likelihood chips only while parked is selected', async () => {
    const { getByLabelText, queryByLabelText, queryByTestId } = await renderStep();
    expect(queryByLabelText('Looks settled')).toBeNull();
    expect(queryByTestId('compass-picker')).toBeNull();

    await press(getByLabelText('Parked'));
    expect(queryByLabelText('Looks settled')).toBeTruthy();
    expect(queryByTestId('compass-picker')).toBeNull();
  });

  it('reveals the compass only while driving is selected', async () => {
    const { getByLabelText, queryByLabelText, queryByTestId } = await renderStep();
    await press(getByLabelText('Driving'));
    expect(queryByTestId('compass-picker')).toBeTruthy();
    expect(queryByLabelText('Looks settled')).toBeNull();
  });

  it('likelihood chips select, and tapping the selected one clears it', async () => {
    const { getByLabelText } = await renderStep({ contextFlags: ['parked'] });
    await press(getByLabelText('Street parked'));
    expect(latest.parkedLikelihood).toBe('street');

    await press(getByLabelText('Street parked'));
    expect(latest.parkedLikelihood).toBeUndefined();
  });

  it('the compass writes the direction into the answers (and clears on re-tap)', async () => {
    const { getByTestId } = await renderStep({ contextFlags: ['driving'] });
    await press(getByTestId('compass-NE'));
    expect(latest.direction).toBe('NE');

    await press(getByTestId('compass-NE'));
    expect(latest.direction).toBeUndefined();
  });
});

describe('ContextStep — condition chips (multi-select)', () => {
  it('condition flags MERGE with the state flag in contextFlags', async () => {
    const { getByLabelText } = await renderStep({ contextFlags: ['parked'] });
    await press(getByLabelText('Damage visible'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible']);

    await press(getByLabelText('Being stripped'));
    expect(latest.contextFlags).toEqual(['parked', 'damage_visible', 'being_stripped']);
  });

  it('deselecting a condition keeps the state flag intact', async () => {
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
    await press(getByLabelText('Driving'));
    expect(latest.contextFlags).toEqual(['driving', 'looks_intact']);
  });
});

describe('ContextStep — people presence', () => {
  it('selecting sets peoplePresence; tapping again clears it', async () => {
    const { getByLabelText } = await renderStep();
    await press(getByLabelText('People near it'));
    expect(latest.peoplePresence).toBe('nearby');

    await press(getByLabelText('People near it'));
    expect(latest.peoplePresence).toBeUndefined();
  });

  it('shows the fixed safety line for nearby and in_vehicle — never for nobody/unset', async () => {
    const { getByLabelText, queryByText } = await renderStep();
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

describe('ContextStep — confirmable marks', () => {
  it('renders a checkmark row per registered mark and toggles confirmedFeatureIds', async () => {
    const { getByTestId } = await renderStep({ confirmableFeatures: MARKS });

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
    expect(getByLabelText('Cracked nearside wing mirror')).toBeTruthy();
    expect(getByLabelText('Bee sticker on the boot')).toBeTruthy();
  });

  it('omits the "Could you see…?" section when the post has no marks', async () => {
    const { queryByText } = await renderStep();
    expect(queryByText('Could you see…?')).toBeNull();
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
