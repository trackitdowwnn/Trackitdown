/**
 * WHAT:  The step-body components for the post-a-car wizard — one per question
 *        screen (plate, car details, body type, features, photos, last-seen
 *        when/where, description, bounty). Each is a thin adapter binding a
 *        shared UI component to its slice of PostACarAnswers via setAnswers.
 *        (TheftContextStep is no longer a wizard step — it's kept here because
 *        the post-detail theft-context editor reuses it.)
 * WHY:   The framework renders the chrome (question, helper, footer, gating);
 *        these just render the input. Kept out of the flow config so the config
 *        stays a readable table of {question, schema, reviewValue}. The location
 *        step injects the real map (AppMap) + geocoding (expoLocationServices),
 *        exactly as the design system's embedded LocationPicker expects.
 * LINKS: src/features/vehicles/post/postACarFlow.tsx (wires these into steps);
 *        src/features/vehicles/post/types.ts (PostACarAnswers);
 *        src/shared/ui (TextField, ChoiceChips(Multi), PhotoGridPicker,
 *        DateTimeField, MoneySlider, LocationPicker); docs/DESIGN_SYSTEM.md.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BadgePoundSterling, Megaphone } from 'lucide-react-native';

import { reachAtChosen } from '../lib/bountyRecommendation';
import { useBountyGuidance } from '../hooks/useBountyGuidance';
import {
  BOUNTY_SNAP_STEPS,
  DEFAULT_BOUNTY_PENCE,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
} from '../lib/bountyBounds';
import { formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { useDefaultMapCentre } from '@/shared/lib/location/useDefaultMapCentre';
import {
  CardSelect,
  type CardSelectOption,
  ChoiceChips,
  DateTimeField,
  DEFAULT_DATE_TIME_PRESETS,
  defaultBountyPanelCopy,
  LocationPicker,
  MoneySlider,
  PhotoGridPicker,
  type PhotoTileStatus,
  StepSkipButton,
  TextField,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';
import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import type { WizardStepProps } from '@/shared/wizard';

import { BODY_TYPE_OPTIONS } from '../lib/bodyTypes';
import { colourChangePatch } from '@/shared/lib';
import { makeChangePatch } from '@/shared/lib/carModels';
import type { VehicleAnswers } from '../lib/vehicleSteps';
import type { PostACarAnswers, PricingMode } from '../types';
import { ColourField } from './ColourField';
import { DistinctiveFeaturesField } from './DistinctiveFeaturesField';
import { MakeField } from './MakeField';
import { ModelField } from './ModelField';
import { YearField } from './YearField';

type StepProps = WizardStepProps<PostACarAnswers>;

/**
 * Props for the seven VEHICLE-IDENTITY steps, which the garage reuses. Typed
 * against the narrow VehicleAnswers slice rather than the whole posting answers
 * object, so the compiler ENFORCES that they read and write only vehicle fields.
 * That is what makes the single widening cast in buildVehicleSteps sound, and it
 * is why these components can serve a flow (add-a-car) which has no last-seen,
 * theft-context or bounty fields at all.
 */
type VehicleStepProps = WizardStepProps<VehicleAnswers>;

/**
 * Bounty range and slider seed (pence) — re-exported from the ONE mirror, not restated. These
 * were literals here (£50–£5,000) until 2026-08-22, nine days after
 * 20260813120000 moved the floor to £10 in the database. Nothing errored: an
 * owner who could only offer £15 simply could not post, and no screen said why.
 */
// Re-exported for the wizard config and the editors, which have always
// imported them from here. `export ... from` creates no LOCAL binding, so
// what this file uses itself is imported above.
export {
  DEFAULT_BOUNTY_PENCE,
  MAX_BOUNTY_PENCE,
  MIN_BOUNTY_PENCE,
} from '../lib/bountyBounds';

/**
 * The two pricing modes (ADR-0014), as option cards.
 *
 * COPY RULES, and they are not decoration:
 *   * The fee card NAMES ITS PRICE. A payment option that hides its cost until
 *     the sheet opens is the pattern this product does not use — the final CTA
 *     already names the amount for the same reason.
 *   * The fee card says NON-REFUNDABLE, here, before any money moves. This step
 *     is the only pre-payment disclosure surface in the flow (there is no
 *     checkout screen), so if it is not said here it is not said in time.
 *   * Neither card judges the choice. The owner is a theft victim deciding what
 *     they can afford, and "get more attention" framing on the bounty card
 *     would price guilt into a bad day.
 */
