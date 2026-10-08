/**
 * WHAT:  Tests for which vehicle steps move on by themselves (advanceSoon):
 *        a plain colour and a body type do; an escape colour ("Multicolour /
 *        wrapped", "Other"), which opens a note to fill in, does not; the
 *        pickers (make, model, year) hand it to their field's onPicked, so it
 *        runs after the picker has closed.
 * WHY:   2026-10-08 — the owner chose auto-advance on make, model, year,
 *        colour and body type to cut a tap per step. Moving on from an escape
 *        colour would take the step away from under its own note sheet.
 * LINKS: ./postSteps.tsx; src/shared/wizard/useWizardController.ts
 *        (advanceSoon); src/shared/ui/SelectField.tsx (onPicked).
 */

import { act, render } from '@testing-library/react-native';

import type { VehicleAnswers } from '../lib/vehicleSteps';
import { BodyTypeStep, ColourStep, MakeStep, YearStep } from './postSteps';

// Each field stood in for, exposing the callbacks the step wires up.
const mockFieldProps: Record<string, Record<string, unknown>> = {};
const stub = (name: string) => (props: Record<string, unknown>) => {
  mockFieldProps[name] = props;
  return null;
};
jest.mock('./ColourField', () => ({ ColourField: (p: Record<string, unknown>) => stub('colour')(p) }));
jest.mock('./MakeField', () => ({ MakeField: (p: Record<string, unknown>) => stub('make')(p) }));
jest.mock('./YearField', () => ({ YearField: (p: Record<string, unknown>) => stub('year')(p) }));
jest.mock('@/shared/ui', () => ({
  ...jest.requireActual('@/shared/ui'),
  CardSelect: (p: Record<string, unknown>) => stub('bodyType')(p),
}));
// The step file's other steps reach the network and native maps; these don't.
jest.mock('@/shared/api', () => ({ supabase: {} }));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type Props = Parameters<typeof ColourStep>[0];
const props = (advanceSoon: () => void): Props => ({
  answers: {} as Partial<VehicleAnswers>,
  setAnswers: jest.fn(),
  advanceSoon,
});

describe('vehicle steps that move on by themselves', () => {
  it('a plain colour moves on', async () => {
    const advanceSoon = jest.fn();
    await render(<ColourStep {...props(advanceSoon)} />);
    await act(async () => (mockFieldProps.colour.onChange as (c: string) => void)('Blue'));
    expect(advanceSoon).toHaveBeenCalledTimes(1);
  });

  it('an escape colour does NOT — it opens a note to fill in', async () => {
    const advanceSoon = jest.fn();
    await render(<ColourStep {...props(advanceSoon)} />);
    await act(async () => (mockFieldProps.colour.onChange as (c: string) => void)('Multicolour / wrapped'));
    await act(async () => (mockFieldProps.colour.onChange as (c: string) => void)('Other'));
    expect(advanceSoon).not.toHaveBeenCalled();
  });

  it('a body type moves on', async () => {
    const advanceSoon = jest.fn();
    await render(<BodyTypeStep {...props(advanceSoon)} />);
    await act(async () => (mockFieldProps.bodyType.onSelect as (v: string) => void)('Saloon'));
    expect(advanceSoon).toHaveBeenCalledTimes(1);
  });

  it('a picker step moves on only once its picker has closed (onPicked)', async () => {
    const advanceSoon = jest.fn();
    await render(<MakeStep {...props(advanceSoon)} />);
    await render(<YearStep {...props(advanceSoon)} />);
    expect(mockFieldProps.make.onPicked).toBe(advanceSoon);
    expect(mockFieldProps.year.onPicked).toBe(advanceSoon);
    // Choosing alone moves nothing: the field calls onPicked after closing.
    await act(async () => (mockFieldProps.make.onChange as (m: string) => void)('BMW'));
    expect(advanceSoon).not.toHaveBeenCalled();
  });
});
