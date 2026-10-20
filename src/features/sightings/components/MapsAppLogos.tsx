/**
 * WHAT:  The two maps apps' own marks for the owner's sighting page's buttons:
 *        GoogleMapsLogo (the four-colour 2020 pin) and WazeLogo (the smiling
 *        mascot on Waze blue, as its app icon shows it). 20dp, inline SVG.
 * WHY:   The owner asked for each app's icon on its button (2026-10-20), in
 *        its own colours — a recognisable mark is quicker to pick than a name.
 *
 *        ⚠️ BRAND COLOURS ARE NOT PALETTE TOKENS and never change with the
 *        theme, the same rule as the Google "G" in SocialSignInButtons. The
 *        marks are unmodified: Google Maps from Google's own icon (via
 *        Wikimedia Commons, "Google Maps icon (2020)"); Waze from the Simple
 *        Icons path (CC0 data), its outer contour filled white under the
 *        outline so the mascot reads as in Waze's app icon.
 *        Hidden from screen readers — the button's label names the app.
 * LINKS: ./SightingWhereSection.tsx (the buttons);
 *        src/features/auth/components/SocialSignInButtons.tsx (the pattern).
 */

import Svg, { Path, Rect } from 'react-native-svg';

/** The marks' size — Google's guidelines give 18–20dp for an app mark. */
const LOGO = 20;

/** Brand values, deliberately not palette tokens (see the header). */
const GOOGLE_MAPS = {
  blueDark: '#1a73e8',
  red: '#ea4335',
  blue: '#4285f4',
  yellow: '#fbbc04',
  green: '#34a853',
} as const;
const WAZE = { tile: '#33CCFF', body: '#FFFFFF', ink: '#000000' } as const;

/** Google Maps' 2020 pin — five official segments, unmodified. */
export function GoogleMapsLogo() {
  return (
    <Svg
      // The pin is taller than wide (92.3 × 132.3): full height, width to scale.
      width={Math.round((LOGO * 92.3) / 132.3)}
      height={LOGO}
      viewBox="0 0 92.3 132.3"
      testID="google-maps-logo"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path
        fill={GOOGLE_MAPS.blueDark}
        d="M60.2 2.2C55.8.8 51 0 46.1 0 32 0 19.3 6.4 10.8 16.5l21.8 18.3L60.2 2.2z"
      />
      <Path
        fill={GOOGLE_MAPS.red}
        d="M10.8 16.5C4.1 24.5 0 34.9 0 46.1c0 8.7 1.7 15.7 4.6 22l28-33.3-21.8-18.3z"
      />
      <Path
        fill={GOOGLE_MAPS.blue}
        d="M46.2 28.5c9.8 0 17.7 7.9 17.7 17.7 0 4.3-1.6 8.3-4.2 11.4 0 0 13.9-16.6 27.5-32.7-5.6-10.8-15.3-19-27-22.7L32.6 34.8c3.3-3.8 8.1-6.3 13.6-6.3"
      />
      <Path
        fill={GOOGLE_MAPS.yellow}
        d="M46.2 63.8c-9.8 0-17.7-7.9-17.7-17.7 0-4.3 1.5-8.3 4.1-11.3l-28 33.3c4.8 10.6 12.8 19.2 21 29.9l34.1-40.5c-3.3 3.9-8.1 6.3-13.5 6.3"
      />
      <Path
        fill={GOOGLE_MAPS.green}
        d="M59.1 109.2c15.4-24.1 33.3-35 33.3-63 0-7.7-1.9-14.9-5.2-21.3L25.6 98c2.6 3.4 5.3 7.3 7.9 11.3 9.4 14.5 6.8 23.1 12.8 23.1s3.4-8.7 12.8-23.2"
      />
    </Svg>
  );
}

/** The mascot's outer contour (wheels included) — filled white under the
 *  outline, so the face is white as in Waze's app icon. */
