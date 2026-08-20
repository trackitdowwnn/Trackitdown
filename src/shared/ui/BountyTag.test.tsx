/**
 * WHAT:  Tests for BountyTag — pence-to-pounds rendering through the shared
 *        formatter at both sizes.
 * WHY:   The bounty amount is the action driver on every card; showing a
 *        wrong amount is a money-display bug (docs/DOMAIN.md) even though
 *        no arithmetic happens here.
 * LINKS: src/shared/ui/BountyTag.tsx, src/shared/lib/money.ts.
 */

import { render } from '@testing-library/react-native';

import { BountyTag, NO_BOUNTY_LABEL } from './BountyTag';

describe('BountyTag', () => {
  it('formats integer pence through the shared money formatter', async () => {
    const { getByText } = await render(<BountyTag bountyPence={50000} />);

    expect(getByText('£500 bounty')).toBeTruthy();
  });

  it('keeps fractional amounts to two decimals at lg size', async () => {
    const { getByText } = await render(<BountyTag bountyPence={125050} size="lg" />);

    expect(getByText('£1,250.50 bounty')).toBeTruthy();
  });

  // ADR-0014. This is the component that decides what "no reward" looks like
  // everywhere, so these two assertions cover every card, pin and sheet.
  it('renders a no-reward listing as "No reward", never as £0', async () => {
    const { getByText, queryByText } = await render(<BountyTag bountyPence={null} />);

    expect(getByText(NO_BOUNTY_LABEL)).toBeTruthy();
    // The whole reason posts.bounty_amount_pence is NULLABLE rather than 0.
    expect(queryByText('£0 bounty')).toBeNull();
    expect(queryByText('£0')).toBeNull();
  });

  it('does not throw on a null bounty', async () => {
    // formatPounds THROWS on a non-integer, so a null reaching it would take
    // down whatever surface rendered the tag rather than mis-label it. The null
    // must be handled before the call, not softened inside the formatter.
    await expect(render(<BountyTag bountyPence={null} size="lg" />)).resolves.toBeTruthy();
  });
});
