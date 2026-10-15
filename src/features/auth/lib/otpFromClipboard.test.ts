/**
 * WHAT:  Tests for extractOtp — what counts as a sign-in code on the clipboard.
 * WHY:   A wrong guess costs a sign-in attempt (two emails an hour), so the
 *        refusals matter as much as the matches.
 * LINKS: ./otpFromClipboard.ts.
 */

import { extractOtp } from './otpFromClipboard';

describe('extractOtp', () => {
  it.each([
    ['12345678', '12345678'],
    ['  12345678\n', '12345678'],
    ['1234 5678', '12345678'],
    ['1234-5678', '12345678'],
    ['Your code is 12345678', '12345678'],
  ])('takes %j as the code', (clip, code) => {
    expect(extractOtp(clip)).toBe(code);
  });

  it.each([
    ['', 'nothing'],
    ['123456789', 'a longer number'],
    ['1234567', 'too short'],
    ['12345678 or 87654321', 'two candidates'],
    [`Ref 12345678 ${'x'.repeat(200)}`, 'a long text'],
    ['call 07700 900123', 'a phone number'],
  ])('refuses %j — %s', (clip) => {
    expect(extractOtp(clip)).toBeNull();
  });

  it('honours another length', () => {
    expect(extractOtp('123456', 6)).toBe('123456');
    expect(extractOtp('12345678', 6)).toBeNull();
  });
});
