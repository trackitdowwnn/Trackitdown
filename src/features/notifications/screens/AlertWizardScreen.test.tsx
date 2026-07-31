/**
 * WHAT:  Tests that the wizard screen opens on the matcher picker, builds the
 *        flow the ticks describe, pre-ticks an alert being edited, and — the
 *        one that matters — saves criteria REDUCED by those ticks.
 * WHY:   SAFETY, end to end. lib/alertMatchers.test.ts proves the reduction is
 *        correct; this proves the screen actually applies it on the submit
 *        path. The two failure modes are invisible to the user: a save that
 *        keeps an unticked filter leaves them expecting alerts that never come,
 *        and `update_my_alert` is a FULL REPLACE so there is no second chance.
 *
 *        The wizard itself is mocked down to a capture of its props — this
 *        suite is about which flow the screen hands over and what it does with
 *        the answers that come back, not about the framework's own navigation
 *        (src/shared/wizard has its own tests for that).
 * LINKS: ./AlertWizardScreen.tsx; ../lib/alertMatchers.ts; ../lib/alertFlow.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { AlertWizardScreen } from './AlertWizardScreen';
import type { AlertAnswers } from '../types';

const mockCreateAlert = jest.fn();
const mockUpdateAlert = jest.fn();
jest.mock('../api/alertsApi', () => ({
  createAlert: (...args: unknown[]) => mockCreateAlert(...args),
  updateAlert: (...args: unknown[]) => mockUpdateAlert(...args),
}));

let mockAlertsState: Record<string, unknown> = { status: 'ready', alerts: [], refresh: jest.fn() };
jest.mock('../hooks/useMyAlerts', () => ({
  useMyAlerts: () => mockAlertsState,
  invalidateMyAlerts: jest.fn(),
}));

// Mocked rather than exercised: the real hook reaches AsyncStorage, the
// permissions module and expo-location, none of which this suite is about.
// Its own chain (and the no-cold-prompt rule) is covered by
// ../hooks/useDefaultAlertCentre.test.ts.
let mockCentreState: { status: 'resolving' | 'ready'; centre: unknown } = {
  status: 'ready',
  centre: null,
};
/** Whether the screen asked the hook to run at all (false while editing). */
let lastCentreEnabled: boolean | undefined;
jest.mock('../hooks/useDefaultAlertCentre', () => ({
  useDefaultAlertCentre: (enabled?: boolean) => {
    lastCentreEnabled = enabled;
    return mockCentreState;
  },
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));

// The step components reach the map, the slider and the pickers; the flow
// config is what we assert on, not what it renders.
jest.mock('../components/alertSteps', () => ({
  AreaStep: () => null,
  CarStep: () => null,
  FiltersStep: () => null,
  NameStep: () => null,
}));

/** Captures what the screen hands the wizard, and lets the test finish it. */
let lastFlowStepIds: string[] = [];
let lastOnComplete: ((answers: Partial<AlertAnswers>) => Promise<void>) | null = null;
let lastInitialAnswers: Partial<AlertAnswers> | null = null;
jest.mock('@/shared/wizard', () => ({
  WizardScreen: ({ flow, onComplete, initialAnswers }: never) => {
    const f = flow as { phases: { steps: { id: string }[] }[] };
    lastFlowStepIds = f.phases.flatMap((phase) => phase.steps).map((step) => step.id);
    lastOnComplete = onComplete;
    lastInitialAnswers = initialAnswers;
    return null;
  },
}));

jest.mock('@/shared/ui', () => {
  const { Text, Pressable } = jest.requireActual('react-native');
  return {
    useToast: () => ({ show: jest.fn() }),
    FullscreenLoader: ({ message }: { message?: string }) => <Text>{message}</Text>,
    ErrorState: ({ title }: { title?: string }) => <Text>{title}</Text>,
    EmptyState: ({ title }: { title?: string }) => <Text>{title}</Text>,
    Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    CardSelectMulti: ({
      options,
      value,
      onChange,
    }: {
      options: { value: string; label: string; locked?: boolean }[];
      value: string[];
      onChange: (next: string[]) => void;
    }) => (
      <>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityLabel={option.label}
            accessibilityState={{ checked: option.locked || value.includes(option.value) }}
            onPress={() =>
              option.locked
                ? undefined
                : onChange(
                    value.includes(option.value)
                      ? value.filter((v) => v !== option.value)
                      : [...value, option.value],
                  )
            }
          >
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </>
    ),
  };
});

/** Everything a completed wizard would hand back, so each test only has to say
 *  which of it should SURVIVE the matcher reduction. */
const FULL_ANSWERS: Partial<AlertAnswers> = {
  location: { latitude: 51.5, longitude: -0.13 },
  radiusMiles: 10,
  approximate: true,
  name: 'Home',
  make: 'BMW',
  model: '320d',
  colour: 'Blue',
  bodyType: 'saloon',
  minBountyPence: 50000,
  recencyDays: 7,
};

const savedRow = { approximate: true };

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertsState = { status: 'ready', alerts: [], refresh: jest.fn() };
  mockCentreState = { status: 'ready', centre: null };
  lastCentreEnabled = undefined;
  lastFlowStepIds = [];
  lastOnComplete = null;
  lastInitialAnswers = null;
  mockCreateAlert.mockResolvedValue(savedRow);
  mockUpdateAlert.mockResolvedValue(savedRow);
});

