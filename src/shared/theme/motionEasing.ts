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
 *  Only `easeOut` is exported today: it covers every current site (a couple of
 *  brief exits also use it — the difference is imperceptible on a sub-250ms
 *  slide). Add `easeIn` (`Easing.in(Easing.cubic)`, for pronounced exits) or
 *  `easeInOut` (reversible moves) HERE the moment a consumer genuinely needs
 *  one — don't pre-export unused curves (each would force every partial
 *  Reanimated test mock to stub `Easing.in`/`.inOut` for no benefit). */
export const easeOut = Easing.out(Easing.cubic);