const PRICING_OPTIONS: CardSelectOption<PricingMode>[] = [
  {
    value: 'bounty',
    label: 'Offer a reward',
    // The floor, from the ONE mirror — never a literal. This read "From £50"
    // until 2026-08-22, nine days after 20260813120000 moved it to £10, so the
    // card was quoting a price the database had stopped enforcing.
    description: `From ${formatPounds(MIN_BOUNTY_PENCE)}. Held securely and only paid if a spotter finds your car.`,
    icon: BadgePoundSterling,
  },
  {
    value: 'fee',
    label: `No reward — ${formatPounds(LISTING_FEE_PENCE)} to list`,
    description: 'A one-off fee, not refundable. Your car still reaches every nearby spotter.',
    icon: Megaphone,
  },
];

// StepSkipButton moved to shared/ui when the garage's plate and nickname steps
// needed the identical affordance — an optional step without one is a dead end.

export function MakeStep({ answers, setAnswers }: VehicleStepProps) {
  // Its own step (2026-07-23): the make picker earns a screen. Changing the
  // make clears any model chosen under the old make (the make→model
  // dependency) — makeChangePatch keeps the model only when the same make is
  // re-picked, so an Audi model never rides under a BMW.
  return (
    <MakeField
      value={answers.make ?? null}
      onChange={(make) => setAnswers(makeChangePatch(answers.make, make))}
    />
  );
}

export function ModelStep({ answers, setAnswers }: VehicleStepProps) {
  // Dependent on the make: the picker lists the chosen make's models (free text
  // for an unlisted/unseeded make). Empty make is guarded inside ModelField.
  return (
    <ModelField
      make={answers.make ?? ''}
      value={answers.model ?? null}
      onChange={(model) => setAnswers({ model })}
    />
  );
}

export function ColourStep({ answers, setAnswers }: VehicleStepProps) {
  // Its own step (2026-07-23): the swatch grid earns a screen. Switching to a
  // plain colour clears any wrapped/other note (colourChangePatch) so a note
  // never rides under a colour it doesn't describe.
  return (
    <ColourField
      value={answers.colour ?? null}
      note={answers.colourNote ?? ''}
      onChange={(colour) => setAnswers(colourChangePatch(colour))}
      onChangeNote={(colourNote) => setAnswers({ colourNote })}
    />
  );
}

export function YearStep({ answers, setAnswers }: VehicleStepProps) {
  return (
    <YearField value={answers.year ?? null} onChange={(year) => setAnswers({ year })} />
  );
}

export function DistinctiveFeaturesStep({ answers, setAnswers, onSkip }: VehicleStepProps) {
  // Owner-authored photo+description evidence pairs (the car is theirs, so
  // gallery upload is offered — the sightings camera-only rule doesn't apply).
  const marks = answers.distinctiveFeatures ?? [];
  return (
    <View>
      <DistinctiveFeaturesField
        value={marks}
        onChange={(distinctiveFeatures) => setAnswers({ distinctiveFeatures })}
      />
      {/* Optional step — a clear "move on with none" while the list is empty
          (once a mark is added the owner uses Next, so it hides). */}
      {marks.length === 0 ? (
        <StepSkipButton label="None to add" onPress={() => onSkip?.()} />
      ) : null}
    </View>
  );
}

/**
 * `status` is a plain passthrough to the grid's existing per-tile overlay.
 * Optional and typed purely in shared/ui vocabulary, so this step learns
 * nothing about WHY a tile might be busy — a wrapper that has its own reason
 * (the garage reads photos for a registration) supplies both the tiles and the
 * words. The posting wizard never passes it and is unchanged.
 */
export function PhotosStep({
  answers,
  setAnswers,
  status,
}: VehicleStepProps & { status?: Record<string, PhotoTileStatus> }) {
  return (
    <PhotoGridPicker
      photos={answers.photos ?? []}
      onChangePhotos={(photos) => setAnswers({ photos })}
      minPhotos={3}
      maxPhotos={6}
      status={status}
    />
  );
}

