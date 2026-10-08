/**
 * WHAT:  ModelField — the car-model picker, driven by the chosen make. The same
 *        full-screen SelectField as the make: "Popular <Make> models" (the most
 *        common in the UK, most first) above the make's models A–Z, with
 *        sticky letters and a letter rail once the list is long. Two modes,
 *        like MakeField:
 *          - answering: a free-typed model is allowed ("Use "<query>""), and a
 *            make with no model list (one typed in by hand) drops to a plain
 *            text field;
 *          - `filter` (search, alerts): "Any <Make> model" leads, a × clears
 *            it, listed models only, and nothing renders for a make with no
 *            list, unless the filter already has a model, which then shows
 *            so it can be cleared.
 *        A missing make guides the user back. The make lives in the step's
 *        title ("Which BMW model?"), not a chip in the body.
 * WHY:   Model depends on make (dependent select), so the field is driven by
 *        `make` and reuses the shared picker — no fork. The DfT list (2026-09-30)
 *        gives every listed make its models, often 30 to 50 of them, so the
 *        old flat list became A–Z sections with a rail past SECTIONED_FROM
 *        rows; short lists stay flat, where sections would fragment into
 *        singletons. The stored value IS the model label.
 * LINKS: src/shared/lib/carModels.ts (data + dependency);
 *        src/features/vehicles/post/components/postSteps.tsx (ModelStep);
 *        src/features/vehicles/post/components/MakeField.tsx (sibling picker);
 *        src/shared/ui/SelectField.tsx (+ SelectScreen) — the picker.
 */

import { EmptyState, SelectField, TextField, type SelectOption } from '@/shared/ui';

import {
  canonicaliseModel,
  modelSection,
  modelsForMake,
  popularModelsForMake,
} from '@/shared/lib/carModels';

/** From this many models, the list gets A–Z sections and the letter rail. */
const SECTIONED_FROM = 20;

export interface ModelFieldProps {
  /** The make chosen in the previous step — drives which models are offered. */
  make: string;
  /** The selected model (free text — may be unlisted), or null. */
  value: string | null;
  onChange: (model: string) => void;
  /** After a pick from the LIST, once the picker has closed (the wizard's
   *  auto-advance). Never for the typed fallback — typing is not a pick. */
  onPicked?: () => void;
  error?: string;
  /** Search and alerts: "Any <Make> model" and a ×, both calling `onClear`;
   *  listed models only. */
  filter?: { onClear: () => void };
}

export function ModelField({ make, value, onChange, onPicked, error, filter }: ModelFieldProps) {
  // Defensive: the make step gates before this one, so an empty make shouldn't
  // reach here — guide back rather than show an empty list.
  if (!make.trim()) {
    return filter ? null : (
      <EmptyState
        title="Choose a make first"
        body="Go back a step and pick the car's make — its models will appear here."
      />
    );
  }

  // ⚠️ Free-typed models are canonicalised against THIS make's list (review
  // #20), so "golf" stores as "Golf" and meets a spotter's alert instead of
  // silently missing it. Only the SelectField path needs it — the TextField
  // fallback below runs when the list is empty, where there is nothing to match
  // against and nothing to correct towards.
  const onChangeCanonical = (model: string) => onChange(canonicaliseModel(make, model));

  const models = modelsForMake(make);
  const sectioned = models.length >= SECTIONED_FROM;
  const options: SelectOption<string>[] = models.map((model) => ({
    value: model.label,
    label: model.label,
    section: sectioned ? modelSection(model.label) : undefined,
  }));

  // No model list for this make (it was typed in by hand). A filter still shows
  // a model it was given, so a hidden filter can be seen and cleared.
  if (options.length === 0) {
    if (filter && value) {
      return (
        <SelectField
          label="Model"
          screenTitle={`${make} model`}
          options={[]}
          value={value}
          onChange={onChange}
          clearable={{ anyLabel: `Any ${make} model`, clearLabel: 'Clear model', onClear: filter.onClear }}
        />
      );
    }
    return filter ? null : (
      <TextField
        label="Model"
        placeholder="Enter the model"
        value={value ?? ''}
        onChangeText={onChange}
        error={error}
      />
    );
  }

  return (
    <SelectField
      label="Model"
      placeholder={filter ? `Any ${make} model` : 'Select the model'}
      screenTitle={`${make} model`}
      // The title names the make; a text input can't wrap, so keep this short.
      searchPlaceholder="Search models"
      options={options}
      value={value}
      onChange={onChangeCanonical}
      onPicked={onPicked}
      error={error}
      autoFocusSearch={false}
      recentValues={popularModelsForMake(make)}
      pinnedTitle={`Popular ${make} models`}
      // The same tiles as makes, so the two pickers read as one family.
      pinnedLayout="grid"
      allTitle={`All ${make} models`}
      showIndex={sectioned}
      stagger
      allowManualEntry={!filter}
      clearable={
        filter
          ? { anyLabel: `Any ${make} model`, clearLabel: 'Clear model', onClear: filter.onClear }
          : undefined
      }
    />
  );
}
