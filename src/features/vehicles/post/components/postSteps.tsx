/**
 * WHAT:  The step-body components for the post-a-car wizard — one per question
 *        screen (plate, car details, features, photos, last-seen when/where,
 *        theft context, bounty, V5C). Each is a thin adapter binding a shared
 *        UI component to its slice of PostACarAnswers via setAnswers.
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

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import {
  ChoiceChips,
  DateTimeField,
  DEFAULT_DATE_TIME_PRESETS,
  defaultBountyPanelCopy,
  LocationPicker,
  MoneySlider,
  PhotoGridPicker,
  TextField,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';
import { colors, opacity, sizes, spacing, typography } from '@/shared/theme';
import type { WizardStepProps } from '@/shared/wizard';

import { colourChangePatch } from '../lib/carColours';
import { makeChangePatch } from '../lib/carModels';
import type { PostACarAnswers } from '../types';
import { ColourField } from './ColourField';
import { DistinctiveFeaturesField } from './DistinctiveFeaturesField';
import { MakeField } from './MakeField';
import { ModelField } from './ModelField';
import { YearField } from './YearField';

type StepProps = WizardStepProps<PostACarAnswers>;

/** Bounty range (pence) — mirrors create_post + the posts CHECK (£50–£5,000). */
export const MIN_BOUNTY_PENCE = 5000;
export const MAX_BOUNTY_PENCE = 500000;
export const DEFAULT_BOUNTY_PENCE = 25000;

/** A centred, underlined text action to advance a step without its main input —
 *  the marks step's "none to add". Uses the framework's onSkip (plain forward
 *  move; returns to review on an edit spur, like Next). */
function StepSkipButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.skipLink, pressed && styles.skipLinkPressed]}
    >
      <Text style={styles.skipText}>{label}</Text>
    </Pressable>
  );
}

export function MakeStep({ answers, setAnswers }: StepProps) {
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

export function ModelStep({ answers, setAnswers }: StepProps) {
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

export function ColourStep({ answers, setAnswers }: StepProps) {
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

export function YearStep({ answers, setAnswers }: StepProps) {
  return (
    <YearField value={answers.year ?? null} onChange={(year) => setAnswers({ year })} />
  );
}

export function DistinctiveMarksStep({ answers, setAnswers, onSkip }: StepProps) {
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

export function PhotosStep({ answers, setAnswers }: StepProps) {
  return (
    <PhotoGridPicker
      photos={answers.photos ?? []}
      onChangePhotos={(photos) => setAnswers({ photos })}
      minPhotos={3}
      maxPhotos={6}
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
  return (
    <View style={styles.mapFrame}>
      <LocationPicker
        MapComponent={AppMap}
        locationServices={expoLocationServices}
        // Feed the stored point back so returning here (Back / Edit) starts
        // SETTLED — otherwise the mount emits isSettled:false and wipes it.
        initialLocation={answers.location ?? null}
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

export function BountyStep({ answers, setAnswers }: StepProps) {
  // MoneySlider re-registers its drag gesture if the handler identity changes.
  const onChangePence = useCallback(
    (bountyAmountPence: number) => setAnswers({ bountyAmountPence }),
    [setAnswers],
  );
  return (
    <MoneySlider
      label="Bounty"
      valuePence={answers.bountyAmountPence ?? DEFAULT_BOUNTY_PENCE}
      onChangePence={onChangePence}
      minPence={MIN_BOUNTY_PENCE}
      maxPence={MAX_BOUNTY_PENCE}
      panel={defaultBountyPanelCopy}
    />
  );
}

export function VerificationStep({ answers, setAnswers }: StepProps) {
  // Single-photo mode: store the one V5C image (or null when cleared).
  const photos = answers.verification ? [answers.verification] : [];
  return (
    <PhotoGridPicker
      photos={photos}
      onChangePhotos={(next) => setAnswers({ verification: next[0] ?? null })}
      minPhotos={1}
      maxPhotos={1}
      copy={{
        tips:
          'We verify every post to keep the platform safe — a moderator checks ' +
          'your V5C before your post goes live. It’s never shown publicly.',
      }}
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
  // Embedded LocationPicker needs a bounded height to lay out the map.
  mapFrame: {
    height: sizes.mapPickerHeight,
  },
});
