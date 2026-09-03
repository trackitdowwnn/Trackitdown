/**
 * WHAT:  ModelField — the car-model picker for the post-a-car model step. The
 *        same full-screen searchable SelectField as the make step, listing the
 *        chosen make's models with a "Popular <Make> models" pinned group and a
 *        free-text row for anything unlisted. A make with no seeded models (or a
 *        free-typed make) drops to a plain free-text field; a missing make
 *        guides the user back. The make context lives in the step's title
 *        ("Which BMW model?"), not a chip in the body.
 * WHY:   Model depends on make (dependent select), so the field is driven by
 *        `make` and reuses the shared picker (SelectField/SelectScreen) — no
 *        fork. posts.model is FREE TEXT, so manual entry is always reachable:
 *        typing a model with no exact match surfaces a "Use "<query>"" row. The
 *        stored value IS the model label. A short model list uses a FLAT
 *        alphabetical list (no per-letter sections / index rail — those are
 *        long-list tools that would fragment ~15 rows into singletons).
 * LINKS: src/shared/lib/carModels.ts (data + dependency);
 *        src/features/vehicles/post/components/postSteps.tsx (ModelStep);
 *        src/features/vehicles/post/components/MakeField.tsx (sibling picker);
 *        src/shared/ui/SelectField.tsx (+ SelectScreen) — the picker.
 */

import { EmptyState, SelectField, TextField, type SelectOption } from '@/shared/ui';

import { canonicaliseModel, modelsForMake, popularModelsForMake } from '@/shared/lib/carModels';

export interface ModelFieldProps {
  /** The make chosen in the previous step — drives which models are offered. */
  make: string;
  /** The selected model (free text — may be unlisted), or null. */
  value: string | null;
  onChange: (model: string) => void;
  error?: string;
}

export function ModelField({ make, value, onChange, error }: ModelFieldProps) {
  // Defensive: the make step gates before this one, so an empty make shouldn't
  // reach here — guide back rather than show an empty list.
  if (!make.trim()) {
    return (
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
  const options: SelectOption<string>[] = models
    .map((model) => ({ value: model.label, label: model.label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // No seeded models for this make (unseeded or free-typed) → free text.
  if (options.length === 0) {
    return (
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
      placeholder="Select the model"
      screenTitle={`${make} model`}
      searchPlaceholder={`Search ${make} models`}
      options={options}
      value={value}
      onChange={onChangeCanonical}
      error={error}
      // Browse-first + free-text fallback, matching the make picker: typing a
      // model with no exact match surfaces a "Use "<query>"" row.
      autoFocusSearch={false}
      recentValues={popularModelsForMake(make)}
      pinnedTitle={`Popular ${make} models`}
      stagger
      allowManualEntry
    />
  );
}