const WAZE_CONTOUR =
  'M13.218 0C9.915 0 6.835 1.49 4.723 4.148c-1.515 1.913-2.31 4.272-2.31 6.706v1.739c0 .894-.62 1.738-1.862 1.813-.298.025-.547.224-.547.522-.05.82.82 2.31 2.012 3.502.82.844 1.788 1.515 2.832 2.036a3 3 0 0 0 2.955 3.528 2.966 2.966 0 0 0 2.931-2.385h2.509c.323 1.689 2.086 2.856 3.974 2.21 1.64-.546 2.36-2.409 1.763-3.924a12.84 12.84 0 0 0 1.838-1.465 10.73 10.73 0 0 0 3.18-7.65c0-2.882-1.118-5.589-3.155-7.625A10.899 10.899 0 0 0 13.218 0z';

/** The full Simple Icons Waze mark: outline, eyes and smile. */
const WAZE_MARK =
  'M13.218 0C9.915 0 6.835 1.49 4.723 4.148c-1.515 1.913-2.31 4.272-2.31 6.706v1.739c0 .894-.62 1.738-1.862 1.813-.298.025-.547.224-.547.522-.05.82.82 2.31 2.012 3.502.82.844 1.788 1.515 2.832 2.036a3 3 0 0 0 2.955 3.528 2.966 2.966 0 0 0 2.931-2.385h2.509c.323 1.689 2.086 2.856 3.974 2.21 1.64-.546 2.36-2.409 1.763-3.924a12.84 12.84 0 0 0 1.838-1.465 10.73 10.73 0 0 0 3.18-7.65c0-2.882-1.118-5.589-3.155-7.625A10.899 10.899 0 0 0 13.218 0zm0 1.217c2.558 0 4.967.994 6.78 2.807a9.525 9.525 0 0 1 2.807 6.78A9.526 9.526 0 0 1 20 17.585a9.647 9.647 0 0 1-6.78 2.807h-2.46a3.008 3.008 0 0 0-2.93-2.41 3.03 3.03 0 0 0-2.534 1.367v.024a8.945 8.945 0 0 1-2.41-1.788c-.844-.844-1.316-1.614-1.515-2.11a2.858 2.858 0 0 0 1.441-.846 2.959 2.959 0 0 0 .795-2.036v-1.789c0-2.11.696-4.197 2.012-5.861 1.863-2.385 4.62-3.726 7.6-3.726zm-2.41 5.986a1.192 1.192 0 0 0-1.191 1.192 1.192 1.192 0 0 0 1.192 1.193A1.192 1.192 0 0 0 12 8.395a1.192 1.192 0 0 0-1.192-1.192zm7.204 0a1.192 1.192 0 0 0-1.192 1.192 1.192 1.192 0 0 0 1.192 1.193 1.192 1.192 0 0 0 1.192-1.193 1.192 1.192 0 0 0-1.192-1.192zm-7.377 4.769a.596.596 0 0 0-.546.845 4.813 4.813 0 0 0 4.346 2.757 4.77 4.77 0 0 0 4.347-2.757.596.596 0 0 0-.547-.845h-.025a.561.561 0 0 0-.521.348 3.59 3.59 0 0 1-3.254 2.061 3.591 3.591 0 0 1-3.254-2.061.64.64 0 0 0-.546-.348z';

/** Waze's mascot on its blue tile, as the app icon shows it. */
export function WazeLogo() {
  return (
    <Svg
      width={LOGO}
      height={LOGO}
      // The 24-unit mark sits inside a 32-unit tile, 4 units in all round.
      viewBox="-4 -4 32 32"
      testID="waze-logo"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Rect x={-4} y={-4} width={32} height={32} rx={7} fill={WAZE.tile} />
      <Path fill={WAZE.body} d={WAZE_CONTOUR} />
      <Path fill={WAZE.ink} d={WAZE_MARK} />
    </Svg>
  );
}
