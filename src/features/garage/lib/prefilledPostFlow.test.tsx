/**
 * WHAT:  Tests for the prefilled posting flow — that a saved car collapses the
 *        seven-step vehicle phase to one confirm step, that every prefilled
 *        value is seeded into the answers AND remains editable via Edit, and
 *        that a car with too few photos keeps its real photos step.
 * WHY:   This is the feature's payoff and its riskiest promise. Two failures
 *        would be serious: a prefill that silently drops a field (the listing
 *        goes out wrong), or a prefill the owner cannot correct (a stolen car's
 *        details may need a last-minute fix). Both are asserted here. The
 *        photo-shortfall branch matters because create_post enforces 3–6 while
 *        the garage allows 0 — without it a sparse saved car would sail to the
 *        review screen and fail at submit.
 * LINKS: src/features/garage/lib/prefilledPostFlow.tsx, docs/TESTING.md.
 */

import type { WizardFlow } from '@/shared/wizard';

import type { SavedVehicle } from '../types';
import { buildPrefilledPostFlow } from './prefilledPostFlow';

jest.mock('../components/VehicleSummaryStep', () => ({ VehicleSummaryStep: () => null }));
jest.mock('@/features/vehicles', () => ({
  buildVehicleSteps: jest.requireActual('@/features/vehicles/post/lib/vehicleSteps')
    .buildVehicleSteps,
}));
jest.mock('@/features/vehicles/post/components/postSteps', () => ({
  MakeStep: () => null,
  ModelStep: () => null,
  ColourStep: () => null,
  BodyTypeStep: () => null,
  YearStep: () => null,
  DistinctiveFeaturesStep: () => null,
  PhotosStep: () => null,
}));

// A stand-in for postACarFlow with the phase shape that matters.
const baseFlow = {
  id: 'post-a-car',
  finalCtaLabel: 'Post & pay',
  review: {
    title: 'Check your report',
    // Stands in for ReviewListingPreview: the real one calls editStep('photos')
    // when its Edit is pressed. Calling it on render keeps the test synchronous
    // — what is under test is what the WRAPPER forwards, not the press.
    header: (_answers: unknown, editStep: (id: string | string[]) => void) => {
      editStep('photos');
      return null;
    },
  },
  phases: [
    {
      id: 'car',
      title: 'Your car',
      intro: { headline: 'Sorry this happened', body: '…' },
      steps: [
        { id: 'make', question: 'q', component: () => null, schema: { safeParse: () => ({ success: true }) } },
        { id: 'photos', question: 'q', component: () => null, schema: { safeParse: () => ({ success: true }) } },
      ],
    },
    {
      id: 'when-where',
      title: 'When and where',
      steps: [
        { id: 'last-seen-when', question: 'q', component: () => null, schema: { safeParse: () => ({ success: true }) } },
      ],
    },
  ],
} as unknown as WizardFlow<import('@/features/vehicles').PostACarAnswers>;

function vehicle(overrides: Partial<SavedVehicle> = {}): SavedVehicle {
  return {
    id: 'v1',
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: null,
    year: 2019,
    bodyType: 'Saloon',
    nickname: null,
    verificationState: 'unverified',
    photos: [0, 1, 2, 3].map((i) => ({ url: `https://x/post-photos/u1/${i}.jpg`, position: i })),
    distinctiveFeatures: [],
    isCurrentlyPosted: false,
    activePostId: null,
    createdAt: '2026-07-08T12:00:00Z',
    ...overrides,
  };
}

const build = (v: SavedVehicle, expanded = false) =>
  buildPrefilledPostFlow({
    baseFlow,
    baseInitialAnswers: { bountyAmountPence: 25000 },
    vehicle: v,
    expanded,
    onEdit: jest.fn(),
  });

const carPhase = (flow: WizardFlow<unknown>) => flow.phases.find((p) => p.id === 'car')!;

