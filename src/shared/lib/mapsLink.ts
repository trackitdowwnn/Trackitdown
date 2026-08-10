/**
 * WHAT:  mapPinUrl — drops a PIN at a coordinate in the platform's own maps
 *        app, with an optional caption. It does NOT start navigation.
 * WHY:   The owner reading where their car was sighted has, until now, had no
 *        way out of our static map — the only route to a real maps app was
 *        reading coordinates off a screen that doesn't display any.
 *
 *        A PIN, never turn-by-turn, and the name says so. SECURITY_AND_TRUST §1
 *        bans features that facilitate pursuit — "no live navigation toward a
 *        sighted car" — so this deliberately emits the *show me this place*
 *        form (`ll=` / `geo:?q=`) and not the navigation form (`daddr=` /
 *        `google.navigation:`). It was briefly called `directionsUrl`, which
 *        described neither what it emits nor what §1 permits.
 *
 *        ONE CONSUMER, owner-only: the sighting detail screen. A "Directions"
 *        button was also added to the PUBLIC listing body on 2026-08-08 and
 *        removed the same day — §1's ban is explicitly "no directions from
 *        spotter to vehicle", and that body is what every spotter and every
 *        logged-out browser reads.
 *
 *        Pure and separate from the screens so the URL shapes are unit-tested
 *        (precedent: postShare.ts, which does the same for the share payload).
 *        Platform split, because there is no one URL that behaves well on both:
 *        iOS `maps://` opens Apple Maps directly, and Android's `geo:` is the
 *        documented chooser intent — it offers whatever the user actually has
 *        installed rather than assuming Google Maps. Both take `q`/`ll` in
 *        decimal degrees, LAT FIRST.
 * LINKS: src/features/sightings/screens/SightingDetailScreen.tsx (the only
 *        consumer); src/shared/lib/mapsLink.test.ts;
 *        docs/SECURITY_AND_TRUST.md §1.
 */

import { Platform } from 'react-native';

/** Longest caption we will put in a URL — a pin caption, not a description. */
const MAX_LABEL_LENGTH = 40;

/**
 * Make a caption safe to sit inside `geo:0,0?q=lat,lng(HERE)`.
 *
 * encodeURIComponent leaves `( ) ' ! * ~` alone, and the Android form
 * terminates the caption with `)`. A caption containing one could therefore
 * close the group early and append text to a URI we hand to whatever app
 * claims `geo:`. Bounded — `,` `&` `?` `=` ARE encoded, so no second
 * coordinate and no extra parameter can be smuggled in — but "bounded" is not
 * "safe", and any caption we build from user-authored text (a colour, a
 * make, a model: all free text with no CHECK constraint) must not be able to
 * reach the URI grammar at all. Parens are dropped rather than escaped:
 * percent-escaping renders as literal `%28` in some maps apps.
 */
function safeLabel(label: string): string {
  return label.replace(/[()]/g, '').slice(0, MAX_LABEL_LENGTH).trim();
}

/**
 * A maps-app URL that DROPS A PIN at one point. Never turn-by-turn — see the
 * §1 reasoning in this file's header before changing that.
 *
 * `label` captions the pin. Keep it a fixed, non-identifying string: it is
 * handed to a third party (Google/Apple), so it should describe the PLACE, not
 * the car or the person. `safeLabel` strips and bounds it regardless.
 *
 * Returns a string for every input — callers still wrap the openURL in a catch,
 * because a device CAN have no maps app at all (a stripped Android build), and
 * that is a "we couldn't open it" toast, not a crash.
 */
export function mapPinUrl(
  latitude: number,
  longitude: number,
  label?: string,
): string {
  const coords = `${latitude},${longitude}`;
  const trimmed = label ? safeLabel(label) : undefined;

  if (Platform.OS === 'ios') {
    // Apple Maps. `ll` is the point; `q` is only the pin's caption — sending a
    // label as `q` ALONE would make Apple Maps run it as a search string and
    // land the user on some other "Blue BMW" entirely.
    return trimmed
      ? `maps://?ll=${coords}&q=${encodeURIComponent(trimmed)}`
      : `maps://?ll=${coords}`;
  }

  // Android's chooser intent. The `geo:0,0?q=lat,lng(Label)` form is the one
  // that keeps the LABEL without turning the coordinate into a search: the
  // leading 0,0 is required by the scheme and ignored once `q` carries a point.
  return trimmed
    ? `geo:0,0?q=${coords}(${encodeURIComponent(trimmed)})`
    : `geo:${coords}?q=${coords}`;
}
