/**
 * WHAT:  OnboardingPlate — the onboarding hero: a single UK registration
 *        plate, drawn in code, sitting ABOVE the pager rather than inside it.
 *        It does not page. What changes as you swipe is the status stamped
 *        beneath it — Reported → Broadcast → Sighted → Recovered — and, on the
 *        last slide, the bounty that was paid.
 * WHY:   The plate is the one object this entire product turns on: every post
 *        is a registration mark, every sighting is a match against one. The
 *        old intro put a placeholder emoji in a grey circle on each slide,
 *        which read as unfinished and told four unrelated stories. Keeping ONE
 *        plate fixed while its status moves says the true thing instead —
 *        this is a single car being tracked through a single loop — and it
 *        needs no illustration assets to do it.
 *
 *        Monochrome by decision (2026-08-06): a real plate is yellow, but the
 *        app's palette is near-white and near-black, and the plate is the
 *        thing people will remember from this screen, so it earns precision
 *        rather than novelty. The one detail kept from the real object is the
 *        left-hand identifier band, which is what makes a white rectangle
 *        legible as a numberplate at a glance.
 *
 *        DECORATIVE to assistive tech, deliberately. Every slide already
 *        announces its own full copy, and the status here restates what that
 *        copy says; spelling out a registration mark character by character
 *        would be noise between a user and the actual message.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (owner, supplies
 *        scrollX); src/features/auth/lib/onboardingSlides.ts (the stamps);
 *        docs/DESIGN_SYSTEM.md (Colour, Typography, Motion).
 */

import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { colors, radii, spacing, typography } from '@/shared/theme';

import { ONBOARDING_BOUNTY, ONBOARDING_PLATE, ONBOARDING_SLIDES } from '../lib/onboardingSlides';

export interface OnboardingPlateProps {
  /** Horizontal scroll offset of the pager, in px. */
  scrollX: SharedValue<number>;
  pageWidth: number;
  reduceMotion: boolean;
}

/** The plate's own type size. Deliberately NOT typography.plate (14pt): that
 *  token is the compact chip that sits beside card titles, and this is the
 *  hero. Same face (Satoshi-Black), same uppercase, tracked out — a plate's
 *  characters are legally spaced apart, and that spacing is most of why the
 *  shape reads as a plate rather than as a heading in a box. */
const PLATE_FONT_SIZE = 34;

/** How far the plate drifts against the scroll. Small: it is the fixed point
 *  of the screen, so it should feel anchored, not carried along. */
const PLATE_DRIFT = spacing.sm;

export function OnboardingPlate({ scrollX, pageWidth, reduceMotion }: OnboardingPlateProps) {
  'use no memo';

  const driftStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { transform: [{ translateX: 0 }] };
    const lastPage = ONBOARDING_SLIDES.length - 1;
    return {
      transform: [
        {
          // One continuous drift across the WHOLE pager rather than a
          // per-slide bounce: the plate slides a few points left over four
          // slides, so it reads as one object being carried through a story.
          translateX: interpolate(
            scrollX.value,
            [0, lastPage * pageWidth],
            [PLATE_DRIFT, -PLATE_DRIFT],
            'clamp',
          ),
        },
      ],
    };
  });

  return (
    <View
      style={styles.root}
      // Decorative: the slides carry the message; see the header note.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="onboarding-plate"
    >
      <Animated.View style={[styles.plate, driftStyle]}>
        {/* The identifier band — a real plate's blue GB strip, rendered in the
            palette's near-black. This is the single detail that makes the
            rectangle unmistakable. */}
        <View style={styles.band}>
          <Text style={styles.bandText} maxFontSizeMultiplier={1}>
            UK
          </Text>
        </View>
        <Text style={styles.registration} maxFontSizeMultiplier={1.2}>
          {ONBOARDING_PLATE}
        </Text>
      </Animated.View>

      {/* The status line. Each stamp is absolutely positioned in a fixed slot
          so they cross-fade in place — stacking them in flow would shunt the
          plate up and down as the words changed length. */}
      <View style={styles.stampSlot}>
        {ONBOARDING_SLIDES.map((slide, index) => (
          <PlateStamp
            key={slide.key}
            label={slide.stamp}
            bounty={slide.key === 'recovered' ? ONBOARDING_BOUNTY : undefined}
            index={index}
            scrollX={scrollX}
            pageWidth={pageWidth}
          />
        ))}
      </View>
    </View>
  );
}

/** One status, visible only while its slide is the centred one. */
function PlateStamp({
  label,
  bounty,
  index,
  scrollX,
  pageWidth,
}: {
  label: string;
  bounty?: string;
  index: number;
  scrollX: SharedValue<number>;
  pageWidth: number;
}) {
  'use no memo';

  const style = useAnimatedStyle(() => {
    // Fully out by the halfway point in both directions, so exactly one stamp
    // is legible at rest and the swap happens mid-drag rather than at the
    // snap — the status changing IS the animation of this screen.
    const opacity = interpolate(
      scrollX.value,
      [(index - 0.5) * pageWidth, index * pageWidth, (index + 0.5) * pageWidth],
      [0, 1, 0],
      'clamp',
    );
    return { opacity };
  });

  return (
    <Animated.View style={[styles.stamp, style]}>
      <View style={styles.stampRule} />
      <Text style={styles.stampText} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
      {bounty ? <Text style={styles.stampBounty}>{bounty} paid</Text> : null}
      <View style={styles.stampRule} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  plate: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    // The plate hugs its characters rather than filling the width: a
    // percentage width would stretch to a different proportion on every
    // handset, and the proportion is the recognition.
    overflow: 'hidden',
  },
  band: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bandText: {
    ...typography.caption,
    fontFamily: typography.plate.fontFamily,
    color: colors.textOnPrimary,
  },
  registration: {
    fontSize: PLATE_FONT_SIZE,
    lineHeight: PLATE_FONT_SIZE * 1.2,
    fontFamily: typography.plate.fontFamily,
    color: colors.primary,
    letterSpacing: 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  stampSlot: {
    // Room for the tallest stamp (the recovered one carries a second line),
    // so the plate above it never moves as the status changes.
    height: typography.caption.lineHeight * 2 + spacing.md,
    alignSelf: 'stretch',
  },
  stamp: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stampRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  stampText: {
    ...typography.caption,
    fontFamily: typography.label.fontFamily,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  stampBounty: {
    ...typography.caption,
    fontFamily: typography.plate.fontFamily,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
});
