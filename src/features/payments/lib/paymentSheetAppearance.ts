/**
 * WHAT:  The payment sheet's look, from the app's own tokens — colours for
 *        both schemes, the input/button corner radius, the primary button.
 * WHY:   The sheet opened in the payment partner's default blue-and-grey,
 *        the one screen in the app that didn't look like the app, at the one
 *        moment trust matters most (2026-10-16). Built from the palette, never
 *        hex here, so a token change reaches the sheet too.
 *
 *        NO FONT, deliberately: Satoshi is loaded at runtime (src/app/
 *        _layout.tsx), and the native sheet can only use a font bundled into
 *        the APK. Naming it here would fall back silently on some devices.
 *
 *        The sheet follows the PHONE's dark mode, not the in-app preference —
 *        it is native and cannot read ours — so both palettes are given.
 * LINKS: ../hooks/useBountyPayment.ts (the consumer);
 *        src/shared/theme/colors.ts; src/shared/ui/Button.tsx (radius).
 */

import type { PaymentSheet } from '@stripe/stripe-react-native';

import { paletteFor, radii, type Palette } from '@/shared/theme';

const sheetColors = (p: Palette) => ({
  primary: p.primary,
  background: p.surface,
  componentBackground: p.surface,
  componentBorder: p.border,
  componentDivider: p.border,
  primaryText: p.textPrimary,
  secondaryText: p.textSecondary,
  componentText: p.textPrimary,
  placeholderText: p.textSecondary,
  icon: p.textSecondary,
  error: p.danger,
});

const buttonColors = (p: Palette) => ({
  background: p.primary,
  text: p.textOnPrimary,
  border: p.primary,
});

export function paymentSheetAppearance(): PaymentSheet.AppearanceParams {
  const light = paletteFor('light');
  const dark = paletteFor('dark');
  return {
    colors: { light: sheetColors(light), dark: sheetColors(dark) },
    // Inputs and buttons share `md` across the app (Button, TextField).
    shapes: { borderRadius: radii.md, borderWidth: 1 },
    primaryButton: {
      colors: { light: buttonColors(light), dark: buttonColors(dark) },
      shapes: { borderRadius: radii.md },
    },
  };
}
