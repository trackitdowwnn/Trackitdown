/**
 * WHAT:  The distinguishing-features taxonomy the post-a-car wizard offers as
 *        multi-select chips — the client mirror of the seeded vehicle_feature
 *        table (key, label, Feather icon), ordered as seeded.
 * WHY:   The picker needs the full taxonomy at design time; fetching it mid-
 *        wizard would add a network dependency to a step that must stay
 *        instant. This is stable, seeded reference data (like an enum's
 *        options), so it lives as a constant. create_post validates the chosen
 *        keys against the DB (FK to vehicle_feature), so a drift here can only
 *        under-offer, never post an invalid key. KEEP IN SYNC with the seed.
 * LINKS: supabase/migrations/20260713180000_post_detail_structured_data.sql
 *          (the vehicle_feature seed — source of truth);
 *        src/features/vehicles/components/FeaturesGrid.tsx (renders the icons);
 *        src/shared/ui/ChoiceChipsMulti.tsx (the picker).
 */

import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type FeatherName = ComponentProps<typeof Feather>['name'];

export interface VehicleFeatureOption {
  key: string;
  label: string;
  icon: FeatherName;
}

/** The 21 seeded features, in seed (sort_order) order. */
export const VEHICLE_FEATURES: VehicleFeatureOption[] = [
  // Bodywork
  { key: 'dent', label: 'Dents', icon: 'alert-circle' },
  { key: 'deep_scratch', label: 'Deep scratches', icon: 'slash' },
  { key: 'rust', label: 'Rust', icon: 'droplet' },
  { key: 'mismatched_panel', label: 'Mismatched panel', icon: 'grid' },
  { key: 'cracked_windscreen', label: 'Cracked windscreen', icon: 'alert-octagon' },
  // Add-ons
  { key: 'roof_rack', label: 'Roof rack', icon: 'layers' },
  { key: 'roof_box', label: 'Roof box', icon: 'package' },
  { key: 'tow_bar', label: 'Tow bar', icon: 'link' },
  { key: 'bike_rack', label: 'Bike rack', icon: 'anchor' },
  // Glass & wheels
  { key: 'tinted_windows', label: 'Tinted windows', icon: 'eye-off' },
  { key: 'aftermarket_alloys', label: 'Aftermarket alloys', icon: 'disc' },
  // Identity
  { key: 'private_plate', label: 'Private plate', icon: 'hash' },
  { key: 'plate_surround', label: 'Plate surround', icon: 'square' },
  { key: 'window_stickers', label: 'Window stickers', icon: 'tag' },
  { key: 'debadged', label: 'Debadged', icon: 'minus' },
  // Interior
  { key: 'dashcam', label: 'Dashcam', icon: 'camera' },
  { key: 'child_seat', label: 'Child seat', icon: 'shield' },
  // Mods
  { key: 'modified_exhaust', label: 'Modified exhaust', icon: 'wind' },
  { key: 'lowered_lifted', label: 'Lowered / lifted', icon: 'sliders' },
  { key: 'body_kit', label: 'Body kit', icon: 'tool' },
  { key: 'spotlights', label: 'Spotlights', icon: 'sun' },
];

/** Human label for a feature key (for the review screen). */
export function featureLabel(key: string): string {
  return VEHICLE_FEATURES.find((feature) => feature.key === key)?.label ?? key;
}
