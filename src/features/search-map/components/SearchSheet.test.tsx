/**
 * WHAT:  Tests for SearchSheet — the footer count label + apply, the
 *        no-results guidance, assembling criteria (a suggestion sets the make),
 *        the bounty quick chip, and Clear all. Heavy children (the pickers, the
 *        range slider) and the live-count hook are mocked at the boundary,
 *        plus the MORPH close path (opened from a pill rect).
 * WHY:   The surface is where a whole query is assembled then applied once; a
 *        wiring slip would apply the wrong criteria or a stale count. The morph
 *        tests exist because the reanimated mock used to drop withSpring's
 *        completion callback AND no test ever passed a sourceRect — so the
 *        animated close branch had zero coverage, and shipped both unanimated
 *        (from the map) and wedge-on-interrupt.
 * LINKS: src/features/search-map/components/SearchSheet.tsx.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { SearchSheet } from './SearchSheet';
import { emptyCriteria, SEARCH_BOUNTY_MIN_PENCE } from '../lib/searchCriteria';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { useRef } = require('react');
  const builder = () => {
    const chain: Record<string, unknown> = {};
    chain.duration = () => chain;
    chain.reduceMotion = () => chain;
    return chain;
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    FadeIn: builder(),
    LinearTransition: builder(),
    ReduceMotion: { System: 'system' },
    Extrapolation: { CLAMP: 'clamp' },
    // motionEasing.ts evaluates Easing.out(Easing.cubic) at module scope, so a
    // mock missing this throws on import rather than failing a test.
    Easing: {
      out: (easing: unknown) => easing,
      cubic: (t: number) => t * t * t,
      linear: (t: number) => t,
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => useRef({ value: initial }).current,
    useAnimatedStyle: () => ({}),
    // Captures the completion callback instead of dropping it. The previous
    // mock was `(value) => value`, which silently discarded the third
    // argument — and that callback is the ONLY thing that ever calls onClose
    // on the morph path, so every "closes" test here was really exercising the
    // no-sourceRect branch. Tests drive the settle explicitly via
    // flushAnimations(), which is what lets us assert that onClose is deferred
    // until the animation finishes rather than fired on press.
    withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
      if (callback) {
        mockAnimationCallbacks.push(callback);
      }
      return value;
    },
    // A REAL clamped linear interpolation. The old mock returned output[0]
    // regardless of input, so it agreed with any implementation — including one
    // that had no clamping at all.
    interpolate: (value: number, input: number[], output: number[], extrapolation?: string) => {
      const [inMin, inMax] = [input[0], input[input.length - 1]];
      const [outMin, outMax] = [output[0], output[output.length - 1]];
      const ratio = inMax === inMin ? 0 : (value - inMin) / (inMax - inMin);
      const clamped = extrapolation === 'clamp' ? Math.min(1, Math.max(0, ratio)) : ratio;
      return outMin + clamped * (outMax - outMin);
    },
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
  };
});

// `var` (not const/let): jest hoists the mock factory above this file's own
// module-scope initialisation, and only a var binding exists — as undefined —
// when the factory is defined. It is dereferenced solely at CALL time, by
// which point the assignment below has run.
// eslint-disable-next-line no-var
var mockAnimationCallbacks: ((finished: boolean) => void)[] = [];

/** Settle every in-flight animation. `finished` false = interrupted mid-flight. */
function flushAnimations(finished = true) {
  const pending = mockAnimationCallbacks.splice(0);
  pending.forEach((callback) => callback(finished));
}

beforeEach(() => {
  mockAnimationCallbacks.length = 0;
});

// The pickers pull the full SelectScreen/native graph — stub the whole
// vehicles feature barrel to just the two fields SearchSheet imports.
jest.mock('@/features/vehicles', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text } = require('react-native');
  return {
    MakeField: ({ value }: { value: string | null }) =>
      React.createElement(Text, null, `make:${value ?? 'none'}`),
    ModelField: ({ value }: { value: string | null }) =>
      React.createElement(Text, null, `model:${value ?? 'none'}`),
    // The REAL vocabularies (the whole point of the 2026-08-10 change is that
    // the sheet stopped hard-coding its own six colours), but only the shape
    // the sheet reads. Kept small and literal so this mock states its own
    // expectations rather than importing the modules it is standing in for.
    CAR_COLOURS: [
      { name: 'Black', hex: '#1A1A1A' },
      { name: 'Blue', hex: '#2B4C7E' },
      { name: 'Green', hex: '#1F5F3F' },
      { name: 'Other', hex: '#8A8F94' },
    ],
    BODY_TYPE_OPTIONS: [
      { value: 'Hatchback', label: 'Hatchback' },
      { value: 'SUV', label: 'SUV / 4×4' },
      { value: 'Coupé', label: 'Coupé' },
      { value: 'unknown', label: 'Not sure' },
    ],
    BODY_TYPE_UNKNOWN: 'unknown',
  };
});