export function LastSeenWhenStep({ answers, setAnswers }: StepProps) {
  return (
    <DateTimeField
      label="Last seen"
      value={answers.lastSeenAt ?? null}
      onChange={(lastSeenAt) => setAnswers({ lastSeenAt })}
      presets={DEFAULT_DATE_TIME_PRESETS}
      placeholder="Pick when it was last seen"
    />
  );
}

export function LastSeenWhereStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  // Open the camera on the device rather than on the whole UK — most cars are
  // reported from near where they were taken. Only resolved when there is no
  // stored point yet, and it never blocks: if the chain finds nothing the map
  // opens on the UK view exactly as before.
  const defaultCentre = useDefaultMapCentre(answers.location == null);

  // The picker reads its opening region ONCE, on mount, so it must not mount
  // before the centre is known. surfaceSubtle, not a spinner — it is the same
  // colour the map card shows through while its own tiles load, so this reads
  // as the map arriving rather than as a separate loading state.
  if (defaultCentre.status === 'resolving') {
    return <View style={[styles.mapFrame, styles.mapFramePending]} />;
  }

  return (
    <View style={styles.mapFrame}>
      <LocationPicker
        MapComponent={AppMap}
        locationServices={expoLocationServices}
        // Feed the stored point back so returning here (Back / Edit) starts
        // SETTLED — otherwise the mount emits isSettled:false and wipes it.
        initialLocation={answers.location ?? null}
        // SAFETY: centre only, deliberately NOT initialLocation. Where a car
        // was last seen is a claim other people act on — it drives the alert
        // fan-out and the public map — so it must be a point the reporter
        // actually chose, not wherever they happened to open the wizard. Next
        // stays disabled until they commit one.
        initialCentre={defaultCentre.centre}
        onLocationChange={(value) => {
          if (!value.isSettled) {
            // Un-settle disables Next until the user commits a point again.
            setAnswers({ location: null });
          } else if (value.addressLabel) {
            // A resolved point: store it + the coarse grouping label for the
            // feed (posts.last_seen_area ≤ 80).
            setAnswers({
              location: {
                latitude: value.latitude,
                longitude: value.longitude,
                addressLabel: value.addressLabel,
              },
              lastSeenArea: value.addressLabel.slice(0, 80),
            });
          } else {
            // Settled but the label hasn't resolved yet (the mount emit on a
            // return, or offline): update the point but KEEP the previously
            // resolved label/area rather than blanking them.
            setAnswers({
              location: {
                latitude: value.latitude,
                longitude: value.longitude,
                addressLabel: answers.location?.addressLabel ?? '',
              },
            });
          }
        }}
      />
    </View>
  );
}

const STOLEN_FROM_OPTIONS = [
  { value: 'driveway', label: 'Driveway' },
  { value: 'street', label: 'Street' },
  { value: 'car_park', label: 'Car park' },
  { value: 'other', label: 'Other' },
] as const;

const KEYS_TAKEN_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Not sure' },
] as const;

export function TheftContextStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stack}>
      <ChoiceChips
        options={STOLEN_FROM_OPTIONS.map((option) => ({ ...option }))}
        value={answers.stolenFrom ?? null}
        onSelect={(stolenFrom) => setAnswers({ stolenFrom })}
      />
      <ChoiceChips
        options={KEYS_TAKEN_OPTIONS.map((option) => ({ ...option }))}
        value={answers.keysTaken ?? null}
        onSelect={(keysTaken) => setAnswers({ keysTaken })}
      />
      <TextField
        label="Anything about how it drives or sounds? (optional)"
        variant="multiline"
        placeholder="e.g. Rattles over bumps, exhaust blows"
        value={answers.descDrives ?? ''}
        onChangeText={(descDrives) => setAnswers({ descDrives })}
        maxLength={1000}
      />
    </View>
  );
}

export function BodyTypeStep({ answers, setAnswers }: VehicleStepProps) {
  return (
    <CardSelect
      options={BODY_TYPE_OPTIONS}
      value={answers.bodyType ?? null}
      onSelect={(bodyType) => setAnswers({ bodyType })}
    />
  );
}

