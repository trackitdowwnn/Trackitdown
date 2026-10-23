/**
 * WHAT:  Tests for LastSeenWhenStep's wiring: a preset card moves the wizard on
 *        at the auto-advance beat, an exact time on the picker beat, and with
 *        no advanceSoon (the listing's Last seen editor) nothing moves.
 * WHY:   Owner, 2026-10-22: the step is cards now, and a card moves on as
 *        body type does — but the editor shows the same cards in a sheet with
 *        its own Save, where a jump would be wrong.
 * LINKS: ./postSteps.tsx (LastSeenWhenStep); ./LastSeenTimeField.tsx (the
 *        cards themselves, tested there); docs/TESTING.md.
 */

import { render } from '@testing-library/react-native';

import { motion } from '@/shared/theme';

import type { PostACarAnswers } from '../types';
import { LastSeenWhenStep } from './postSteps';

type FieldProps = {
  value: string | null;
  onChange: (iso: string) => void;
  onPresetPicked?: () => void;
  onExactPicked?: () => void;
  onPickerOpen?: () => void;
};
let mockField: FieldProps | null = null;
jest.mock('./LastSeenTimeField', () => ({
  LastSeenTimeField: (props: FieldProps) => {
    mockField = props;
    return null;
  },
}));
// The step file's other steps reach the map and the network; this one doesn't.
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('@/shared/api', () => ({ supabase: {} }));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({ expoLocationServices: {} }));
jest.mock('@/shared/lib/location/useDefaultMapCentre', () => ({
  useDefaultMapCentre: () => ({ status: 'ready', centre: null }),
}));
jest.mock('@/shared/lib/location/placeLabels', () => ({ warmPlaceLabels: jest.fn() }));
jest.mock('../api/bountyGuidanceApi', () => ({ warmBountyGuidance: jest.fn() }));

const answers = { lastSeenAt: '2026-10-21T21:00:00.000Z' } as Partial<PostACarAnswers>;

beforeEach(() => {
  mockField = null;
});

describe('LastSeenWhenStep', () => {
  it('moves on at the beat after a preset, and on the picker beat after an exact time', async () => {
    const advanceSoon = jest.fn();
    const setAnswers = jest.fn();
    await render(
      <LastSeenWhenStep answers={answers} setAnswers={setAnswers} advanceSoon={advanceSoon} />,
    );

    expect(mockField?.value).toBe('2026-10-21T21:00:00.000Z');
    mockField?.onChange('2026-10-22T13:00:00.000Z');
    expect(setAnswers).toHaveBeenCalledWith({ lastSeenAt: '2026-10-22T13:00:00.000Z' });

    mockField?.onPresetPicked?.();
    expect(advanceSoon).toHaveBeenLastCalledWith();
    mockField?.onExactPicked?.();
    expect(advanceSoon).toHaveBeenLastCalledWith(motion.autoAdvanceAfterPicker);
  });

  it('⚠️ opening the picker cancels a preset’s pending move-on', async () => {
    // A quick "actually, the exact time" moved the step on under the sheet.
    const cancelAdvanceSoon = jest.fn();
    await render(
      <LastSeenWhenStep
        answers={answers}
        setAnswers={jest.fn()}
        advanceSoon={jest.fn()}
        cancelAdvanceSoon={cancelAdvanceSoon}
      />,
    );
    mockField?.onPickerOpen?.();
    expect(cancelAdvanceSoon).toHaveBeenCalledTimes(1);
  });

  it('never moves without advanceSoon (the listing’s Last seen editor) — but still saves', async () => {
    const setAnswers = jest.fn();
    await render(<LastSeenWhenStep answers={answers} setAnswers={setAnswers} />);
    expect(mockField).not.toBeNull();
    expect(() => {
      mockField?.onPresetPicked?.();
      mockField?.onExactPicked?.();
      mockField?.onPickerOpen?.();
    }).not.toThrow();
    mockField?.onChange('2026-10-22T13:00:00.000Z');
    expect(setAnswers).toHaveBeenCalledWith({ lastSeenAt: '2026-10-22T13:00:00.000Z' });
  });
});
