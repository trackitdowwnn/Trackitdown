/**
 * WHAT:  Tests for BountyTag — pence-to-pounds rendering through the shared
 *        formatter at both sizes.
 * WHY:   The bounty amount is the action driver on every card; showing a
 *        wrong amount is a money-display bug (docs/DOMAIN.md) even though
 *        no arithmetic happens here.
 * LINKS: src/shared/ui/BountyTag.tsx, src/shared/lib/money.ts.
 */

import { render } from '@testing-library/react-native';

import { BountyTag } from './BountyTag';

describe('BountyTag', () => {
  it('formats integer pence through the shared money formatter', async () => {
    const { getByText } = await render(<BountyTag bountyPence={50000} />);

    expect(getByText('£500 bounty')).toBeTruthy();
  });

  it('keeps fractional amounts to two decimals at lg size', async () => {
    const { getByText } = await render(<BountyTag bountyPence={125050} size="lg" />);

    expect(getByText('£1,250.50 bounty')).toBeTruthy();
  });
});
