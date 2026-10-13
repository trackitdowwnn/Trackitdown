/**
 * WHAT:  Named Reanimated easing curves — the single sanctioned set, so the
 *        "ease-out" rule (docs/DESIGN_SYSTEM.md, Motion) stops being realised
 *        as a mix of quad / cubic / ease across components.
 * WHY:   Easing lives HERE, not in theme/motion.ts or the theme barrel,
 *        because it imports react-native-reanimated (a native module) and the
 *        barrel is pulled in by pure components + their jest tests. Consumers
 *        import it directly: `import { easeOut } from '@/shared/theme/motionEasing'`
 *        — the same "not in the barrel" pattern as AppMap. The RN-core
 *        `Animated` holdouts keep their own Easing; new/migrated animation is
 *        Reanimated and uses these.
 * LINKS: src/shared/theme/motion.ts (durations + springs);
 *        docs/DESIGN_SYSTEM.md (Motion).
 */

import { Easing } from 'react-native-reanimated';

/** Deceleration — the default curve for the app's timed motion (things
 *  arriving and settling). Reach for anything else deliberately.
 *
 *  Add `easeInOut` (reversible moves) HERE the moment a consumer genuinely
 *  needs it — don't pre-export unused curves (each forces every partial
 *  Reanimated test mock to stub it for no benefit). */
export const easeOut = Easing.out(Easing.cubic);

/** Acceleration — for a pronounced EXIT: it starts gently and gathers speed
 *  as it leaves, so a full-screen surface glides away rather than being
 *  yanked (an easeOut exit is fastest on its first frame). A QUAD, not a
 *  cubic: a cubic barely moves for its first ~100ms, which after a tap reads
 *  as lag (motion review). First consumer: SelectScreen's close (2026-10-12,
 *  owner report: "very snappy"). */
export const easeIn = Easing.in(Easing.quad);

/** Constant speed — for a LOOPING ambient pass that has no beginning and no
 *  end to decelerate into. The only consumer is BrandLoader's shimmer: an
 *  eased sweep would accelerate away from one edge and brake into the other,
 *  which on a repeat reads as a stutter twice per cycle. Do not reach for this
 *  for anything that arrives or settles — that is `easeOut`'s job. */
export const linear = Easing.linear;
