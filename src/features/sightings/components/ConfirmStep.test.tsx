/**
 * WHAT:  Tests for ConfirmStep, the report flow's "Check and send" (2026-10-02
 *        redesign): the four sections, each Edit link's target (and none on
 *        Where and when), links gone on a spur and inert while sending, the
 *        full-screen photo preview, the location lines (approximate, no
 *        area, no fix), the time from the first LIVE photo, the car card, the
 *        "What you saw" rows (the damage seen, and its own row and Edit; what's
 *        missing, with its own row and Edit) and
 *        their empty state, and the "Library" badge
 *        (moved here from sightingSteps.test.tsx).
 * WHY:   This is the spotter's last look before the owner sees it. A wrong
 *        Edit target strands them on the wrong step; an Edit on the location
 *        would invite "fixing" the evidence; a missing badge passes a library
 *        photo off as a live capture (ADR-0003); a stale or wrong time
 *        misleads the owner about when the car was there.
 * LINKS: src/features/sightings/components/ConfirmStep.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render, within } from '@testing-library/react-native';

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

  it('sends each Edit to its own step — one per answer — and offers none on Where and when', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible'],
      peoplePresence: 'nobody',
      note: 'By the bins',
    });
    await press(view.getByRole('button', { name: 'Edit photos' }));
    expect(editStep).toHaveBeenLastCalledWith('photos');
    for (const [name, stepId] of [
      ['Edit: What it was doing', 'state'],
      ['Edit: Anyone in or near it', 'people'],
      ['Edit: Its condition', 'condition'],
      ['Edit: Your note', 'note'],
    ]) {
      await press(view.getByRole('button', { name }));
      expect(editStep).toHaveBeenLastCalledWith(stepId);
    }
    // Photos plus one per answer: the location is the evidence, never edited here.
    expect(view.getAllByRole('button', { name: /^Edit[ :]/ })).toHaveLength(5);
  });

  it('"Add details" opens the first question with nothing stored', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked'],
      parkedLikelihood: 'settled',
    });
    // One more line of the list: the question, then "Add" where an Edit goes.
    const add = view.getByTestId('confirm-add');
    expect(within(add).getByText('Anyone in or near it?')).toBeTruthy();
    expect(within(add).getByText('Add')).toBeTruthy();
    expect(view.queryByText('Add details')).toBeNull();
    await press(view.getByRole('button', { name: 'Add details: Anyone in or near it?' }));
    expect(editStep).toHaveBeenLastCalledWith('people');
  });

  it('offers "Anything else?" as the last line when there is no note yet', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['being_loaded', 'looks_intact'],
      peoplePresence: 'nobody',
    });
    expect(within(view.getByTestId('confirm-add')).getByText('Anything else?')).toBeTruthy();
    await press(view.getByRole('button', { name: 'Add details: Anything else?' }));
    expect(editStep).toHaveBeenLastCalledWith('note');
  });

  it('"Add details" reaches what damage once "Damage visible" is ticked', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible'],
      parkedLikelihood: 'settled',
      peoplePresence: 'nobody',
    });
    await press(view.getByRole('button', { name: 'Add details: What damage can you see?' }));
    expect(editStep).toHaveBeenLastCalledWith('damage');
  });

  it('their words about the damage edit on the damage step', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: ['smashed_window'],
      damageNote: 'Glass on the pavement',
    });
    await press(view.getByRole('button', { name: 'Edit: About the damage' }));
    expect(editStep).toHaveBeenLastCalledWith('damage');
    // Answered: "Add details" moves on past it.
    expect(
      view.queryByRole('button', { name: 'Add details: What damage can you see?' }),
    ).toBeNull();
  });

  it('"Add details" reaches what’s missing once "Missing panels or parts" is ticked', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible'],
      parkedLikelihood: 'settled',
      peoplePresence: 'nobody',
      damageKinds: ['missing_parts'],
    });
    await press(view.getByRole('button', { name: 'Add details: What’s missing?' }));
    expect(editStep).toHaveBeenLastCalledWith('parts');
  });

  it('⚠️ their words about what’s missing edit on the parts step', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: ['missing_parts'],
      missingParts: ['doors'],
      missingPartsNote: 'Both front doors',
    });
    await press(view.getByRole('button', { name: 'Edit: About what’s missing' }));
    expect(editStep).toHaveBeenLastCalledWith('parts');
    expect(view.queryByRole('button', { name: 'Add details: What’s missing?' })).toBeNull();
  });

  it('the parts themselves edit through the condition — they ride on its card', async () => {
    // No words: no block of their own. The condition's Edit carries on to
    // the damage step and on to the parts (follow-ups chain forward) — that
    // chain is pinned in reportSightingFlow.test.ts (editContinuesTo) and
    // useWizardController.test.tsx (forward only).
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: ['missing_parts'],
      missingParts: ['doors'],
    });
    expect(view.queryByRole('button', { name: 'Edit: About what’s missing' })).toBeNull();
    await press(view.getByRole('button', { name: 'Edit: Its condition' }));
    expect(editStep).toHaveBeenLastCalledWith('condition');
  });

  it('"Add details" offers a "Not sure" question again — it has no row, and they may now know', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked'],
      contextUnsure: ['staying'],
    });
    await press(view.getByRole('button', { name: 'Add details: Did it look like it was staying?' }));
    expect(editStep).toHaveBeenLastCalledWith('staying');
  });

  it('offers no "Add details" once every question is answered', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['being_loaded', 'looks_intact'],
      peoplePresence: 'nobody',
      note: 'By the bins',
    });
    expect(view.queryByRole('button', { name: /^Add details/ })).toBeNull();
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
    // No explainer under the map (owner, 2026-10-22).
    expect(view.queryByText(/so the owner can trust it/)).toBeNull();
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

  it('says what else the listing says: year · body type · finish, then the reward', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      reportedCar: { ...CAR, year: 2018, bodyType: 'Hatchback', finish: 'Metallic', rewardPence: 20000 },
    });
    expect(view.getByTestId('reported-car-details').props.children).toBe(
      '2018 · Hatchback · Metallic',
    );
    expect(view.getByText('£200 reward')).toBeTruthy();
  });

  it('shows only the parts the owner gave, and no reward line without one', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      reportedCar: { ...CAR, bodyType: 'Saloon' },
    });
    expect(view.getByTestId('reported-car-details').props.children).toBe('Saloon');
    expect(view.queryByTestId('reported-car-reward')).toBeNull();
    const bare = await renderConfirm({ photos: [live(0)], reportedCar: CAR });
    expect(bare.view.queryByTestId('reported-car-details')).toBeNull();
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
  it('shows each answer as the card they tapped, under its question — the note trimmed', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible'],
      parkedLikelihood: 'settled',
      peoplePresence: 'nobody',
      confirmableFeatures: [{ id: 'm1', description: 'Bee sticker' }],
      confirmedFeatureIds: ['m1'],
      note: '  By the bins  ',
    });
    for (const label of ['What it was doing', 'Anyone in or near it', 'Its condition']) {
      expect(view.getByText(label)).toBeTruthy();
    }
    // The card, with what it led to as a line on it — one stop, a statement.
    expect(view.getByTestId('confirm-card-state-parked').props.accessibilityLabel).toBe(
      'Parked. Looks parked up',
    );
    // A tick-any answer keeps its tick box; a single answer has none.
    expect(view.getByTestId('confirm-card-condition-damage_visible-check')).toBeTruthy();
    expect(view.queryByTestId('confirm-card-state-parked-check')).toBeNull();
    expect(view.getByTestId('confirm-card-people-nobody').props.accessibilityLabel).toBe(
      'No one seen',
    );
    expect(view.getByTestId('confirm-card-condition-damage_visible')).toBeTruthy();
    // The marks as the owner's photo rows; the note as their words.
    expect(view.getByText('Marks you could see')).toBeTruthy();
    expect(view.getByTestId('review-mark-m1')).toBeTruthy();
    expect(view.getByText('By the bins')).toBeTruthy();
  });

  it('⚠️ nothing here announces as a radio or checkbox — it shows, the Edit changes', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'damage_visible', 'plate_changed'],
      peoplePresence: 'nearby',
      damageKinds: ['smashed_window'],
      // The marks too: read-only photo rows, never checkboxes here.
      confirmableFeatures: [{ id: 'm1', description: 'Bee sticker' }],
      confirmedFeatureIds: ['m1'],
    });
    expect(view.getByTestId('review-mark-m1')).toBeTruthy();
    const answers = view.getByTestId('confirm-answer-condition');
    expect(within(answers).queryAllByRole('radio')).toHaveLength(0);
    expect(within(answers).queryAllByRole('checkbox')).toHaveLength(0);
    expect(view.queryAllByRole('radio')).toHaveLength(0);
    expect(view.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows two old state answers as two cards, and the old people flag as its card', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['parked', 'driving', 'people_nearby'],
    });
    expect(view.getByTestId('confirm-card-state-parked')).toBeTruthy();
    expect(view.getByTestId('confirm-card-state-driving')).toBeTruthy();
    expect(view.getByTestId('confirm-card-people-nearby').props.accessibilityLabel).toBe(
      'People nearby',
    );
  });

  it('puts the damage seen on the "Damage visible" card, and their words below', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: ['smashed_window', 'dents_scrapes'],
      damageNote: '  Glass on the pavement  ',
    });
    expect(view.getByText('Damage visible')).toBeTruthy();
    // A row each (owner, 2026-10-22) — not one comma line.
    const card = 'confirm-card-condition-damage_visible';
    expect(view.getByTestId(`${card}-item-0`)).toBeTruthy();
    expect(view.getByText('Smashed window')).toBeTruthy();
    expect(view.getByText('Dents or scrapes')).toBeTruthy();
    expect(view.queryByText('Smashed window, Dents or scrapes')).toBeNull();
    // Still one statement for a screen reader, the rows in it.
    expect(view.getByTestId(card).props.accessibilityLabel).toBe(
      'Damage visible. Smashed window. Dents or scrapes',
    );
    expect(view.getByText('About the damage')).toBeTruthy();
    expect(view.getByText('Glass on the pavement')).toBeTruthy();
  });

  it('names the missing parts in brackets on the card, and their words below', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: ['smashed_window', 'missing_parts'],
      missingParts: ['bumpers', 'doors'],
      missingPartsNote: ' Rear bumper on the pavement ',
    });
    const card = 'confirm-card-condition-damage_visible';
    // The parts as rows under "Missing panels or parts".
    expect(view.getByText('Missing panels or parts')).toBeTruthy();
    expect(view.getByTestId(`${card}-item-1-0`)).toBeTruthy();
    expect(view.getByText('Bumpers')).toBeTruthy();
    expect(view.getByText('Doors')).toBeTruthy();
    expect(view.getByTestId(card).props.accessibilityLabel).toBe(
      'Damage visible. Smashed window. Missing panels or parts: Bumpers, Doors',
    );
    expect(view.getByText('About what’s missing')).toBeTruthy();
    expect(view.getByText('Rear bumper on the pavement')).toBeTruthy();
  });

  it('shows everything ticked — six kinds and six parts — as rows, nothing cut', async () => {
    const { view } = await renderConfirm({
      photos: [live(0)],
      contextFlags: ['damage_visible'],
      damageKinds: [
        'smashed_window',
        'dents_scrapes',
        'broken_lights',
        'missing_wheels',
        'missing_parts',
        'fire_damage',
      ],
      missingParts: ['bumpers', 'bonnet', 'doors', 'lights', 'wing_mirrors', 'number_plates'],
    });
    const card = 'confirm-card-condition-damage_visible';
    for (let index = 0; index < 6; index += 1) {
      expect(view.getByTestId(`${card}-item-${index}`)).toBeTruthy();
    }
    for (let index = 0; index < 6; index += 1) {
      expect(view.getByTestId(`${card}-item-4-${index}`)).toBeTruthy();
    }
    // The tick box stays with the title.
    expect(view.getByTestId(`${card}-check`)).toBeTruthy();
  });

  it('says "Nothing added" with an Add link when the step was skipped', async () => {
    const { view, editStep } = await renderConfirm({
      photos: [live(0)],
      contextFlags: [],
      contextUnsure: ['state'],
    });
    expect(view.getByText('Nothing added')).toBeTruthy();
    // Only the photos' Edit — no answers, so no answer to edit.
    expect(view.getAllByRole('button', { name: /^Edit[ :]/ })).toHaveLength(1);
    // "Not sure" stored nothing, so Add starts from the first question again.
    await press(view.getByRole('button', { name: 'Add details: What was it doing?' }));
    expect(editStep).toHaveBeenCalledWith('state');
  });
});