// Stub TextField + MoneyRangeSlider; keep the real (pure) ChoiceChips.
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { TextInput, Text } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { ChoiceChips } = require('@/shared/ui/ChoiceChips');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Button } = require('@/shared/ui/Button');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { ChoiceChipsMulti } = require('@/shared/ui/ChoiceChipsMulti');
  return {
    UK_DEFAULT_REGION: { latitude: 54.5, longitude: -2.5, latitudeDelta: 9, longitudeDelta: 9 },
    ChoiceChips,
    // The REAL multi-select: it is pure UI (same as ChoiceChips), and the
    // colour/body-type filters are the change under test — stubbing it would
    // leave the toggle wiring unverified.
    ChoiceChipsMulti,
    Button,
    // Stubbed: the real one pulls gesture-handler + reanimated worklets. Kept
    // DRIVABLE (press to emit a value) so the wiring is still exercised.
    RadiusSlider: ({ valueMiles, onChangeMiles, testID }: Record<string, unknown>) =>
      React.createElement(
        Text,
        // CallableFunction, not `(miles: number) => void`: babel's jest.mock
        // scope check reads a named parameter in a type annotation as an
        // out-of-scope variable and refuses to compile the factory.
        { testID, onPress: () => (onChangeMiles as CallableFunction)(25) },
        `radius:${valueMiles}`,
      ),
    TextField: ({ value, onChangeText, testID }: Record<string, unknown>) =>
      React.createElement(TextInput, { testID, value, onChangeText }),
    MoneyRangeSlider: () => React.createElement(Text, null, 'range-slider'),
  };
});

// SeenRangeFields → DateTimeField → BottomSheet (gorhom) drags a native graph
// this suite's partial reanimated mock cannot satisfy. Stubbed at the boundary,
// like MakeField/ModelField and RadiusSlider above; the range control's own
// behaviour is covered by SeenRangeFields.test.tsx.
jest.mock('./SeenRangeFields', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text } = require('react-native');
  return {
    SeenRangeFields: ({ from, to, onChange }: Record<string, unknown>) =>
      React.createElement(
        Text,
        {
          testID: 'seen-range',
          // Drivable, so the preset-vs-range exclusion is actually exercised.
          onPress: () =>
            (onChange as CallableFunction)({
              seenFrom: '2026-05-01T00:00:00.000Z',
              seenTo: '2026-05-10T00:00:00.000Z',
            }),
        },
        `range:${from ?? 'none'}..${to ?? 'none'}`,
      ),
  };
});

let mockCountState = { count: 5 as number | null, counting: false };
jest.mock('../hooks/useSearchCount', () => ({
  useSearchCount: () => mockCountState,
}));

const REGION = { latitude: 51.77, longitude: -0.34, latitudeDelta: 0.5, longitudeDelta: 0.5 };

