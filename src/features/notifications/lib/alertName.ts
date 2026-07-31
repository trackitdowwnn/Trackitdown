/**
 * WHAT:  Human copy derived from an alert — the wizard's suggested NAME
 *        ("Blue BMWs near Luton") and the list screen's SUMMARY line
 *        ("10 miles · Blue BMWs · £500+").
 * WHY:   Naming is the last step of the wizard and the one most likely to be
 *        answered with a shrug. A prefilled, editable suggestion means the
 *        common case is one tap, and the list screen never fills up with
 *        "Alert 1", "Alert 2" — which is what makes several alerts navigable
 *        at all.
 *        Pure and dependency-free so the wording is unit-tested rather than
 *        eyeballed on a device.
 * LINKS: ../types.ts (AlertCriteria); ./alertFlow.tsx (the name step's seed);
 *        src/features/notifications/screens/AlertsScreen.tsx (shows the name).
 */

import { formatPounds } from '@/shared/lib/money';

import { MAX_ALERT_NAME_LENGTH, type Alert, type AlertCriteria } from '../types';

/** Naive English plural, enough for car makes and body types. Words already
 *  ending in s ("Lexus") are left alone rather than becoming "Lexuss". */
function pluralise(word: string): string {
  const trimmed = word.trim();
  if (!trimmed) return trimmed;
  return /s$/i.test(trimmed) ? trimmed : `${trimmed}s`;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The car half of the name.
 *
 * A specific MODEL reads as one car ("BMW 320d"), so it is never pluralised.
 * Anything broader is a category and is ("BMWs", "Blue cars", "Vans").
 * Returns null when the alert isn't narrowed by car at all.
 */
function describeCar(criteria: AlertCriteria): string | null {
  const colour = clean(criteria.colour);
  const make = clean(criteria.make);
  const model = clean(criteria.model);
  const bodyType = clean(criteria.bodyType);

  if (make && model) {
    // Most specific: never pluralised, colour first if given.
    return [colour, make, model].filter(Boolean).join(' ');
  }
  if (make) return [colour, pluralise(make)].filter(Boolean).join(' ');
  if (bodyType) return [colour, pluralise(bodyType)].filter(Boolean).join(' ');
  if (colour) return `${colour} cars`;
  return null;
}

/**
 * @param placeLabel a human place from the location step ("Luton"). Null when
 *   the geocode failed or was skipped — the name then avoids naming a place
 *   rather than inventing one.
 */
export function suggestAlertName(
  criteria: AlertCriteria,
  placeLabel: string | null,
  radiusMiles: number,
): string {
  const place = clean(placeLabel);
  const car = describeCar(criteria);

  // Narrowed by car: the car IS the identity, the place is context.
  //   "Blue BMWs near Luton" / "Blue BMWs near me"
  if (car) {
    return truncate(place ? `${car} near ${place}` : `${car} near me`);
  }

  // Any car: the area is all there is to say, so lead with the radius —
  // otherwise every unfiltered alert would be named the same thing.
  const miles = `${radiusMiles} ${radiusMiles === 1 ? 'mile' : 'miles'}`;
  return truncate(place ? `${miles} around ${place}` : `${miles} around me`);
}

/** Names are bounded server-side; trim here so the prefill is never rejected. */
function truncate(name: string): string {
  return name.length <= MAX_ALERT_NAME_LENGTH ? name : name.slice(0, MAX_ALERT_NAME_LENGTH).trim();
}

/**
 * The list row's second line — what this alert actually watches, in the order
 * a person would read it: how wide, which cars, then the extra filters.
 *
 * The NAME is the user's own words and may say nothing useful ("Test 2"), so
 * this line is what makes a list of five alerts tellable apart. It never
 * repeats the name.
 */
export function summariseAlert(alert: Alert): string {
  const parts: string[] = [
    `${alert.radiusMiles} ${alert.radiusMiles === 1 ? 'mile' : 'miles'}`,
  ];

  const car = describeCar(alert.criteria);
  parts.push(car ?? 'Any car');

  if (alert.criteria.minBountyPence) {
    parts.push(`${formatPounds(alert.criteria.minBountyPence)}+`);
  }
  if (alert.criteria.recencyDays) {
    parts.push(`seen in ${alert.criteria.recencyDays}d`);
  }

  return parts.join(' · ');
}
