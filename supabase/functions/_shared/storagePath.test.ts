/**
 * WHAT:  Tests for isOwnCleanPath — only a path inside the owner's own folder
 *        may be signed with the service role.
 * WHY:   Security audit lead 10: '<uid>/../<victim>/x.jpg' was signed into a
 *        stranger's export. Pins every form that could step outside.
 * LINKS: supabase/functions/_shared/storagePath.ts.
 */

import { isOwnCleanPath } from './storagePath';

const ME = '11111111-1111-1111-1111-111111111111';

describe('isOwnCleanPath', () => {
  it('accepts a plain file in the owner folder', () => {
    expect(isOwnCleanPath(`${ME}/bug-abc-0.jpg`, ME)).toBe(true);
  });

  it.each([
    [`${ME}/../22222222-2222-2222-2222-222222222222/x.jpg`, 'dot-dot segment'],
    [`${ME}/./x.jpg`, 'dot segment'],
    [`${ME}//x.jpg`, 'empty segment'],
    [`${ME}/`, 'trailing slash'],
    [`${ME}/%2e%2e/x.jpg`, 'percent-escape'],
    [`${ME}/x.jpg?download`, 'query'],
    [`${ME}/x.jpg#frag`, 'fragment'],
    [`${ME}/a\\b.jpg`, 'backslash'],
    [`${ME}/a${String.fromCharCode(10)}b.jpg`, 'control character'],
    ['22222222-2222-2222-2222-222222222222/x.jpg', 'another folder'],
    [`${ME}x/x.jpg`, 'a folder that only starts with the id'],
  ])('refuses %s (%s)', (path) => {
    expect(isOwnCleanPath(path, ME)).toBe(false);
  });

  it('refuses everything when the owner is unknown', () => {
    expect(isOwnCleanPath(`${ME}/x.jpg`, null)).toBe(false);
  });
});
