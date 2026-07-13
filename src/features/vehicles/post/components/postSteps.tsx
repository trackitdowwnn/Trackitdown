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
import { StyleSheet, View } from 'react-native';

import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import {
  ChoiceChips,
  ChoiceChipsMulti,
  DateTimeField,
  DEFAULT_DATE_TIME_PRESETS,
  defaultBountyPanelCopy,
  LocationPicker,
  MoneySlider,
  PhotoGridPicker,
  TextField,
} from '@/shared/ui';
import { AppMap } from '@/shared/ui/AppMap';
import { sizes, spacing } from '@/shared/theme';
import type { WizardStepProps } from '@/shared/wizard';

import { VEHICLE_FEATURES } from '../lib/featureTaxonomy';
import type { PostACarAnswers } from '../types';

type StepProps = WizardStepProps<PostACarAnswers>;

/** Taxonomy as chip options (key → value), computed once. */
const FEATURE_OPTIONS = VEHICLE_FEATURES.map((feature) => ({
  value: feature.key,
  label: feature.label,
  icon: feature.icon,
}));

/** Bounty range (pence) — mirrors create_post + the posts CHECK (£50–£5,000). */
export const MIN_BOUNTY_PENCE = 5000;
export const MAX_BOUNTY_PENCE = 500000;
export const DEFAULT_BOUNTY_PENCE = 25000;

export function PlateStep({ answers, setAnswers }: StepProps) {
  return (
    <TextField
      label="Number plate (optional)"
      variant="plate"
      placeholder="AB12 CDE"
      value={answers.plate ?? ''}
      onChangeText={(plate) => setAnswers({ plate })}
      autoFocus
    />
  );
}

export function CarDetailsStep({ answers, setAnswers }: StepProps) {
  return (
    <View style={styles.stack}>
      <TextField
        label="Make"
        placeholder="e.g. BMW"
        value={answers.make ?? ''}
        onChangeText={(make) => setAnswers({ make })}
      />
      <TextField
        label="Model"
        placeholder="e.g. 3 Series"
        value={answers.model ?? ''}
        onChangeText={(model) => setAnswers({ model })}
      />
      <TextField
        label="Colour"
        placeholder="e.g. Blue"
        value={answers.colour ?? ''}
        onChangeText={(colour) => setAnswers({ colour })}
      />
      <TextField
        label="Year (optional)"
        placeholder="e.g. 2019"
        keyboardType="number-pad"
        value={answers.year != null ? String(answers.year) : ''}
        onChangeText={(text) => {
          const digits = text.replace(/[^0-9]/g, '').slice(0, 4);
          setAnswers({ year: digits ? Number(digits) : null });
        }}
      />
    </View>
  );
}

export function FeaturesStep({ answers, setAnswers }: StepProps) {
  return (
    <View style={styles.stack}>
      <ChoiceChipsMulti
        options={FEATURE_OPTIONS}
        value={answers.featureKeys ?? []}
        onChange={(featureKeys) => setAnswers({ featureKeys })}
      />
      <TextField
        label="How would someone recognise it at a glance? (optional)"
        variant="multiline"
        placeholder="e.g. Dented rear door, sticker in the back window"
        value={answers.descRecognise ?? ''}
        onChangeText={(descRecognise) => setAnswers({ descRecognise })}
        maxLength={1000}
      />
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
  // Embedded LocationPicker needs a bounded height to lay out the map.
  mapFrame: {
    height: sizes.mapPickerHeight,
  },
});
