/**
 * WHAT:  The report's optional context, ONE QUESTION PER STEP, each answered
 *        on full-width cards (an icon, the answer, one short line):
 *          state      What was it doing?
 *          staying    Did it look like it was staying?   (only after Parked)
 *          direction  Which way was it heading?          (only after Moving)
 *          people     Anyone in or near it?
 *          condition  Its condition                      (any that apply)
 *          marks      Could you see any of these?        (only if the car has marks)
 *          note       A note for the owner
 *        Every single-answer question ends with an equal "Not sure" card.
 * WHY:   The owner asked (2026-10-20) for "Anything else that helps?" — one
 *        page of chips — to become separate steps "with more detail on each
 *        step", as cards "instead of just badges". The answers and what is
 *        sent are unchanged: the rules are lib/contextAnswers' (the golden
 *        payload test pins where they lead), the words lib/contextLabels'.
 *
 *        SPEED and SAFETY, because the spotter may be near the car:
 *        - A single pick moves on by itself after a beat (`advanceSoon`);
 *          tapping the chosen card again clears it and stays.
 *        - The people step moves on ONLY for "No one seen". People near it,
 *          someone in it, or "Not sure" keep the screen and bring up the fixed
 *          "Don't approach" line — announced as it appears — and cancel a
 *          beat already running (`cancelAdvanceSoon`), so a quick second tap
 *          can never carry the screen past it. "Being stripped" brings the
 *          same line up on the condition step (owner, 2026-10-20).
 *        - Nothing here asks the spotter to watch, follow or go closer: the
 *          heading is what they saw, and no card needs a close look.
 * LINKS: src/features/sightings/reportSightingFlow.tsx (the steps' config);
 *        src/features/sightings/lib/contextAnswers.ts (the rules);
 *        src/features/sightings/lib/contextLabels.ts (the words);
 *        src/shared/ui/CardSelect.tsx, CardSelectMulti.tsx; ./MarkTile.tsx;
 *        ./CompassPicker.tsx; docs/SECURITY_AND_TRUST.md §1;
 *        docs/DESIGN_SYSTEM.md (Optional question steps).
 */

import { Feather } from '@expo/vector-icons';
import {
  Car,
  CarFront,
  CircleParking,
  CircleQuestionMark,
  RectangleHorizontal,
  ShieldCheck,
  SquareParking,
  TriangleAlert,
  Truck,
  User,
  UserX,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LayoutAnimationConfig, ReduceMotion } from 'react-native-reanimated';

import {
  motion,
  sizes,
  spacing,
  typography,
  usePalette,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';
import {
  CardSelect,
  CardSelectMulti,
  SAFETY_PRESENCE_LINE,
  TextField,
  type CardSelectOption,
} from '@/shared/ui';
import type { WizardStepProps } from '@/shared/wizard';

import {
  UNSURE,
  changeConditions,
  conditionShowsSafetyLine,
  conditionsOf,
  isUnsure,
  peopleShowSafetyLine,
  selectDirection,
  selectPeople,
  selectState,
  selectStaying,
  setDirectionUnsure,
  shownAnswer,
  stateOf,
  toggleMark,
  type MaybeUnsure,
} from '../lib/contextAnswers';
import {
  CONDITION_OPTIONS,
  CONTEXT_OPTION_DESCRIPTIONS,
  CONTEXT_STEP_QUESTIONS,
  FLAG_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  PEOPLE_PRESENCE_LABELS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  directionLabel,
} from '../lib/contextLabels';
import {
  MAX_NOTE_LENGTH,
  type ConditionFlag,
  type ParkedLikelihood,
  type PeoplePresence,
  type ReportSightingAnswers,
  type VehicleStateFlag,
} from '../types';
import { CompassPicker } from './CompassPicker';
import { MarkTile } from './MarkTile';

type StepProps = WizardStepProps<ReportSightingAnswers>;

/** "Not sure": an equal answer, last in every single-answer list. Title only —
 *  it needs no explaining. */
const NOT_SURE: CardSelectOption<typeof UNSURE> = {
  value: UNSURE,
  label: 'Not sure',
  icon: CircleQuestionMark,
};

const STATE_ICONS: Record<VehicleStateFlag, LucideIcon> = {
  parked: SquareParking,
  driving: Car,
  being_loaded: Truck,
};
const STAYING_ICONS: Partial<Record<ParkedLikelihood, LucideIcon>> = {
  settled: CircleParking,
  moving: CarFront,
};
const PEOPLE_ICONS: Record<PeoplePresence, LucideIcon> = {
  nobody: UserX,
  nearby: Users,
  in_vehicle: User,
};
const CONDITION_ICONS: Record<ConditionFlag, LucideIcon> = {
  plate_changed: RectangleHorizontal,
  damage_visible: TriangleAlert,
  being_stripped: Wrench,
  looks_intact: ShieldCheck,
};

/** SAFETY: say "Don't approach" out loud as it appears. iOS has no live
 *  regions, and a live region that mounts with its text isn't reliably read
 *  on Android either, so announce on both. Queued (iOS), so VoiceOver saying
 *  the card's "selected" can't cut it off; Android ignores the option. */
function announceSafetyLine() {
  AccessibilityInfo.announceForAccessibilityWithOptions(SAFETY_PRESENCE_LINE, { queue: true });
}

/**
 * The fixed "Don't approach — your report is enough." under the cards that
 * call for it. SAFETY: imported copy, never a prop — the register reinforces
 * the safety gate's rule exactly where the temptation to linger lives. Firm
 * and unmissable: question weight, ink (never `danger`), SafetyNotice's rule
 * glyph. Fades in when it appears after the step has mounted.
 */
function SafetyPresenceLine() {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
      style={styles.safetyBlock}
    >
      <View style={styles.safetyRow} accessible accessibilityLabel={SAFETY_PRESENCE_LINE}>
        <Feather
          name="slash"
          size={sizes.iconSm}
          color={palette.textPrimary}
          style={styles.safetyGlyph}
        />
        <Text style={styles.safetyText}>{SAFETY_PRESENCE_LINE}</Text>
      </View>
    </Animated.View>
  );
}

