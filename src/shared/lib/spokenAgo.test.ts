/**
 * WHAT:  Tests for spokenAgo — the compact "5m ago" spelled out for screen
 *        readers, singular and plural, and anything else left alone.
 * WHY:   VoiceOver reads "5m" as "five metres"; the owner's sighting page and
 *        the report flow's check-and-send step both rely on this.
 * LINKS: src/shared/lib/spokenAgo.ts.
 */

import { spokenAgo } from './spokenAgo';

describe('spokenAgo', () => {
  it.each([
    ['1m ago', '1 minute ago'],
    ['5m ago', '5 minutes ago'],
    ['1h ago', '1 hour ago'],
    ['2h ago', '2 hours ago'],
    ['1d ago', '1 day ago'],
    ['3d ago', '3 days ago'],
    ['1w ago', '1 week ago'],
    ['12w ago', '12 weeks ago'],
  ])('spells out %s as "%s"', (ago, spoken) => {
    expect(spokenAgo(ago)).toBe(spoken);
  });

  it('leaves anything else as it is', () => {
    expect(spokenAgo('just now')).toBe('just now');
    expect(spokenAgo('8 Oct')).toBe('8 Oct');
  });
});
