/**
 * WHAT:  Tests for the posting wizard's money step (BountyStep) wording: the
 *        slider is labelled "Reward", and the suggestion above it and the
 *        reach line under it name the SAME audience — spotters watching
 *        this area.
 * WHY:   The copy glossary (ADR-0014, 2026-09-21) makes "reward" the word an
 *        owner reads; this step was the one place it still said "Bounty".
 *        And both lines count the same people (alert zones whose minimum the
 *        reward meets), so calling them "reporting near here" in one and
 *        "watching this area" in the other read as two different groups —
 *        and "reporting" claimed sightings nobody had made.
 * LINKS: ./postSteps.tsx (BountyStep); ../lib/bountyRecommendation.ts (what
 *        reach measures); src/shared/ui/BountyTag.tsx (the glossary note).
 */

import { render } from '@testing-library/react-native';

import { BountyStep } from './postSteps';

jest.mock('../hooks/useBountyGuidance', () => ({
  useBountyGuidance: () => ({
    guidance: { rungs: [{ bountyPence: 10000, reach: 12 }], local: null },
    recommendation: { lowPence: 5000, midPence: 10000, highPence: 20000, basis: 'reach' },
  }),
}));

// The step only needs the slider's label and footnote; the rest of the shared
// UI (maps, pickers) is irrelevant here and native-heavy.
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text, View } = require('react-native');
  const Nothing = () => null;
  return {
    MoneySlider: ({ label, footnote }: { label: string; footnote?: string }) => (
      <View>
        <Text>{label}</Text>
        {footnote ? <Text>{footnote}</Text> : null}
      </View>
    ),
    defaultBountyPanelCopy: {},
    CardSelect: Nothing,
    ChoiceChips: Nothing,
    LocationPicker: Nothing,
    PhotoGridPicker: Nothing,
    StepSkipButton: Nothing,
    TextField: Nothing,
  };
});
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: () => null }));
jest.mock('@/shared/lib/location/expoLocationServices', () => ({ expoLocationServices: {} }));
jest.mock('@/shared/lib/location/useDefaultMapCentre', () => ({ useDefaultMapCentre: () => null }));
jest.mock('./LastSeenTimeField', () => ({ LastSeenTimeField: () => null }));
jest.mock('./ColourField', () => ({ ColourField: () => null }));
jest.mock('./DistinctiveFeaturesField', () => ({ DistinctiveFeaturesField: () => null }));
jest.mock('./MakeField', () => ({ MakeField: () => null }));
jest.mock('./ModelField', () => ({ ModelField: () => null }));

const props = {
  answers: { bountyAmountPence: 25000, location: { latitude: 51.5, longitude: -0.1 } },
  setAnswers: jest.fn(),
} as unknown as Parameters<typeof BountyStep>[0];

describe('BountyStep wording', () => {
  it('labels the slider "Reward" and never says "bounty"', async () => {
    const view = await render(<BountyStep {...props} />);
    expect(view.getByText('Reward')).toBeTruthy();
    expect(view.queryByText(/bounty/i)).toBeNull();
  });

  it('names one audience — spotters watching this area — above and below the slider', async () => {
    const view = await render(<BountyStep {...props} />);
    expect(view.getByText('Around £100 reaches most spotters watching this area')).toBeTruthy();
    expect(view.getByText('Reaches 12 spotters watching this area')).toBeTruthy();
    expect(view.queryByText(/reporting near here/)).toBeNull();
  });
});
