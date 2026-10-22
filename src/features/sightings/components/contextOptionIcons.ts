/**
 * WHAT:  The icon on every context answer's card — what it was doing, staying,
 *        anyone with it, its condition, the damage seen, the parts missing —
 *        and reviewCardIcon(), the icon for an answer shown back on
 *        check-and-send.
 * WHY:   The steps draw these cards to be tapped and check-and-send draws the
 *        chosen ones back (owner, 2026-10-22: "the same and the selection").
 *        One map each means the card on review always wears the icon the
 *        spotter tapped. Lives in components/, not lib/: the icons are React
 *        components, and lib/ stays free of them.
 * LINKS: ./contextSteps.tsx (the steps); ./ConfirmStep.tsx (the review);
 *        ../lib/contextLabels.ts (the words, and ContextReviewCard).
 */

import {
  Car,
  CarFront,
  CircleDashed,
  CircleParking,
  DoorOpen,
  Flame,
  FlipHorizontal2,
  Hammer,
  Lightbulb,
  LightbulbOff,
  PanelBottom,
  PanelTop,
  RectangleHorizontal,
  ShieldCheck,
  SquareDashed,
  SquareParking,
  SquareSlash,
  TriangleAlert,
  Truck,
  User,
  UserX,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';

import type { ContextReviewCard } from '../lib/contextLabels';
import type {
  ConditionFlag,
  DamageKind,
  MissingPart,
  ParkedLikelihood,
  PeoplePresence,
  VehicleStateFlag,
} from '../types';

export const STATE_ICONS: Record<VehicleStateFlag, LucideIcon> = {
  parked: SquareParking,
  driving: Car,
  being_loaded: Truck,
};
export const STAYING_ICONS: Partial<Record<ParkedLikelihood, LucideIcon>> = {
  settled: CircleParking,
  moving: CarFront,
};
export const PEOPLE_ICONS: Record<PeoplePresence, LucideIcon> = {
  nobody: UserX,
  nearby: Users,
  in_vehicle: User,
};
export const CONDITION_ICONS: Record<ConditionFlag, LucideIcon> = {
  plate_changed: RectangleHorizontal,
  damage_visible: TriangleAlert,
  being_stripped: Wrench,
  looks_intact: ShieldCheck,
};
export const DAMAGE_ICONS: Record<DamageKind, LucideIcon> = {
  smashed_window: SquareSlash,
  dents_scrapes: Hammer,
  broken_lights: LightbulbOff,
  // Dashed outline = missing.
  missing_wheels: CircleDashed,
  missing_parts: SquareDashed,
  fire_damage: Flame,
};
export const MISSING_PART_ICONS: Record<MissingPart, LucideIcon> = {
  bumpers: PanelBottom,
  bonnet: PanelTop,
  doors: DoorOpen,
  lights: Lightbulb,
  wing_mirrors: FlipHorizontal2,
  // The condition step's plate, so the flow draws a plate one way.
  number_plates: RectangleHorizontal,
};

/** The icon of the card this answer came from; none for a value this app
 *  doesn't know (the card is then drawn without one, never not at all). */
export function reviewCardIcon(card: ContextReviewCard): LucideIcon | undefined {
  const table: Record<string, LucideIcon> =
    card.question === 'state'
      ? STATE_ICONS
      : card.question === 'people'
        ? PEOPLE_ICONS
        : CONDITION_ICONS;
  return Object.hasOwn(table, card.value) ? table[card.value] : undefined;
}