async function renderSheet(
  onApply = jest.fn(),
  onClose = jest.fn(),
  initialCriteria = emptyCriteria(),
) {
  const view = await render(
    <SearchSheet
      initialCriteria={initialCriteria}
      region={REGION}
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { view, onApply, onClose };
}

/** The primary apply CTA (shared Button — matched by its dynamic label). */
const applyButton = (view: Awaited<ReturnType<typeof render>>) =>
  view.getByRole('button', { name: /^(Show|No cars match|Searching)/ });

beforeEach(() => {
  mockCountState = { count: 5, counting: false };
});

describe('SearchSheet footer', () => {
  it('shows the live count on the apply button and applies criteria + region', async () => {
    const { view, onApply } = await renderSheet();
    expect(view.getByText('Show 5 cars')).toBeTruthy();

    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    const [criteria, region] = onApply.mock.calls[0];
    expect(criteria).toMatchObject({ text: '', make: null });
    // "Any" distance keeps the current view (no teleport).
    expect(region).toMatchObject({ latitude: 51.77, longitude: -0.34 });
  });

  it('shows a spinner on the apply button while a count is in flight', async () => {
    mockCountState = { count: 3, counting: true };
    const { view } = await renderSheet();
    // The shared Button reports `busy` while loading.
    expect(applyButton(view).props.accessibilityState).toMatchObject({ busy: true });
  });

  it('shows guidance and disables apply when nothing matches', async () => {
    mockCountState = { count: 0, counting: false };
    const { view, onApply } = await renderSheet();

    expect(view.getByText(/try widening the bounty or distance/)).toBeTruthy();
    expect(applyButton(view).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('assembling criteria', () => {
  it('the £500+ quick chip sets the bounty floor', async () => {
    const { view, onApply } = await renderSheet();
    // Bounty is a collapsed accordion card — expand it to reach the chip.
    await act(async () => {
      fireEvent.press(view.getByTestId('section-bounty'));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('£500+'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    const [criteria] = onApply.mock.calls[0];
    expect(criteria.bountyMinPence).toBe(50000);
  });

  it('Clear all resets the assembled criteria', async () => {
    const { view, onApply } = await renderSheet();
    // Set a facet, then Clear all should reset it.
    await act(async () => {
      fireEvent.press(view.getByTestId('section-bounty'));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('£500+'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('search-clear-all'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    const [criteria] = onApply.mock.calls[0];
    // The FLOOR, not a literal. "Clear all" means "any bounty", and the only
    // value that means that is the one equal to the post floor — a hard-coded
    // 5000 here kept passing after the floor moved to £10, while the filter it
    // described had silently started excluding every £10–£49 listing.
    expect(criteria.bountyMinPence).toBe(SEARCH_BOUNTY_MIN_PENCE);
  });

  it('closes without applying via the ×', async () => {
    const { view, onApply, onClose } = await renderSheet();
    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('the change-area row', () => {
  // Location moved HERE on 2026-08-06 so every feed section chevron could mean
  // "see this on the map". If this row disappears there is NO way to change
  // your feed area once one is set — the primer only shows when none is.
  it('shows the current area and opens the picker', async () => {
    const onChangeArea = jest.fn();
    const view = await render(
      <SearchSheet
        initialCriteria={emptyCriteria()}
        region={REGION}
        onApply={jest.fn()}
        onClose={jest.fn()}
        areaLabel="St Albans"
        onChangeArea={onChangeArea}
      />,
    );

    expect(view.getByText('St Albans')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('search-change-area'));
    });
    expect(onChangeArea).toHaveBeenCalledTimes(1);
  });

  it('is absent when browsing nationally (no area to change)', async () => {
    const { view } = await renderSheet();

    expect(view.queryByTestId('search-change-area')).toBeNull();
  });
});

describe('the When filter', () => {
  it('shows the date range straight away — nothing to discover first', async () => {
    const { view } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByTestId('section-when'));
    });

    expect(view.getByTestId('seen-range')).toBeTruthy();
    // No "Custom range" chip to find: the fields are simply there.
    expect(view.queryByText('Custom range')).toBeNull();
  });

  it('a preset and a range are NEVER both active', async () => {
    const { view, onApply } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByTestId('section-when'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Last 7 days'));
    });
    // Now pick dates — the preset must give way.
    await act(async () => {
      fireEvent.press(view.getByTestId('seen-range'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });

    // The server ANDs recency_days with the window, so a state holding both
    // would silently intersect them and return fewer cars than either control
    // claims — with both showing as active.
    const [withRange] = onApply.mock.calls[0];
    expect(withRange.recencyDays).toBeNull();
    expect(withRange.seenFrom).not.toBeNull();
    expect(withRange.seenTo).not.toBeNull();

    // ...and back the other way.
    await act(async () => {
      fireEvent.press(view.getByText('Last 3 days'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    const [withPreset] = onApply.mock.calls[1];
    expect(withPreset.recencyDays).toBe(3);
    expect(withPreset.seenFrom).toBeNull();
    expect(withPreset.seenTo).toBeNull();
  });

  it('"Any time" is the way OUT of a date range', async () => {
    // DateTimeField's onChange is non-nullable and it has no clear affordance,
    // so without this chip a range would be a state the user cannot escape.
    const { view, onApply } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByTestId('section-when'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('seen-range'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Any time'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });

    const [applied] = onApply.mock.calls[0];
    expect(applied.seenFrom).toBeNull();
    expect(applied.seenTo).toBeNull();
    expect(applied.recencyDays).toBeNull();
  });
});

describe('the widened filters', () => {
  it('offers the FULL colour vocabulary, not a hand-picked few', async () => {
    const { view } = await renderSheet();

    // The whole point of the change: Green used to be unreachable because the
    // sheet hard-coded six popular colours of the app's fifteen.
    expect(view.getByText('Green')).toBeTruthy();
    // The "Other" escape is INCLUDED — a post whose colour is Other is
    // otherwise unfindable. (Body type's "Not sure" is excluded instead; see
    // the next test.)
    expect(view.getByText('Other')).toBeTruthy();
    // No "Any" CHECKBOX: in a multi-select, "any" IS the empty selection, and
    // an "Any" entry inside a checkbox group is a role mismatch. Scoped by
    // role, not text — the bounty section legitimately offers an "Any" radio
    // and the collapsed cards summarise as "Any".
    expect(view.queryAllByRole('checkbox', { name: 'Any' })).toEqual([]);
  });

  it('offers body types but NEVER "Not sure"', async () => {
    const { view } = await renderSheet();

    expect(view.getByText('Coupé')).toBeTruthy();
    // Filtering on "Not sure" would find only the owners who shrugged, which
    // is not a body type — the same exclusion the alert wizard makes.
    expect(view.queryByText('Not sure')).toBeNull();
  });

  it('applies several colours at once', async () => {
    const { view, onApply } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByText('Black'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Blue'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });

    const [applied] = onApply.mock.calls[0];
    expect(applied.colours).toEqual(['Black', 'Blue']);
  });

  it('applies a body type without disturbing the colours', async () => {
    const { view, onApply } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByText('SUV / 4×4'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });

    const [applied] = onApply.mock.calls[0];
    expect(applied.bodyTypes).toEqual(['SUV']);
    expect(applied.colours).toEqual([]);
  });

  it('has NO free-text box — the make/model pickers ask that question', async () => {
    // Removed 2026-08-10: a text field beside the pickers was a second, fuzzier
    // route to the same answer. `criteria.text` survives in the model and the
    // RPC still accepts it; nothing on this surface writes it.
    const { view } = await renderSheet();

    expect(view.queryByTestId('search-text')).toBeNull();
  });

  it('drives distance from the slider, and "Any distance" clears it', async () => {
    const { view, onApply } = await renderSheet();

    await act(async () => {
      fireEvent.press(view.getByTestId('section-distance'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('search-distance')); // stub emits 25
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply.mock.calls[0][0].distanceMiles).toBe(25);

    await act(async () => {
      fireEvent.press(view.getByText('Any distance'));
    });
    await act(async () => {
      fireEvent.press(applyButton(view));
    });
    expect(onApply.mock.calls[1][0].distanceMiles).toBeNull();
  });

  it('says the radius is measured from the AREA, never from the user', async () => {
    // The radius is always measured from the bbox centre, which follows every
    // pan — so "of you" would be false the moment the map moved off the user.
    const { view } = await renderSheet(jest.fn(), jest.fn(), {
      ...emptyCriteria(),
      distanceMiles: 10,
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('section-distance'));
    });

    expect(view.getByText(/within 10 miles of this area/)).toBeTruthy();
    expect(view.queryByText(/miles of you/)).toBeNull();
  });
});

/**
 * The morph path — opened FROM a measured pill rect, so dismissing plays the
 * reverse animation before unmounting. Every test above runs the other branch
 * (no sourceRect → instant close), which is why an unanimated close and a
 * wedge-on-interrupt both shipped unnoticed.
 */
describe('closing the morph', () => {
  const PILL_RECT = { x: 16, y: 60, width: 320, height: 48 };

  async function renderMorph() {
    const onClose = jest.fn();
    const view = await render(
      <SearchSheet
        initialCriteria={emptyCriteria()}
        region={REGION}
        sourceRect={PILL_RECT}
        onApply={jest.fn()}
        onClose={onClose}
      />,
    );
    return { view, onClose };
  }

  it('defers the unmount until the reverse animation settles', async () => {
    const { view, onClose } = await renderMorph();

    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    // Unmounting on press would cut the animation off at frame one — the whole
    // point of the morph is that the surface is still on screen shrinking.
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      flushAnimations();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still closes when the animation is INTERRUPTED mid-flight', async () => {
    const { view, onClose } = await renderMorph();

    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    // finished === false: another animation took the value over. This used to
    // reset the latch and leave the surface parked at partial progress —
    // visually stuck, and dismissable only by pressing × a second time.
    await act(async () => {
      flushAnimations(false);
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClose twice when × is pressed repeatedly', async () => {
    const { view, onClose } = await renderMorph();

    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('search-close'));
    });
    // One pending animation, not two: the second press hit the closing latch.
    await act(async () => {
      flushAnimations();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
