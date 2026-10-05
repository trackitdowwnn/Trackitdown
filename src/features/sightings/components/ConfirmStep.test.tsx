/**
 * WHAT:  Tests for ConfirmStep, the report flow's "Check and send" (2026-10-02
 *        redesign): the four sections, each Edit link's target (and none on
 *        Where and when), links gone on a spur and inert while sending, the
 *        full-screen photo preview, the location lines (approximate, no
 *        area, no fix), the time from the first LIVE photo, the car card, the
 *        "What you saw" rows and their empty state, and the "Library" badge
 *        (moved here from sightingSteps.test.tsx).
 * WHY:   This is the spotter's last look before the owner sees it. A wrong
 *        Edit target strands them on the wrong step; an Edit on the location
 *        would invite "fixing" the evidence; a missing badge passes a library
 *        photo off as a live capture (ADR-0003); a stale or wrong time
 *        misleads the owner about when the car was there.
 * LINKS: src/features/sightings/components/ConfirmStep.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { EvidencePhoto } from '@/shared/ui';

import type { ReportSightingAnswers } from '../types';
import { ConfirmStep } from './ConfirmStep';

// Load-boundary mocks: the @/shared/ui barrel pulls the camera, the image
// pipeline and gestures in, though this step renders none of them.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
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
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const live = (n: number, extra: Partial<EvidencePhoto> = {}): EvidencePhoto => ({
  uri: `file:///live-${n}.jpg`,
  capturedAt: minutesAgo(5),
  lat: 51.54,
  lng: -0.14,
  accuracyM: 8,
  source: 'live',
  ...extra,
});
const gallery = (n: number): EvidencePhoto => ({
  uri: `file:///library-${n}.jpg`,
  capturedAt: minutesAgo(0),
  source: 'gallery',
});

const CAR = {
  make: 'BMW',
  model: '3 Series',
  colour: 'Blue',
  plate: 'AB12 CDE',
  photoUrl: 'https://example.test/hero.jpg',
};

type View = Awaited<ReturnType<typeof render>>;

async function renderConfirm(
  answers: Partial<ReportSightingAnswers>,
  props: { editStep?: jest.Mock | null; busy?: boolean } = {},
) {
  const editStep = props.editStep === undefined ? jest.fn() : props.editStep;
  let view!: View;
  await act(async () => {
    view = await render(
      <ConfirmStep
        answers={answers}
        setAnswers={() => {}}
        editStep={editStep ?? undefined}
        busy={props.busy}
      />,
    );
  });
  return { view, editStep };
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await act(async () => {
    fireEvent.press(element);
  });
}

describe('ConfirmStep — sections and Edit links', () => {
  it('shows the four sections, the car first', async () => {
    const { view } = await renderConfirm({ photos: [live(0)], reportedCar: CAR });
    for (const title of ['You’re reporting', 'Photos', 'Where and when', 'What you saw']) {
      expect(view.getByRole('header', { name: title })).toBeTruthy();
    }
  });

  it('leaves the car section out when the seed is missing', async () => {
    const { view } = await renderConfirm({ photos: [live(0)] });
    expect(view.queryByRole('header', { name: 'You’re reporting' })).toBeNull();
  });

  it('sends each Edit to its step, and offers none on Where and when', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked'],
    });
    await press(view.getByRole('button', { name: 'Edit photos' }));
    expect(editStep).toHaveBeenLastCalledWith('photos');
    await press(view.getByRole('button', { name: 'Edit what you saw' }));
    expect(editStep).toHaveBeenLastCalledWith('context');
    // Exactly two: the location is the evidence, never edited here.
    expect(view.getAllByRole('button', { name: /^Edit / })).toHaveLength(2);
  });

  it('offers no links at all without editStep (on an edit spur)', async () => {
    const { view } = await renderConfirm({ photos: [live(0)] }, { editStep: null });
    expect(view.queryByRole('button', { name: /^(Edit|Add) / })).toBeNull();
  });

  it('goes inert while the report is sending', async () => {
    const { view, editStep } = await renderConfirm({ photos: [live(0)] }, { busy: true });
    const edit = view.getByRole('button', { name: 'Edit photos' });
    expect(edit.props.accessibilityState).toMatchObject({ disabled: true });
    await press(edit);
    expect(editStep).not.toHaveBeenCalled();
  });
});

describe('ConfirmStep — photos', () => {
  it('opens a photo full screen, and closes it', async () => {
    const { view } = await renderConfirm({ photos: [live(0), gallery(1)] });
    await press(view.getByRole('imagebutton', { name: 'Photo 2 of 2, from your library' }));
    expect(view.getByText('Photo 2 of 2')).toBeTruthy();
    await press(view.getByLabelText('Close preview'));
    expect(view.queryByText('Photo 2 of 2')).toBeNull();
  });

  it('badges a gallery photo "Library" — never presented as a live capture', async () => {
    const { view } = await renderConfirm({ photos: [live(0), gallery(1)] });
    // Exactly ONE badge — the live photo carries none.
    expect(view.getAllByText('Library')).toHaveLength(1);
  });

  it('shows no badge when every photo is a live capture', async () => {
    const { view } = await renderConfirm({ photos: [live(0), live(1)] });
    expect(view.queryByText('Library')).toBeNull();
  });
});

describe('ConfirmStep — where and when', () => {
  it('names the area, and the time from the first LIVE photo', async () => {
    const { view } = await renderConfirm({
      // A library photo first, added just now: its time is not when it was seen.
      photos: [gallery(0), live(1)],
      areaLabel: 'Camden High Street, London',
    });
    expect(view.getByText('Near Camden High Street, London')).toBeTruthy();
    expect(view.getByText('Photo taken 5m ago')).toBeTruthy();
    // Spoken in full: VoiceOver reads a bare "5m" as five metres.
    expect(view.getByLabelText('Photo taken 5 minutes ago')).toBeTruthy();
    expect(
      view.getByText('This comes from where you took the photo, so the owner can trust it.'),
    ).toBeTruthy();
    // Hidden from screen readers on purpose: the lines say it in words.
    expect(view.getByTestId('confirm-map', { includeHiddenElements: true })).toBeTruthy();
  });

  it('falls back to the spot when there is no area name', async () => {
    const { view } = await renderConfirm({ photos: [live(0)] });
    expect(view.getByText('At the spot you took the photo')).toBeTruthy();
  });

  it('says "Approximate location" only for a fix worse than 100 m', async () => {
    const coarse = await renderConfirm({ photos: [live(0, { accuracyM: 150 })] });
    expect(coarse.view.getByText('Approximate location')).toBeTruthy();
    const edge = await renderConfirm({ photos: [live(0, { accuracyM: 100 })] });
    expect(edge.view.queryByText('Approximate location')).toBeNull();
  });

  it('says so plainly when there is no location, with no map', async () => {
    const { view } = await renderConfirm({
      photos: [{ uri: 'file:///x.jpg', capturedAt: minutesAgo(5), source: 'live' }],
    });
    expect(view.getByText('No location on this report — your photos still help.')).toBeTruthy();
    expect(view.getByText('Photo taken 5m ago')).toBeTruthy();
    expect(view.queryByTestId('confirm-map', { includeHiddenElements: true })).toBeNull();
    expect(
      view.queryByText('This comes from where you took the photo, so the owner can trust it.'),
    ).toBeNull();
  });
});

describe('ConfirmStep — the car', () => {
  it('shows the car’s photo on top, then the plate and name on one line, plate first', async () => {
    const { view } = await renderConfirm({ photos: [live(0)], reportedCar: CAR });
    expect(view.getByText('Blue BMW 3 Series')).toBeTruthy();
    expect(view.getByLabelText('Plate A B 1 2, C D E')).toBeTruthy();
    // Screen order, read from the structure (not serialised text): the photo
    // is the card's first child, and on the line the plate comes before the name.
    const card = view.getByTestId('reported-car');
    expect(card.children[0]).toMatchObject({ props: { testID: 'reported-car-photo' } });
    const line = view.getByTestId('reported-car-line').children.filter(
      (child) => typeof child !== 'string',
    );
    // Host elements: the chip is matched by its spoken label.
    const plateAt = line.findIndex(
      (child) => child.props.accessibilityLabel === 'Plate A B 1 2, C D E',
    );
    const nameAt = line.findIndex((child) => child.props.children === 'Blue BMW 3 Series');
    expect(plateAt).toBe(0);
    expect(nameAt).toBe(1);
  });

  it('drops a photo that fails to load, rather than leaving a grey slab', async () => {
    const { view } = await renderConfirm({ photos: [live(0)], reportedCar: CAR });
    await act(async () => {
      // expo-image reads the native event's error before calling onError.
      fireEvent(view.getByTestId('reported-car-photo'), 'error', {
        nativeEvent: { error: 'HTTP 404' },
      });
    });
    expect(view.queryByTestId('reported-car-photo')).toBeNull();
    expect(view.getByText('Blue BMW 3 Series')).toBeTruthy();
  });

  it('copes with a plate-less, photo-less listing', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      reportedCar: { ...CAR, plate: null, photoUrl: undefined },
    });
    expect(view.getByText('Blue BMW 3 Series')).toBeTruthy();
    expect(view.queryByLabelText(/^Plate /)).toBeNull();
    expect(view.queryByTestId('reported-car-photo')).toBeNull();
  });
});

describe('ConfirmStep — what you saw', () => {
  it('lists every answer as a labelled row, the note trimmed', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible'],
      parkedLikelihood: 'settled',
      peoplePresence: 'nobody',
      confirmableFeatures: [{ id: 'm1', description: 'Bee sticker' }],
      confirmedFeatureIds: ['m1'],
      note: '  By the bins  ',
    });
    for (const [label, value] of [
      ['What it was doing', 'Parked · Looks parked up'],
      ['Anyone in or near it', 'No one seen'],
      ['Its condition', 'Damage visible'],
      ['Marks you could see', 'Bee sticker'],
      ['Your note', 'By the bins'],
    ]) {
      expect(view.getByText(label)).toBeTruthy();
      expect(view.getByText(value)).toBeTruthy();
    }
  });

  it('says "Nothing added" with an Add link when the step was skipped', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: [],
      contextUnsure: ['state'],
    });
    expect(view.getByText('Nothing added')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Edit what you saw' })).toBeNull();
    await press(view.getByRole('button', { name: 'Add what you saw' }));
    expect(editStep).toHaveBeenCalledWith('context');
  });
});
