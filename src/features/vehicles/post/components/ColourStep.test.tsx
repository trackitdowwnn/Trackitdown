/**
 * WHAT:  Tests for ColourStep's paint-finish question (2026-10-12): a plain
 *        colour claims the wizard's Next, which opens PaintFinishSheet; a pick
 *        is saved and the wizard moves on only once the sheet has closed; a
 *        swipe stays put; an escape colour (or none) claims nothing; and in
 *        the Car details editor the finish is a row that opens the same sheet
 *        and never moves anything.
 * WHY:   Owner request — the finish chips sat under twenty swatches. Whether
 *        the step claims Next, and when it hands it back, decides whether the
 *        wizard skips the question, asks it of a wrap, or moves under a sheet.
 * LINKS: ./postSteps.tsx (ColourStep); ./PaintFinishSheet.tsx;
 *        src/shared/wizard/types.ts (claimNext).
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { useEffect, useState } from 'react';

import type { VehicleAnswers } from '../lib/vehicleSteps';

import { ColourStep } from './postSteps';

// ColourField stood in for: the step's own wiring is what's under test.
let mockColourProps: Record<string, unknown> = {};
jest.mock('./ColourField', () => ({
  ColourField: (props: Record<string, unknown>) => {
    mockColourProps = props;
    return null;
  },
}));

// The sheet stood in for: counts opens, and hands back its callbacks so a
// test can play a pick, a "Not sure" or a swipe.
const mockSheet: { opens: number; props: Record<string, unknown> } = { opens: 0, props: {} };
jest.mock('./PaintFinishSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { useImperativeHandle } = require('react');
  return {
    PaintFinishSheet: (props: Record<string, unknown>) => {
      mockSheet.props = props;
      useImperativeHandle(props.ref, () => ({
        open: () => {
          mockSheet.opens += 1;
        },
        close: () => {},
      }));
      return null;
    },
  };
});

// The step file's other steps reach the network and native maps; these don't.
jest.mock('@/shared/api', () => ({ supabase: {} }));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type Handler = (proceed: () => void) => void;
/** The wizard's side of a claim: the live handler, or null once released. */
let claim: Handler | null = null;
const claimNext = jest.fn((handler: Handler) => {
  claim = handler;
  return () => {
    if (claim === handler) claim = null;
  };
});

let answersNow: Partial<VehicleAnswers> = {};
function Harness({
  initial,
  finishAsRow,
}: {
  initial: Partial<VehicleAnswers>;
  finishAsRow?: boolean;
}) {
  const [answers, setAnswers] = useState(initial);
  useEffect(() => {
    answersNow = answers;
  }, [answers]);
  return (
    <ColourStep
      answers={answers}
      setAnswers={(patch) => setAnswers((current) => ({ ...current, ...patch }))}
      claimNext={claimNext}
      finishAsRow={finishAsRow}
    />
  );
}

const pickColour = (colour: string) =>
  act(async () => (mockColourProps.onChange as (c: string) => void)(colour));
const sheet = {
  pick: (finish: string | null) =>
    act(async () => (mockSheet.props.onPick as (f: string | null) => void)(finish)),
  closed: (picked: boolean) =>
    act(async () => (mockSheet.props.onClosed as (p: boolean) => void)(picked)),
};

beforeEach(() => {
  claim = null;
  claimNext.mockClear();
  mockSheet.opens = 0;
});

describe('ColourStep — the paint finish, asked on Next (2026-10-12)', () => {
  it('claims nothing until a colour is chosen', async () => {
    await render(<Harness initial={{}} />);
    expect(claim).toBeNull();
  });

  it('a plain colour claims Next; Next opens the sheet', async () => {
    await render(<Harness initial={{ colour: 'Blue' }} />);
    expect(claim).not.toBeNull();

    const proceed = jest.fn();
    await act(async () => claim?.(proceed));

    expect(mockSheet.opens).toBe(1);
    expect(proceed).not.toHaveBeenCalled(); // not until it is answered
  });

  it('⚠️ a pick is saved at once, but moves on only once the sheet has GONE', async () => {
    await render(<Harness initial={{ colour: 'Blue' }} />);
    const proceed = jest.fn();
    await act(async () => claim?.(proceed));

    await sheet.pick('metallic');
    expect(answersNow.colourFinish).toBe('metallic');
    expect(proceed).not.toHaveBeenCalled();

    await sheet.closed(true);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('"Not sure" saves no finish — and moves on', async () => {
    await render(<Harness initial={{ colour: 'Blue', colourFinish: 'pearl' }} />);
    const proceed = jest.fn();
    await act(async () => claim?.(proceed));

    await sheet.pick(null);
    await sheet.closed(true);

    expect(answersNow.colourFinish).toBeNull();
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a swipe stays put — Next asks again', async () => {
    await render(<Harness initial={{ colour: 'Blue' }} />);
    const proceed = jest.fn();
    await act(async () => claim?.(proceed));

    await sheet.closed(false);
    expect(proceed).not.toHaveBeenCalled();

    await act(async () => claim?.(proceed));
    expect(mockSheet.opens).toBe(2);
  });

  it('an escape colour claims nothing — its Next just moves', async () => {
    await render(<Harness initial={{ colour: 'Blue' }} />);
    expect(claim).not.toBeNull();

    await pickColour('Multicolour / wrapped');
    expect(claim).toBeNull();

    await pickColour('Grey');
    expect(claim).not.toBeNull();
  });

  it('the summary names the finish, and the sheet names the colour', async () => {
    await render(<Harness initial={{ colour: 'Brown / Beige', colourFinish: 'matte' }} />);
    expect(mockColourProps.finish).toBe('matte');
    expect(mockSheet.props.colour).toBe('Brown'); // a retired name, as it is now
  });
});

describe('ColourStep — the Car details editor (finishAsRow)', () => {
  it('a "Paint finish" row opens the sheet; a pick sets it and moves nothing', async () => {
    const screen = await render(<Harness initial={{ colour: 'Blue' }} finishAsRow />);
    expect(claimNext).not.toHaveBeenCalled();

    // The form's own field shape, saying it is optional while empty.
    const row = screen.getByTestId('paint-finish-row');
    expect(screen.getByText('Paint finish (optional)')).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe('Paint finish, not added');
    await act(async () => {
      fireEvent.press(row);
    });
    expect(mockSheet.opens).toBe(1);

    await sheet.pick('two_tone_roof');
    await sheet.closed(true);
    expect(answersNow.colourFinish).toBe('two_tone_roof');
    expect(screen.getByText('Two-tone roof')).toBeTruthy();
    expect(screen.getByTestId('paint-finish-row').props.accessibilityLabel).toBe(
      'Paint finish, Two-tone roof',
    );
    // Said once, by the row — not again in the grid's summary.
    expect(mockColourProps.finish).toBeNull();
  });

  it('has no row for an escape colour', async () => {
    const screen = await render(<Harness initial={{ colour: 'Other' }} finishAsRow />);
    expect(screen.queryByTestId('paint-finish-row')).toBeNull();
  });
});