describe('collapsed vehicle phase', () => {
  it('replaces the whole car phase with ONE confirm step', () => {
    const { flow } = build(vehicle());

    expect(carPhase(flow).steps.map((s) => s.id)).toEqual(['vehicle-summary']);
  });

  it('keeps the confirm step to the question and the photo — no helper subtext', () => {
    // Product call 2026-07-29: explanatory subtext between the question and
    // the hero slowed the moment down. The Edit affordance (on the photo's
    // identity strip, bottom right) is the only other element.
    const step = carPhase(build(vehicle()).flow).steps[0];

    expect(step.question).toBe('Is this the car?');
    expect(step.helper).toBeUndefined();
  });

  it('drops the "Sorry this happened" intro — they came from their own garage', () => {
    const { flow } = build(vehicle());

    expect(carPhase(flow).intro).toBeUndefined();
  });

  it('leaves the theft phases untouched — those still have to be answered', () => {
    const { flow } = build(vehicle());

    expect(flow.phases.map((p) => p.id)).toEqual(['car', 'when-where']);
    expect(flow.phases[1].steps.map((s) => s.id)).toEqual(['last-seen-when']);
  });

  it('summarises the car on the review screen', () => {
    const { flow } = build(vehicle());
    const summary = carPhase(flow).steps[0];

    expect(summary.reviewValue?.({})).toBe('Blue BMW 320d · AB12 CDE · 4 photos');
  });

  it('never blocks: the confirm step always validates', () => {
    const { flow } = build(vehicle());

    expect(carPhase(flow).steps[0].schema.safeParse({}).success).toBe(true);
  });
});

describe('the review preview’s edit target', () => {
  // The base flow's preview offers an Edit that jumps to the `photos` step.
  // This composition DROPS that step whenever the saved car already has enough
  // photos — so hard-wired, the Edit silently did nothing. The wrapper appends
  // the confirm step as a fallback candidate.
  const targetFor = (v: SavedVehicle, expanded = false) => {
    const { flow } = build(v, expanded);
    let asked: string | string[] | undefined;
    flow.review?.header?.({}, (stepId) => {
      asked = stepId;
    });
    return asked;
  };

  it('⚠️ falls back to the confirm step when the photos step was dropped', () => {
    // Four photos — the photos step is gone.
    expect(targetFor(vehicle())).toEqual(['photos', 'vehicle-summary']);
  });

  it('still prefers the photos step when it survived', () => {
    // One photo — short of the three needed to post, so the step is kept, and
    // `photos` wins as the FIRST candidate.
    const short = vehicle({ photos: [{ url: 'https://x/a.jpg', position: 0 }] });
    const target = targetFor(short);

    expect(Array.isArray(target) ? target[0] : target).toBe('photos');
  });

  it('leaves the expanded flow’s header untouched', () => {
    // Expanded returns baseFlow verbatim: all seven steps are back, so `photos`
    // exists and needs no fallback.
    expect(targetFor(vehicle(), true)).toBe('photos');
  });
});

describe('prefilled answers', () => {
  it('seeds every identity field, on top of the flow’s own bounty seed', () => {
    const { initialAnswers } = build(vehicle());

    expect(initialAnswers).toMatchObject({
      make: 'BMW',
      model: '320d',
      colour: 'Blue',
      year: 2019,
      bodyType: 'Saloon',
      bountyAmountPence: 25000,
    });
    expect(initialAnswers.photos).toHaveLength(4);
  });

  it('carries the colour note through to the post', () => {
    const { initialAnswers } = build(
      vehicle({ colour: 'Multicolour / wrapped', colourNote: 'matte black wrap over silver' }),
    );

    expect(initialAnswers.colourNote).toBe('matte black wrap over silver');
  });
});

describe('Edit keeps every prefilled value changeable', () => {
  it('expanded restores the FULL flow with the same answers', () => {
    const v = vehicle();
    const collapsed = build(v, false);
    const expanded = build(v, true);

    // Full step list back, intro included — identical to posting from scratch...
    expect(carPhase(expanded.flow).steps.map((s) => s.id)).toEqual(['make', 'photos']);
    expect(carPhase(expanded.flow).intro).toBeDefined();
    // ...but still seeded, so nothing is retyped.
    expect(expanded.initialAnswers).toEqual(collapsed.initialAnswers);
  });
});

describe('photo shortfall', () => {
  it('KEEPS the real photos step when the saved car has fewer than 3', () => {
    const { flow } = build(vehicle({ photos: [{ url: 'https://x/0.jpg', position: 0 }] }));

    // Otherwise the wizard would reach review and fail at create_post's PHOTO_COUNT.
    expect(carPhase(flow).steps.map((s) => s.id)).toEqual(['vehicle-summary', 'photos']);
  });

  it('keeps it for a photo-less saved car too', () => {
    const { flow } = build(vehicle({ photos: [] }));

    expect(carPhase(flow).steps.map((s) => s.id)).toEqual(['vehicle-summary', 'photos']);
  });

  it('collapses fully at exactly 3 photos', () => {
    const photos = [0, 1, 2].map((i) => ({ url: `https://x/${i}.jpg`, position: i }));
    const { flow } = build(vehicle({ photos }));

    expect(carPhase(flow).steps.map((s) => s.id)).toEqual(['vehicle-summary']);
  });
});
