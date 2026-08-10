/**
 * WHAT:  The alert wizard's step components — area (map + radius + privacy
 *        toggle), which cars, extra filters, and the name.
 * WHY:   Split from the flow config so the config stays a readable data table
 *        (house pattern: postSteps.tsx / garageSteps.tsx), and so each control
 *        can be reused by an editor later the way BountyEditor reuses
 *        BountyStep.
 *
 *        AREA IS ONE STEP, not two. The circle scaling live as the radius
 *        moves is the whole payoff visual — separating the map from its slider
 *        would show the user a circle they cannot change, then a number with
 *        no picture.
 *
 *        // SAFETY: the criteria pickers deliberately offer only CANONICAL
 *        values (no free typing). Posts store whatever the owner typed and the
 *        server matches case-insensitively but still exactly, so a free-typed
 *        "beemer" here would create an alert that silently matches nothing —
 *        worse than no alert, because the user believes they are covered.
 * LINKS: ../lib/alertFlow.tsx (the config); ./AlertZoneMap.tsx,
 *        src/shared/ui/RadiusSlider.tsx (shared with map search since
 *        2026-08-10; the default label keeps this wizard's copy unchanged);
 *        @/features/vehicles (CAR_COLOURS, BODY_TYPE_OPTIONS);
 *        @/shared/lib/carMakes, carModels.
 */

