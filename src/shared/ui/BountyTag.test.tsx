/**
 * WHAT:  Tests for BountyTag — pence-to-pounds rendering through the shared
 *        formatter at both sizes, and the two meanings of a null bounty ("No
 *        reward" vs "Reward ended", ADR-0020), in the tag and in bountyLabel.
 * WHY:   The bounty amount is the action driver on every card; showing a
 *        wrong amount is a money-display bug (docs/DOMAIN.md) even though
 *        no arithmetic happens here. A lapsed reward read as "No reward" would
 *        tell spotters the owner paid a fee instead — false.
 * LINKS: src/shared/ui/BountyTag.tsx, src/shared/lib/money.ts,
 *        docs/decisions/ADR-0020 (reward term).
 */

import { render } from '@testing-library/react-native';

import { BountyTag, bountyLabel, NO_BOUNTY_LABEL, REWARD_ENDED_LABEL } from './BountyTag';

describe('BountyTag', () => {
  it('formats integer pence through the shared money formatter', async () => {
    const { getByText } = await render(<BountyTag bountyPence={50000} />);

    expect(getByText('£500 reward')).toBeTruthy();
  });

  it('keeps fractional amounts to two decimals at lg size', async () => {
    const { getByText } = await render(<BountyTag bountyPence={125050} size="lg" />);

    expect(getByText('£1,250.50 reward')).toBeTruthy();
  });

  // ADR-0014. This is the component that decides what "no reward" looks like
  // everywhere, so these two assertions cover every card, pin and sheet.
  it('renders a no-reward listing as "No reward", never as £0', async () => {
    const { getByText, queryByText } = await render(<BountyTag bountyPence={null} />);

    expect(getByText(NO_BOUNTY_LABEL)).toBeTruthy();
    // The whole reason posts.bounty_amount_pence is NULLABLE rather than 0.
    expect(queryByText('£0 reward')).toBeNull();
    expect(queryByText('£0')).toBeNull();
  });

  it('does not throw on a null bounty', async () => {
    // formatPounds THROWS on a non-integer, so a null reaching it would take
    // down whatever surface rendered the tag rather than mis-label it. The null
    // must be handled before the call, not softened inside the formatter.
    await expect(render(<BountyTag bountyPence={null} size="lg" />)).resolves.toBeTruthy();
  });

  // ADR-0020: a null bounty is ALSO a reward that ran its term and went back.
  describe('reward ended', () => {
    it('renders a lapsed reward as "Reward ended", not "No reward"', async () => {
      const { getByText, queryByText, getByLabelText } = await render(
        <BountyTag bountyPence={null} rewardEnded />,
      );

      expect(REWARD_ENDED_LABEL).toBe('Reward ended');
      expect(getByText('Reward ended')).toBeTruthy();
      expect(getByLabelText('Reward ended')).toBeTruthy();
      expect(queryByText(NO_BOUNTY_LABEL)).toBeNull();
    });

    it('lets an amount win over rewardEnded — a reward added again is shown', async () => {
      const { getByText, queryByText } = await render(
        <BountyTag bountyPence={20000} rewardEnded size="lg" />,
      );

      expect(getByText('£200 reward')).toBeTruthy();
      expect(queryByText(REWARD_ENDED_LABEL)).toBeNull();
    });

    it('bountyLabel speaks the same three sentences', () => {
      expect(bountyLabel(null, true)).toBe('Reward ended');
      expect(bountyLabel(5000, true)).toBe('£50 reward');
      expect(bountyLabel(null, false)).toBe(NO_BOUNTY_LABEL);
      // The default (older callers pass one argument) is the fee-listing reading.
      expect(bountyLabel(null)).toBe(NO_BOUNTY_LABEL);
    });
  });
});