/** What was it doing? — a pick moves on; a second tap clears and stays. */
export function StateStep({ answers, setAnswers, advanceSoon }: StepProps) {
  const shown = shownAnswer(answers, 'state', stateOf(answers));
  const options: CardSelectOption<MaybeUnsure<VehicleStateFlag>>[] = [
    ...STATE_OPTIONS.map((value) => ({
      value,
      label: FLAG_LABELS[value],
      description: CONTEXT_OPTION_DESCRIPTIONS.state[value],
      icon: STATE_ICONS[value],
    })),
    NOT_SURE,
  ];
  return (
    <CardSelect
      options={options}
      value={shown}
      onSelect={(picked) => {
        setAnswers(selectState(answers, picked));
        if (picked !== shown) advanceSoon?.();
      }}
      accessibilityLabel={CONTEXT_STEP_QUESTIONS.state}
      clearable
      testID="context-state"
    />
  );
}

/** Did it look like it was staying? — only after Parked. */
export function StayingStep({ answers, setAnswers, advanceSoon }: StepProps) {
  const shown = shownAnswer(answers, 'staying', answers.parkedLikelihood);
  const options: CardSelectOption<MaybeUnsure<ParkedLikelihood>>[] = [
    ...STAYING_OPTIONS.map((value) => ({
      value,
      label: PARKED_LIKELIHOOD_LABELS[value],
      description: CONTEXT_OPTION_DESCRIPTIONS.staying[value as 'settled' | 'moving'],
      icon: STAYING_ICONS[value],
    })),
    NOT_SURE,
  ];
  return (
    <CardSelect
      options={options}
      value={shown}
      onSelect={(picked) => {
        setAnswers(selectStaying(answers, picked));
        if (picked !== shown) advanceSoon?.();
      }}
      accessibilityLabel={CONTEXT_STEP_QUESTIONS.staying}
      clearable
      testID="context-staying"
    />
  );
}

/** Which way was it heading? — only after Moving. The compass is spatial, so
 *  it stays; "Not sure" is a card under it. Either moves on after a beat. */
export function DirectionStep({ answers, setAnswers, advanceSoon }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const unsure = isUnsure(answers, 'direction');
  return (
    <View style={styles.direction}>
      <CompassPicker
        value={answers.direction}
        onChange={(direction) => {
          setAnswers(selectDirection(answers, direction));
          if (direction) advanceSoon?.();
        }}
        accessibilityLabel={CONTEXT_STEP_QUESTIONS.direction}
      />
      {/* Always there (a space when empty), so the card below never jumps. */}
      <Text style={styles.heading}>
        {answers.direction ? directionLabel(answers.direction) : ' '}
      </Text>
      <View style={styles.fullWidth}>
        <CardSelectMulti
          // A checkbox, not a lone radio: it toggles on its own. Says what it's
          // unsure OF — "Not sure" under a compass is otherwise just that.
          options={[{ ...NOT_SURE, accessibilityLabel: 'Not sure which way it went' }]}
          value={unsure ? [UNSURE] : []}
          onChange={(next) => {
            const on = next.length > 0;
            setAnswers(setDirectionUnsure(answers, on));
            if (on) advanceSoon?.();
          }}
          testID="context-direction-unsure"
        />
      </View>
    </View>
  );
}