/** Tick the named cards, then commit the picker. */
async function choose(screen: ReturnType<typeof render> extends Promise<infer R> ? R : never, labels: string[]) {
  for (const label of labels) {
    await act(async () => {
      fireEvent.press(screen.getByLabelText(label));
    });
  }
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Next'));
  });
}

describe('the matcher picker', () => {
  it('opens on the picker, not the wizard', async () => {
    const screen = await render(<AlertWizardScreen />);
    expect(screen.getByText('What should this alert match?')).toBeTruthy();
    expect(lastOnComplete).toBeNull();
  });

  it('shows the area card locked on, so the constraint is stated not hidden', async () => {
    const screen = await render(<AlertWizardScreen />);
    expect(screen.getByLabelText('An area').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('builds a two-step flow when nothing extra is ticked', async () => {
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);
    expect(lastFlowStepIds).toEqual(['area', 'name']);
  });

  it('builds the car step only when the car card is ticked', async () => {
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, ['A specific car']);
    expect(lastFlowStepIds).toEqual(['area', 'car', 'name']);
  });

  it('builds both criteria steps when both are ticked', async () => {
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, ['A specific car', 'A minimum bounty']);
    expect(lastFlowStepIds).toEqual(['area', 'car', 'filters', 'name']);
  });
});

describe('saving', () => {
  it('sends only the criteria whose cards were ticked', async () => {
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, ['A specific car']);

    await act(async () => {
      await lastOnComplete?.(FULL_ANSWERS);
    });

    expect(mockCreateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Home',
        radiusMiles: 10,
        criteria: {
          make: 'BMW',
          model: '320d',
          colour: 'Blue',
          bodyType: 'saloon',
          // Untouched cards must widen the alert, never leave a live filter.
          minBountyPence: null,
          recencyDays: null,
        },
      }),
    );
  });

  it('saves "any car" when only the area was ticked, even though the answers hold a car', async () => {
    // The exact shape of the bug this guards: the user tried a filter, changed
    // their mind at the picker, and the answers still carry it.
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);

    await act(async () => {
      await lastOnComplete?.(FULL_ANSWERS);
    });

    expect(mockCreateAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: {
          make: null,
          model: null,
          colour: null,
          bodyType: null,
          minBountyPence: null,
          recencyDays: null,
        },
      }),
    );
  });

  it('refuses to save without an area rather than writing a corrupt row', async () => {
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);

    await act(async () => {
      await expect(lastOnComplete?.({ ...FULL_ANSWERS, location: null })).rejects.toThrow(
        'Pick an area',
      );
    });
    expect(mockCreateAlert).not.toHaveBeenCalled();
  });
});

