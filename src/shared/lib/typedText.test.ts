/**
 * WHAT:  Tests for withoutNul() — NUL removed, everything else untouched.
 * WHY:   One pasted NUL fails a whole request at the database; one character
 *        too many removed would change what someone wrote.
 * LINKS: ./typedText.ts.
 */

import { withoutNul } from './typedText';

const NUL = String.fromCharCode(0);

describe('withoutNul', () => {
  it('removes every NUL, wherever it is', () => {
    expect(withoutNul(`${NUL}Dent${NUL} on the${NUL}${NUL} door${NUL}`)).toBe('Dent on the door');
    expect(withoutNul(NUL)).toBe('');
  });

  it('leaves everything else exactly as typed — including other hidden characters', () => {
    const zeroWidth = String.fromCharCode(0x200b);
    const fire = String.fromCodePoint(0x1f525);
    const text = `  Line one\nline two\t${zeroWidth}${fire} `;
    expect(withoutNul(text)).toBe(text);
    expect(withoutNul('')).toBe('');
  });
});
