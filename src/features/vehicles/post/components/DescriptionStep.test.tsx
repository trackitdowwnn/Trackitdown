/**
 * WHAT:  Tests for the description step's "Skip for now": it clears a fragment
 *        and moves on — but not in the middle of the move that brought the
 *        step in.
 * WHY:   Review of #142: the wizard ignores a move asked for mid-transition,
 *        so a Skip tapped then cleared what the owner had typed and stayed
 *        put — their text gone, nothing to show for it.
 * LINKS: ./postSteps.tsx (DescriptionStep); src/shared/wizard/useWizardController.ts.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { PostACarAnswers } from '../types';
import { DescriptionStep } from './postSteps';

jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable, Text } = require('react-native');
  const Nothing = () => null;
  return {
    StepSkipButton: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      <Pressable onPress={onPress} testID={testID}>
        <Text>{label}</Text>
      </Pressable>
    ),
    TextField: Nothing,
    MoneySlider: Nothing,
    defaultBountyPanelCopy: {},
    CardSelect: Nothing,
    ChoiceChips: Nothing,
    LocationPicker: Nothing,
    PhotoGridPicker: Nothing,
  };
});
jest.mock('@/shared/api', () => ({ supabase: {} }));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({ expoLocationServices: {} }));
jest.mock('@/shared/lib/location/useDefaultMapCentre', () => ({ useDefaultMapCentre: () => null }));
jest.mock('./LastSeenTimeField', () => ({ LastSeenTimeField: () => null }));
jest.mock('./ColourField', () => ({ ColourField: () => null }));
jest.mock('./DistinctiveFeaturesField', () => ({ DistinctiveFeaturesField: () => null }));
jest.mock('./MakeField', () => ({ MakeField: () => null }));
jest.mock('./ModelField', () => ({ ModelField: () => null }));

async function renderStep(settled: boolean) {
  const setAnswers = jest.fn();
  const onSkip = jest.fn();
  const view = await render(
    <DescriptionStep
      answers={{ descRecognise: 'blue one' } as Partial<PostACarAnswers>}
      setAnswers={setAnswers}
      onSkip={onSkip}
      settled={settled}
    />,
  );
  await act(async () => {
    fireEvent.press(view.getByTestId('description-skip'));
  });
  return { setAnswers, onSkip };
}

describe('DescriptionStep skip', () => {
  it('clears the fragment and moves on', async () => {
    const { setAnswers, onSkip } = await renderStep(true);
    expect(setAnswers).toHaveBeenCalledWith({ descRecognise: '' });
    expect(onSkip).toHaveBeenCalled();
  });

  it('does nothing mid-move — never clears text it cannot move on from', async () => {
    const { setAnswers, onSkip } = await renderStep(false);
    expect(setAnswers).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
  });
});
