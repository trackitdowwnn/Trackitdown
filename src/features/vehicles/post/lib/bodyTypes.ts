/**
 * WHAT:  The body-type options for the post-a-car wizard's BodyTypeStep — the
 *        stored value (shown verbatim on the detail as "Body type: <value>"), a
 *        card title, and a lucide glyph. A "Not sure" escape lets the required
 *        step advance when the owner doesn't know (stored, but suppressed on the
 *        detail — see carDetails.ts).
 * WHY:   Body type is a strong recognition aid for a spotter ("was it a hatch or
 *        an SUV?"). Kept as data (not inline in the step) so the list sits in one
 *        place. NOTE: lucide has no body-type-specific car icons, so the glyphs
 *        are approximate (Car / CarFront / Truck / Bus).
 * LINKS: src/shared/ui/CardSelect.tsx (the renderer);
 *        src/features/vehicles/post/components/postSteps.tsx (BodyTypeStep);
 *        src/features/vehicles/lib/carDetails.ts (suppresses "Not sure");
 *        src/features/vehicles/post/api/postApi.ts (p_body_type — free text).
 */

import { Bus, Car, CarFront, CircleQuestionMark, Truck } from 'lucide-react-native';

import type { CardSelectOption } from '@/shared/ui';

/** The "unknown" escape value — a real value so the REQUIRED step can advance,
 *  but treated as "not provided" on the detail (carDetails.ts). */
export const BODY_TYPE_UNKNOWN = 'Not sure';

/** Single-select body types. `value` is stored on posts.body_type (free text)
 *  and rendered verbatim on the detail, so keep it a clean, human word. */
export const BODY_TYPE_OPTIONS: CardSelectOption[] = [
  { value: 'Hatchback', label: 'Hatchback', icon: Car },
  { value: 'Saloon', label: 'Saloon', icon: CarFront },
  { value: 'Estate', label: 'Estate', icon: Car },
  { value: 'SUV', label: 'SUV / 4×4', icon: Truck },
  { value: 'Coupé', label: 'Coupé', icon: Car },
  { value: 'Convertible', label: 'Convertible', icon: Car },
  { value: 'MPV', label: 'MPV / People carrier', icon: Bus },
  { value: 'Van', label: 'Van', icon: Truck },
  { value: 'Pickup', label: 'Pickup', icon: Truck },
  { value: BODY_TYPE_UNKNOWN, label: 'Not sure', icon: CircleQuestionMark },
];
