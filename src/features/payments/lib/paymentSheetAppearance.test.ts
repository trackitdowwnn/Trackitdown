/**
 * WHAT:  Tests for paymentSheetAppearance — the payment sheet's look from the
 *        app's tokens.
 * WHY:   The sheet is native, so nothing on screen can be tested in Jest; what
 *        can be pinned is that it is BUILT from the tokens (both schemes, the
 *        shared radius) and names no runtime-loaded font it can't use.
 * LINKS: ./paymentSheetAppearance.ts; src/shared/theme/colors.ts.
 */

import { paletteFor, radii } from '@/shared/theme';

import { paymentSheetAppearance } from './paymentSheetAppearance';

describe('paymentSheetAppearance', () => {
  const appearance = paymentSheetAppearance();

  it.each(['light', 'dark'] as const)('%s: colours come from that palette', (scheme) => {
    const p = paletteFor(scheme);
    const colors = (appearance.colors as Record<string, Record<string, string>>)[scheme];
    expect(colors).toMatchObject({
      primary: p.primary,
      background: p.surface,
      primaryText: p.textPrimary,
      secondaryText: p.textSecondary,
      componentBorder: p.border,
      error: p.danger,
    });
    const button = (appearance.primaryButton?.colors as Record<string, Record<string, string>>)[
      scheme
    ];
    expect(button).toMatchObject({ background: p.primary, text: p.textOnPrimary });
  });

  it('inputs and the button share the app’s control radius', () => {
    expect(appearance.shapes?.borderRadius).toBe(radii.md);
    expect(appearance.primaryButton?.shapes?.borderRadius).toBe(radii.md);
  });

  it('names no font — the native sheet cannot use one loaded at runtime', () => {
    expect(appearance.font).toBeUndefined();
    expect(appearance.primaryButton?.font).toBeUndefined();
  });
});