/** Mirrors the flow's schema and `posts.desc_recognise`'s own CHECK. */
const DESC_MIN_CHARS = 20;
const DESC_MAX_CHARS = 1000;

export function DescriptionStep({ answers, setAnswers, onSkip }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const description = answers.descRecognise ?? '';
  // TWO different counts, because they answer two different questions.
  // The gate trims (so leading spaces cannot buy their way past the minimum,
  // matching the schema — a counter disagreeing with the button is worse than
  // no counter), while the cap does NOT, because `maxLength` acts on the raw
  // string: a field of 1000 characters ending in spaces must not read "997 /
  // 1000" while refusing further input.
  const meaningful = description.trim().length;
  const typed = description.length;
  const belowMinimum = meaningful < DESC_MIN_CHARS;
  const requirement = `at least ${DESC_MIN_CHARS} characters to continue`;

  return (
    <View style={styles.stack}>
      <TextField
        label="Description"
        variant="multiline"
        placeholder="Describe your car — anything that helps a spotter recognise it (marks, mods, wear, where it usually is)."
        value={description}
        onChangeText={(descRecognise) => setAnswers({ descRecognise })}
        maxLength={DESC_MAX_CHARS}
        // Says what is needed while it is needed, then just counts. Not an
        // `error`: nothing is wrong yet, they are simply still typing.
        helperText={
          belowMinimum
            ? `${typed} / ${DESC_MAX_CHARS} — ${requirement}`
            : `${typed} / ${DESC_MAX_CHARS}`
        }
        // A11y: helperText renders as a SIBLING of the input, so a screen
        // reader focused on the field would otherwise hear only "Description"
        // and never learn why Next is disabled. The hint rides on the input.
        accessibilityHint={belowMinimum ? requirement : undefined}
      />

      {/* Only while Next is unreachable. Once the description is long enough
          the owner uses Next, so offering to discard what they just wrote would
          be a trap sitting under the button they actually want. */}
      {belowMinimum ? (
        <StepSkipButton
          label="Skip for now"
          testID="description-skip"
          onPress={() => {
            // Clear rather than submit a fragment. "Skip" means no description,
            // and a stray "blue one" helps no spotter recognise the car while
            // still occupying the space where a real description would go.
            setAnswers({ descRecognise: '' });
            onSkip?.();
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The pricing choice: a reward, or the flat listing fee. Runs BEFORE the bounty
 * slider, which the flow then walks past entirely when 'fee' is chosen (the
 * wizard's `when` gating) — so an owner who wants no reward never sees a money
 * slider at all, which is the point of offering the option.
 */
export function PricingModeStep({ answers, setAnswers }: StepProps) {
  const onSelect = useCallback(
    (pricingMode: PricingMode) => setAnswers({ pricingMode }),
    [setAnswers],
  );

  return (
    <CardSelect options={PRICING_OPTIONS} value={answers.pricingMode ?? null} onSelect={onSelect} />
  );
}

export function BountyStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  // MoneySlider re-registers its drag gesture if the handler identity changes.
  const onChangePence = useCallback(
    (bountyAmountPence: number) => setAnswers({ bountyAmountPence }),
    [setAnswers],
  );
  const bountyPence = answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE;

  // WHY the reach line lives here and not inside MoneySlider: the slider is a
  // shared money control and must not learn what an alert or a spotter is. It
  // takes a finished sentence.
  //
  // The bounty step runs after when-where, so the coordinates are already in
  // `answers`. Null until that step resolves, which the hook handles.
  const { guidance, recommendation } = useBountyGuidance(
    answers.location?.latitude ?? null,
    answers.location?.longitude ?? null,
  );
  const reach = reachAtChosen(guidance.rungs, bountyPence);

  return (
    <View style={styles.bountyStep}>
      {/* THE GUIDANCE, above the slider so it is read BEFORE a number is
          chosen rather than judged after. Absent entirely when there is
          nothing honest to say — a quiet area, too few neighbours, no location
          yet — because a confident-looking range resting on two data points is
          worse than silence on a screen about someone's stolen car.

          ⚠️ THE COPY SAYS WHAT A BOUNTY REACHES, NEVER WHAT IT RECOVERS.
          Nothing in this payload measures outcomes. "Most owners near here"
          is a statement about other people's choices, not a prediction about
          this car. */}
      {recommendation ? (
        <View style={styles.bountyGuidance}>
          <Text style={styles.bountyGuidanceLead}>
            {recommendation.basis === 'reach'
              ? `Around ${formatPounds(recommendation.midPence)} reaches most spotters reporting near here`
              : `Most owners near here offer ${formatPounds(recommendation.lowPence)}–${formatPounds(recommendation.highPence)}`}
          </Text>
          <Pressable
            onPress={() => onChangePence(recommendation.midPence)}
            accessibilityRole="button"
            accessibilityLabel={`Use ${formatPounds(recommendation.midPence)}`}
            style={styles.bountyGuidanceAction}
            testID="bounty-use-suggested"
          >
            {/* A recommendation nobody can act on is friction: it names an
                amount and leaves the owner to hunt for it on a slider. Every
                value here is snapped to the slider's own grid, so this always
                lands exactly. */}
            <Text style={styles.bountyGuidanceActionText}>
              Use {formatPounds(recommendation.midPence)}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <MoneySlider
        label="Bounty"
        valuePence={bountyPence}
        onChangePence={onChangePence}
        minPence={MIN_BOUNTY_PENCE}
        maxPence={MAX_BOUNTY_PENCE}
        // £1 steps below £50, because the floor is £10. On the old £25 grid the
        // three cheapest selectable bounties would be £10, £25 and £50, which
        // leaves most of the newly-allowed range unreachable and the floor move
        // largely decorative.
        snapSteps={BOUNTY_SNAP_STEPS}
        panel={defaultBountyPanelCopy}
        // "Reaches", never "notifies". The count is zones matching TODAY; push
        // registration, the rolling daily cap and the per-post dedupe all sit
        // between it and a notification anyone receives. Null (too few to report,
        // or no location yet) renders nothing at all — an owner hours from a
        // theft must not be told "0 spotters are watching".
        footnote={
          reach === null
            ? undefined
            : `Reaches ${reach} ${reach === 1 ? 'spotter' : 'spotters'} watching this area`
        }
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  stack: {
    gap: spacing.xl,
  },
  bountyStep: {
    gap: spacing.lg,
  },
  // The guidance sits ABOVE the slider so it is read before a number is chosen,
  // not used to judge one afterwards. Quiet surface, not a card: it is context
  // for the control below it, not a thing in its own right.
  bountyGuidance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: c.surfaceSubtle,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bountyGuidanceLead: {
    ...typography.caption,
    color: c.textSecondary,
    flexShrink: 1,
  },
  bountyGuidanceAction: {
    minHeight: sizes.touchTarget,
    justifyContent: 'center',
  },
  bountyGuidanceActionText: {
    ...typography.label,
    color: c.primary,
    textDecorationLine: 'underline',
  },
  // The centred, underlined "advance without the main input" action (plate:
  // enter manually; marks: none to add), spaced beneath the step's input.
  skipLink: {
    alignSelf: 'center',
    marginTop: spacing.lg,
  },
  skipLinkPressed: {
    opacity: opacity.pressed,
  },
  skipText: {
    ...typography.label,
    color: c.primary,
    textDecorationLine: 'underline',
  },
  // Grows to fill a `fills` step (the posting wizard), so the map reaches the
  // footer instead of floating in a fixed card.
  //
  // minHeight is doing real work, not just guarding small screens: this step is
  // ALSO rendered by LastSeenEditor inside a plain ScrollView with no flexGrow,
  // where `flex: 1` has nothing to measure against. There the map falls back to
  // this floor — exactly the height it had before — so the editor is unchanged
  // while the wizard grows.
  mapFrame: {
    flex: 1,
    minHeight: sizes.mapPickerHeight,
  },
  // Holds the card's shape while the opening centre resolves, so the step does
  // not jump when the map arrives.
  mapFramePending: {
    borderRadius: radii.xl,
    backgroundColor: c.surfaceSubtle,
  },
});
