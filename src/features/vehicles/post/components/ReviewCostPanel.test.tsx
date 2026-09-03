/**
 * WHAT:  Tests for the review step's cost panel — the sum shown on the last
 *        screen before a card charge.
 * WHY:   The panel's central claim is that it CANNOT name a different sum from
 *        the pay button beside it, and until now that claim existed only as a
 *        comment. The two read the same answers through different code paths
 *        (`ReviewCostPanel` vs `finalCtaLabel`), so nothing but a test stops
 *        them drifting — and a screen that says "Reward £250" over a button
 *        saying "Post & pay £400" is the worst bug this surface can have.
 *
 *        Every expectation is computed from the shared money helpers rather
 *        than typed as a literal, for the same reason the flow's own mock now
 *        re-exports the real bounds: a test that invents the number it checks
 *        is guarding nothing.
 * LINKS: ./ReviewCostPanel.tsx; ../postACarFlow.tsx (finalCtaLabel);
 *        src/shared/lib/money.ts.
 */

import { render } from '@testing-library/react-native';

import { estimateRefundPence, formatPounds, LISTING_FEE_PENCE } from '@/shared/lib/money';

import { postACarFlow, POST_A_CAR_INITIAL_ANSWERS } from '../postACarFlow';
import type { PostACarAnswers } from '../types';
import { ReviewCostPanel } from './ReviewCostPanel';

// The step components pull in the map/slider/picker native graph; the panel
// needs none of it, but importing the flow for finalCtaLabel does.
jest.mock('./postSteps', () => ({
  MakeStep: () => null,
  ModelStep: () => null,
  ColourStep: () => null,
  BodyTypeStep: () => null,
  YearStep: () => null,
  DistinctiveFeaturesStep: () => null,
  PhotosStep: () => null,
  LastSeenWhenStep: () => null,
  LastSeenWhereStep: () => null,
  DescriptionStep: () => null,
  PricingModeStep: () => null,
  BountyStep: () => null,
  // Bounds AND the seed, from the real leaf. Inventing any of them here is the
  // pattern this file's own header condemns — and the one postACarFlow.test.ts
  // was just fixed for, where a hard-coded MIN_BOUNTY_PENCE meant a money
  // boundary was checked against a floor the app had stopped enforcing.
  ...jest.requireActual('@/shared/lib/bountyBounds'),
}));

/** The label the pay button shows for the same answers. Resolved here rather
 *  than through the framework helper, so this test is checking the FLOW'S OWN
 *  config against the panel — the two things that could actually disagree. */
const ctaLabelFor = (answers: Partial<PostACarAnswers>) => {
  const label = postACarFlow.finalCtaLabel;
  return typeof label === 'function' ? label(answers) : label;
};

describe('the sum matches the pay button', () => {
  const cases: { name: string; answers: Partial<PostACarAnswers> }[] = [
    {
      name: 'a chosen reward',
      answers: { pricingMode: 'bounty', bountyAmountPence: 40000 },
    },
    {
      name: 'the seeded reward nobody moved',
      // Spread FIRST so this stays correct even if the seed ever gains a
      // pricingMode of its own (it deliberately has none today).
      answers: { ...POST_A_CAR_INITIAL_ANSWERS, pricingMode: 'bounty' },
    },
    {
      name: 'a reward with the amount somehow absent',
      answers: { pricingMode: 'bounty' },
    },
    { name: 'the no-reward fee', answers: { pricingMode: 'fee' } },
    {
      // ⚠️ The one that would have bitten: fee mode still carries the slider's
      // seed, and the panel must ignore it exactly as the button does.
      name: 'the fee with a stale bounty seed still in the answers',
      answers: { pricingMode: 'fee', bountyAmountPence: 40000 },
    },
  ];

  it.each(cases)('$name', async ({ answers }) => {
    const view = await render(<ReviewCostPanel answers={answers} />);
    const label = ctaLabelFor(answers);

    // The button reads "Post & pay £X"; whatever X is, the panel must show it.
    const expected = label.replace('Post & pay ', '');
    expect(view.getByText(expected)).toBeTruthy();
  });
});

describe('what it says about the money', () => {
  it('quotes the refund from the ONE function, not a literal', async () => {
    // estimateRefundPence's own doc makes this binding: every surface quoting a
    // refund before the owner commits must use it, or two screens disagree.
    const bountyAmountPence = 40000;
    const view = await render(
      <ReviewCostPanel answers={{ pricingMode: 'bounty', bountyAmountPence }} />,
    );

    expect(
      view.getByText(
        new RegExp(formatPounds(estimateRefundPence(bountyAmountPence)).replace('£', '\\£')),
      ),
    ).toBeTruthy();
  });

  it('names the card costs, so the gap between the two figures is explained', async () => {
    const view = await render(
      <ReviewCostPanel answers={{ pricingMode: 'bounty', bountyAmountPence: 40000 }} />,
    );

    expect(view.getByText(/card processing costs are not refundable/i)).toBeTruthy();
  });

  it('calls the fee non-refundable and never quotes a refund for it', async () => {
    const view = await render(<ReviewCostPanel answers={{ pricingMode: 'fee' }} />);

    expect(view.getByText(formatPounds(LISTING_FEE_PENCE))).toBeTruthy();
    expect(view.getByText(/not refundable/i)).toBeTruthy();
    expect(view.queryByText(/comes back to you/i)).toBeNull();
  });

  it('⚠️ names NO sum until a pricing mode is chosen', async () => {
    // The slider seeds £250. Printing it before they picked a mode would assert
    // a reward nobody offered — the same wrong as the fee-mode bounty row, from
    // the other direction.
    const view = await render(<ReviewCostPanel answers={POST_A_CAR_INITIAL_ANSWERS} />);

    expect(view.queryByText(/What you/)).toBeNull();
    expect(view.queryByText(formatPounds(POST_A_CAR_INITIAL_ANSWERS.bountyAmountPence!))).toBeNull();
  });
});