import { BODY_TYPE_OPTIONS, BODY_TYPE_UNKNOWN, CAR_COLOURS } from '@/features/vehicles';
import { CAR_MAKES, POPULAR_MAKES } from '@/shared/lib/carMakes';
import { modelsForMake } from '@/shared/lib/carModels';
import { milesToMetres } from '@/shared/lib/distance';
import { expoLocationServices } from '@/shared/lib/location/expoLocationServices';
import { sizes, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';
import {
  ChoiceChips,
  LocationPicker,
  MoneySlider,
  RadiusSlider,
  SelectField,
  type SelectOption,
  TextField,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';
import { StyleSheet, Text, View } from 'react-native';

import { DEFAULT_ALERT_RADIUS_MILES, type AlertAnswers } from '../types';
import { AlertZoneMap, AlertZoneMapProvider } from './AlertZoneMap';

type StepProps = WizardStepProps<AlertAnswers>;

/** "Any" is a value, not an absence, so the chip row can express it. */
const ANY = '__any__';

const MAKE_OPTIONS: SelectOption[] = CAR_MAKES.map((make) => ({
  value: make.label,
  label: make.label,
  section: make.section,
}));

const COLOUR_OPTIONS = [
  { value: ANY, label: 'Any colour' },
  ...CAR_COLOURS.map((colour) => ({ value: colour.name, label: colour.name })),
];

/** BODY_TYPE_UNKNOWN ("Not sure") is a POST-side answer meaning "I don't know".
 *  Filtering an alert on it would match only posts whose owner shrugged. */
const BODY_TYPE_CHIPS = [
  { value: ANY, label: 'Any type' },
  ...BODY_TYPE_OPTIONS.filter((option) => option.value !== BODY_TYPE_UNKNOWN).map((option) => ({
    value: String(option.value),
    label: option.label,
  })),
];

const RECENCY_CHIPS = [
  { value: ANY, label: 'Any time' },
  { value: '3', label: 'Last 3 days' },
  { value: '7', label: 'Last week' },
  { value: '30', label: 'Last month' },
];

/** £50 is the post minimum, so a £50 floor filters nothing — it IS "any". */
const BOUNTY_MIN_PENCE = 5000;
const BOUNTY_MAX_PENCE = 500000;

function chipValue(value: string | null): string {
  return value ?? ANY;
}
function fromChip(value: string): string | null {
  return value === ANY ? null : value;
}

// --- 1. Area ----------------------------------------------------------------

export function AreaStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const radiusMiles = answers.radiusMiles ?? DEFAULT_ALERT_RADIUS_MILES;
  return (
    <View style={styles.fillsStack}>
      <AlertZoneMapProvider radiusMetres={milesToMetres(radiusMiles)} dimmed={false}>
        <View style={styles.mapFrame}>
          <LocationPicker
            MapComponent={AlertZoneMap}
            locationServices={expoLocationServices}
            initialLocation={answers.location ?? null}
            // Keeps the camera framed on the circle as the slider moves — the
            // payoff visual only works if the whole circle stays in view.
            fitRadiusMiles={radiusMiles}
            promptLabel="Move the map to the area you want to watch"
            // No caption: it floats ON the map, so its two wrapped lines cost
            // ~40pt of the thing it sits on. The title carries the promise and
            // the toggle is on by default, so the safe state needs no reading.
            optionSlot={{
              title: 'Use approximate area only',
              value: answers.approximate ?? true,
              onValueChange: (approximate) => setAnswers({ approximate }),
            }}
            onLocationChange={(value) => {
              if (!value.isSettled) return;
              setAnswers({
                location: { latitude: value.latitude, longitude: value.longitude },
                // Kept ONLY to seed the name suggestion — never sent anywhere.
                placeLabel: value.addressLabel || null,
              });
            }}
          />
        </View>
      </AlertZoneMapProvider>

      <RadiusSlider
        valueMiles={radiusMiles}
        onChangeMiles={(miles) => setAnswers({ radiusMiles: miles })}
        testID="alert-radius"
      />
    </View>
  );
}

// --- 2. Which cars ----------------------------------------------------------

export function CarStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const make = answers.make ?? null;
  const models = make ? modelsForMake(make) : [];

  return (
    <View style={styles.stack}>
      <SelectField
        label="Make"
        options={MAKE_OPTIONS}
        value={make}
        // Changing the make invalidates the old model — the same dependency
        // makeChangePatch and useSearchCriteria.setMake enforce elsewhere.
        onChange={(next) => setAnswers({ make: next, model: null })}
        placeholder="Any make"
        screenTitle="Which make?"
        searchPlaceholder="Search makes"
        recentValues={POPULAR_MAKES}
        pinnedTitle="Popular makes"
        showIndex
        stagger
        // NO allowManualEntry — see the SAFETY note in the file header.
      />

      {make && models.length > 0 ? (
        <SelectField
          label="Model"
          options={models.map((model) => ({ value: model.label, label: model.label }))}
          value={answers.model ?? null}
          onChange={(model) => setAnswers({ model })}
          placeholder="Any model"
          screenTitle={`Which ${make}?`}
          searchPlaceholder="Search models"
        />
      ) : null}

      {make && models.length === 0 ? (
        <Text style={styles.note}>
          We don&apos;t have a model list for {make} yet, so this alert will cover all of them.
        </Text>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>Colour</Text>
        <ChoiceChips
          options={COLOUR_OPTIONS}
          value={chipValue(answers.colour ?? null)}
          onSelect={(value) => setAnswers({ colour: fromChip(value) })}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Body type</Text>
        <ChoiceChips
          options={BODY_TYPE_CHIPS}
          value={chipValue(answers.bodyType ?? null)}
          onSelect={(value) => setAnswers({ bodyType: fromChip(value) })}
        />
      </View>
    </View>
  );
}

// --- 3. Extra filters -------------------------------------------------------

export function FiltersStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const bountyPence = answers.minBountyPence ?? BOUNTY_MIN_PENCE;
  return (
    <View style={styles.stack}>
      <MoneySlider
        label="Only if the bounty is at least"
        valuePence={bountyPence}
        // £50 is the floor every post already clears, so treat it as "any"
        // rather than storing a filter that can never exclude anything.
        onChangePence={(pence) =>
          setAnswers({ minBountyPence: pence <= BOUNTY_MIN_PENCE ? null : pence })
        }
        minPence={BOUNTY_MIN_PENCE}
        maxPence={BOUNTY_MAX_PENCE}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Stolen within</Text>
        <ChoiceChips
          options={RECENCY_CHIPS}
          value={chipValue(answers.recencyDays ? String(answers.recencyDays) : null)}
          onSelect={(value) =>
            setAnswers({ recencyDays: value === ANY ? null : Number.parseInt(value, 10) })
          }
        />
        <Text style={styles.note}>
          Filters on when the car was last seen, not when it was posted — so it skips reports
          about older thefts. Most reports are recent, so this rarely narrows much.
        </Text>
      </View>
    </View>
  );
}

// --- 4. Name ----------------------------------------------------------------

export function NameStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stack}>
      <TextField
        label="Alert name"
        value={answers.name ?? ''}
        onChangeText={(name) => setAnswers({ name })}
        placeholder="Home, Work commute…"
        autoCapitalize="sentences"
        testID="alert-name"
      />
      <Text style={styles.note}>Only you ever see this.</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // The ordinary step rhythm, shared by the car / filters / name steps.
  stack: {
    gap: spacing.xl,
  },
  // AREA STEP ONLY. Separate from `stack` because that one is shared by three
  // SCROLLING steps, where `flex: 1` is meaningless and the tighter gap is a
  // spaciousness regression they never asked for.
  //
  // flex so this fills the step body — without it the stack sizes to its
  // content, the map's flex:1 has nothing to measure against, and it collapses
  // back to minHeight leaving dead space under the slider. The chain has to be
  // unbroken from the wizard's fills container all the way down.
  fillsStack: {
    flex: 1,
    gap: spacing.lg,
  },
  // SPIKE: grows into whatever the fills step leaves after the headline and the
  // radius slider, instead of a fixed frame. minHeight is the graceful floor —
  // on a short screen the map stops shrinking and the step scrolls... except it
  // cannot, on a fills step. That tension is exactly what the spike measures.
  mapFrame: {
    flex: 1,
    minHeight: sizes.mapPickerHeight,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    ...typography.label,
    color: c.textSecondary,
  },
  note: {
    ...typography.caption,
    color: c.textSecondary,
  },
});