/** Anyone in or near it? — "No one seen" moves on; every other answer stays
 *  to show "Don't approach" (see the header). */
export function PeopleStep({ answers, setAnswers, advanceSoon, cancelAdvanceSoon }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const shown = shownAnswer(answers, 'people', answers.peoplePresence);
  const showing = peopleShowSafetyLine(answers);
  const options: CardSelectOption<MaybeUnsure<PeoplePresence>>[] = [
    ...PEOPLE_OPTIONS.map((value) => ({
      value,
      label: PEOPLE_PRESENCE_LABELS[value],
      description: CONTEXT_OPTION_DESCRIPTIONS.people[value],
      icon: PEOPLE_ICONS[value],
    })),
    NOT_SURE,
  ];
  return (
    // skipEntering: an answer already showing the line (coming Back to the
    // step) is simply there; only a line that appears AFTER mount fades in.
    <LayoutAnimationConfig skipEntering>
      <View style={styles.stack}>
        <CardSelect
          options={options}
          value={shown}
          onSelect={(picked) => {
            const patch = selectPeople(answers, picked);
            setAnswers(patch);
            // SAFETY: only a fresh "No one seen" moves on. Anything else —
            // including a change of mind inside the beat — keeps the screen.
            if (picked === 'nobody' && picked !== shown) advanceSoon?.();
            else cancelAdvanceSoon?.();
            if (!showing && peopleShowSafetyLine({ ...answers, ...patch })) announceSafetyLine();
          }}
          accessibilityLabel={CONTEXT_STEP_QUESTIONS.people}
          clearable
          testID="context-people"
        />
        {showing ? <SafetyPresenceLine /> : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** Its condition — any that apply ("Looks intact" stands alone). Never moves
 *  on by itself: a multi-choice is done when the spotter says so. */
export function ConditionStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const showing = conditionShowsSafetyLine(answers);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={styles.stack}>
        <CardSelectMulti
          options={CONDITION_OPTIONS.map((value) => ({
            value,
            label: FLAG_LABELS[value],
            description: CONTEXT_OPTION_DESCRIPTIONS.condition[value],
            icon: CONDITION_ICONS[value],
          }))}
          value={conditionsOf(answers)}
          onChange={(next) => {
            const patch = changeConditions(answers, next);
            setAnswers(patch);
            if (!showing && conditionShowsSafetyLine({ ...answers, ...patch })) {
              announceSafetyLine();
            }
          }}
          accessibilityLabel={CONTEXT_STEP_QUESTIONS.condition}
          testID="context-condition"
        />
        {showing ? <SafetyPresenceLine /> : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** Could you see any of these? — the owner's marks, as photo rows (the same
 *  rows the owner reads back). Only when the car has marks (the flow's `when`). */
export function MarksStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const confirmed = answers.confirmedFeatureIds ?? [];
  return (
    <View style={styles.markTiles}>
      {(answers.confirmableFeatures ?? []).map((mark) => (
        <MarkTile
          key={mark.id}
          description={mark.description}
          photoUrl={mark.photoUrl}
          selected={confirmed.includes(mark.id)}
          onPress={() => setAnswers(toggleMark(answers, mark.id))}
          testID={`confirm-mark-${mark.id}`}
        />
      ))}
    </View>
  );
}

/** A note for the owner — free text, up to the limit. */
export function NoteStep({ answers, setAnswers }: StepProps) {
  const noteLength = answers.note?.length ?? 0;
  return (
    <TextField
      label="Your note"
      variant="multiline"
      value={answers.note ?? ''}
      onChangeText={(note) => setAnswers({ note })}
      counter={`${noteLength}/${MAX_NOTE_LENGTH}`}
      // The counter is hidden from screen readers (TextField's contract);
      // the limit goes here instead, read once on focus.
      accessibilityHint={`Up to ${MAX_NOTE_LENGTH} characters`}
      maxLength={MAX_NOTE_LENGTH}
    />
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    stack: {
      gap: spacing.lg,
    },
    // The compass, the heading it names, and "Not sure": one control.
    direction: {
      alignItems: 'center',
      gap: spacing.md,
    },
    heading: {
      ...typography.label,
      color: c.textSecondary,
    },
    fullWidth: {
      alignSelf: 'stretch',
    },
    markTiles: {
      gap: spacing.sm,
    },
    safetyBlock: {
      marginTop: spacing.xs,
    },
    // Top-aligned, the glyph centred on the FIRST line: at large text the line
    // wraps, and a centred glyph would float mid-block (SafetyNotice's fix).
    safetyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    safetyGlyph: {
      marginTop: (typography.cardTitle.lineHeight - sizes.iconSm) / 2,
    },
    safetyText: {
      ...typography.cardTitle,
      color: c.textPrimary,
      flexShrink: 1,
    },
  });
