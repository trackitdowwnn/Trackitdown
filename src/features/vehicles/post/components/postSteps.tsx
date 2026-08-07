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
import { StyleSheet, View } from 'react-native';

import { useAlertReach } from '@/features/notifications';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { useDefaultMapCentre } from '@/shared/lib/location/useDefaultMapCentre';
import {
  CardSelect,
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
import { colors, opacity, radii, sizes, spacing, typography } from '@/shared/theme';
import type { WizardStepProps } from '@/shared/wizard';

import { BODY_TYPE_OPTIONS } from '../lib/bodyTypes';
import { colourChangePatch } from '../lib/carColours';
import { makeChangePatch } from '@/shared/lib/carModels';
import type { VehicleAnswers } from '../lib/vehicleSteps';
import type { PostACarAnswers } from '../types';
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

/** Bounty range (pence) — mirrors create_post + the posts CHECK (£50–£5,000). */
export const MIN_BOUNTY_PENCE = 5000;
export const MAX_BOUNTY_PENCE = 500000;
export const DEFAULT_BOUNTY_PENCE = 25000;

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

export function BountyStep({ answers, setAnswers }: StepProps) {
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
  const reach = useAlertReach(
    answers.location?.latitude ?? null,
    answers.location?.longitude ?? null,
    bountyPence,
  );

  return (
    <MoneySlider
      label="Bounty"
      valuePence={bountyPence}
      onChangePence={onChangePence}
      minPence={MIN_BOUNTY_PENCE}
      maxPence={MAX_BOUNTY_PENCE}
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
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xl,
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
    color: colors.primary,
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
    backgroundColor: colors.surfaceSubtle,
  },
});
