/**
 * WHAT:  Tests for the reward-listing charge rule (ADR-0020).
 * WHY:   Tier 1 money (docs/TESTING.md). The Edge Function charges what this
 *        returns, and record_post_payment_intent refuses any other amount — so
 *        a drift between this and the SQL rule shows up as every reward listing
 *        failing to start its payment. These pin the TypeScript half to the
 *        exact arithmetic the SQL half uses: `(reward * 5) / 100`, integer
 *        division, and `charge = reward + fee`.
 * LINKS: ./serviceFee.ts;
 *        supabase/migrations/20260925100000_the_reward_is_the_reward.sql;
 *        supabase/tests/fee_on_top_verification.sql (the SQL half's checks).
 */

import { rewardCharge, SERVICE_FEE_PERCENT } from './serviceFee';

describe('rewardCharge', () => {
  it('adds 5% on top of the reward, leaving the reward whole', () => {
    expect(rewardCharge(50000)).toEqual({
      rewardPence: 50000,
      serviceFeePence: 2500,
      chargePence: 52500,
    });
  });

  it('prices the bounds: £10 → £10.50, £5,000 → £5,250', () => {
    expect(rewardCharge(1000).chargePence).toBe(1050);
    expect(rewardCharge(500000).chargePence).toBe(525000);
  });

  it('rounds the fee DOWN, never charging more than 5%', () => {
    // 5% of 1234p is 61.7p — floor, like Postgres integer division.
    expect(rewardCharge(1234)).toEqual({
      rewardPence: 1234,
      serviceFeePence: 61,
      chargePence: 1295,
    });
    for (const reward of [1001, 1019, 12345, 99999, 499999]) {
      const { serviceFeePence } = rewardCharge(reward);
      expect(serviceFeePence).toBe(Math.floor((reward * 5) / 100));
      expect(serviceFeePence * 100).toBeLessThanOrEqual(reward * SERVICE_FEE_PERCENT);
    }
  });

  it('is exact for every whole-pound reward the slider can produce', () => {
    for (let pounds = 10; pounds <= 5000; pounds += 1) {
      const reward = pounds * 100;
      const { serviceFeePence, chargePence } = rewardCharge(reward);
      expect(serviceFeePence).toBe(pounds * 5);
      expect(chargePence).toBe(reward + serviceFeePence);
    }
  });

  it('refuses anything that is not positive integer pence', () => {
    expect(() => rewardCharge(0)).toThrow(/positive integer pence/);
    expect(() => rewardCharge(-100)).toThrow(/positive integer pence/);
    expect(() => rewardCharge(100.5)).toThrow(/positive integer pence/);
  });
});