describe('the default map centre', () => {
  it('seeds a new alert with the resolved centre so the map opens there', async () => {
    mockCentreState = { status: 'ready', centre: { latitude: 53.48, longitude: -2.24 } };
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);

    // The wizard receives it as an answer, which is what LocationPicker reads
    // as initialLocation — and which also settles the area step.
    expect(lastInitialAnswers).toMatchObject({
      location: { latitude: 53.48, longitude: -2.24 },
      radiusMiles: 5,
    });
  });

  it('leaves location unset when nothing could be resolved', async () => {
    // The picker then shows its whole-UK view and the step stays un-settled,
    // exactly as it behaved before this feature.
    mockCentreState = { status: 'ready', centre: null };
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);
    expect(lastInitialAnswers?.location).toBeUndefined();
  });

  it('holds a loader instead of mounting the map before the centre lands', async () => {
    // LocationPicker reads initialLocation ONCE, on mount, so mounting early
    // would strand the map on the UK view for the whole step.
    mockCentreState = { status: 'resolving', centre: null };
    const screen = await render(<AlertWizardScreen />);
    await choose(screen, []);
    expect(screen.getByText('Finding your area')).toBeTruthy();
    expect(lastOnComplete).toBeNull();
  });

  it('does not resolve a centre at all when editing', async () => {
    // The saved alert already has a point; asking the device for one would be
    // a pointless permission read and GPS fix.
    mockAlertsState = {
      status: 'ready',
      alerts: [
        {
          id: 'alert-1',
          name: 'Home',
          latitude: 51.5,
          longitude: -0.13,
          radiusMiles: 10,
          enabled: true,
          approximate: true,
          criteria: {
            make: null,
            model: null,
            colour: null,
            bodyType: null,
            minBountyPence: null,
            recencyDays: null,
          },
          updatedAt: '2026-07-31T12:00:00Z',
        },
      ],
      refresh: jest.fn(),
    };
    await render(<AlertWizardScreen alertId="alert-1" />);
    expect(lastCentreEnabled).toBe(false);
  });
});

describe('editing', () => {
  const existing = {
    id: 'alert-1',
    name: 'Blue BMWs',
    latitude: 51.5,
    longitude: -0.13,
    radiusMiles: 10,
    enabled: true,
    approximate: true,
    criteria: {
      make: 'BMW',
      model: null,
      colour: 'Blue',
      bodyType: null,
      minBountyPence: null,
      recencyDays: null,
    },
    updatedAt: '2026-07-31T12:00:00Z',
  };

  it('pre-ticks the cards the saved alert already answers', async () => {
    mockAlertsState = { status: 'ready', alerts: [existing], refresh: jest.fn() };
    const screen = await render(<AlertWizardScreen alertId="alert-1" />);

    expect(screen.getByLabelText('A specific car').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByLabelText('A minimum bounty').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('re-opens the car step so the saved criteria are editable', async () => {
    mockAlertsState = { status: 'ready', alerts: [existing], refresh: jest.fn() };
    const screen = await render(<AlertWizardScreen alertId="alert-1" />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Continue'));
    });
    expect(lastFlowStepIds).toEqual(['area', 'car', 'name']);
  });

  it('lets an edit REMOVE a criterion the alert had', async () => {
    mockAlertsState = { status: 'ready', alerts: [existing], refresh: jest.fn() };
    const screen = await render(<AlertWizardScreen alertId="alert-1" />);

    // Untick the card the alert was saved with, then finish.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('A specific car'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Continue'));
    });
    await act(async () => {
      await lastOnComplete?.(FULL_ANSWERS);
    });

    expect(mockUpdateAlert).toHaveBeenCalledWith(
      'alert-1',
      expect.objectContaining({
        criteria: expect.objectContaining({ make: null, colour: null }),
      }),
    );
  });

  it('holds a loader rather than mounting the picker on a blank alert', async () => {
    // A full replace: picking matchers from an alert that hasn't arrived would
    // offer to erase criteria the user cannot see.
    mockAlertsState = { status: 'loading', refresh: jest.fn() };
    const screen = await render(<AlertWizardScreen alertId="alert-1" />);
    expect(screen.getByText('Loading your alert')).toBeTruthy();
    expect(screen.queryByText('What should this alert match?')).toBeNull();
  });
});
