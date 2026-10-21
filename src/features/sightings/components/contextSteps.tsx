/**
 * WHAT:  The report's optional context, ONE QUESTION PER STEP, each answered
 *        on full-width cards (an icon, the answer, one short line):
 *          state      What was it doing?
 *          staying    Did it look like it was staying?   (only after Parked)
 *          direction  Which way was it heading?          (only after Moving)
 *          people     Anyone in or near it?
 *          condition  Its condition                      (any that apply)
 *          damage     What damage can you see?           (only after Damage visible)
 *          marks      Could you see any of these?        (only if the car has marks)
 *          note       A note for the owner
 *        Every single-answer question ends with an equal "Not sure" card.
 *        The multi-choice cards (condition, damage) are title-only.
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
 *          can never carry the screen past it.
 *        - A crime in progress — "Being loaded or towed", "Being stripped" —
 *          brings the same line up with the app's 999 line under it, and
 *          never moves on by itself (owner, 2026-10-20), so "your report is
 *          enough" can never read as "no need to call the police".
 *        - "Fire damage" brings the line up with a 999 line of its own —
 *          "If the car is currently on fire" — because the damage may be
 *          old (owner, 2026-10-21). The damage step never moves on by itself.
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
  CircleDashed,
  CircleParking,
  CircleQuestionMark,
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
  SAFETY_999_LINE,
  SAFETY_FIRE_999_LINE,
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
  damageShowsSafetyLine,
  isUnsure,
  peopleShowSafetyLine,
  selectDirection,
  selectPeople,
  selectState,
  selectStaying,
  setDirectionUnsure,
  stateShowsSafetyLine,
  shownAnswer,
  stateOf,
  toggleDamageKind,
  toggleMark,
  toggleMissingPart,
  type MaybeUnsure,
} from '../lib/contextAnswers';
import {
  CONDITION_OPTIONS,
  CONTEXT_OPTION_DESCRIPTIONS,
  CONTEXT_STEP_QUESTIONS,
  DAMAGE_KIND_LABELS,
  FLAG_LABELS,
  MISSING_PART_LABELS,
  PARKED_LIKELIHOOD_LABELS,
  PEOPLE_OPTIONS,
  PEOPLE_PRESENCE_LABELS,
  STATE_OPTIONS,
  STAYING_OPTIONS,
  directionLabel,
} from '../lib/contextLabels';
import { stripHiddenCharacters } from '../lib/withdrawReasons';
import {
  DAMAGE_KINDS,
  MAX_DAMAGE_NOTE_LENGTH,
  MAX_MISSING_PARTS_NOTE_LENGTH,
  MAX_NOTE_LENGTH,
  MISSING_PARTS,
  type ConditionFlag,
  type DamageKind,
  type MissingPart,
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
const DAMAGE_ICONS: Record<DamageKind, LucideIcon> = {
  smashed_window: SquareSlash,
  dents_scrapes: Hammer,
  broken_lights: LightbulbOff,
  // Dashed outline = missing.
  missing_wheels: CircleDashed,
  missing_parts: SquareDashed,
  fire_damage: Flame,
};
const MISSING_PART_ICONS: Record<MissingPart, LucideIcon> = {
  bumpers: PanelBottom,
  bonnet: PanelTop,
  doors: DoorOpen,
  lights: Lightbulb,
  wing_mirrors: FlipHorizontal2,
  // The condition step's plate, so the flow draws a plate one way.
  number_plates: RectangleHorizontal,
};

/** SAFETY: say "Don't approach" out loud as it appears. iOS has no live
 *  regions, and a live region that mounts with its text isn't reliably read
 *  on Android either, so announce on both. Queued (iOS), so VoiceOver saying
 *  the card's "selected" can't cut it off; Android ignores the option. */
function announceSafetyLine(call999?: Call999Line) {
  AccessibilityInfo.announceForAccessibilityWithOptions(safetyWords(call999), {
    queue: true,
  });
}

/** The 999 lines a step may put under "Don't approach" — imported SAFETY
 *  copy only: the crime-in-progress line (loaded, towed, stripped) or the
 *  fire line (owner, 2026-10-21: "it should say if the car is currently on
 *  fire"). */
type Call999Line = typeof SAFETY_999_LINE | typeof SAFETY_FIRE_999_LINE;

/** What the line says: "Don't approach" — and, where what was seen may be an
 *  emergency happening now, a 999 line under it, so "your report is enough"
 *  can never read as "no need to call 999" (owner, 2026-10-20). */
const safetyWords = (call999?: Call999Line) =>
  call999 ? `${SAFETY_PRESENCE_LINE} ${call999}` : SAFETY_PRESENCE_LINE;

/**
 * The fixed "Don't approach — your report is enough." under the cards that
 * call for it, with "If a crime is in progress, call 999." under that for a
 * car being loaded, towed or stripped. SAFETY: imported copy, never a prop —
 * the register reinforces the safety gate's rule exactly where the temptation
 * to linger lives. Firm and unmissable: question weight, ink (never
 * `danger`), SafetyNotice's rule glyph. Fades in when it appears after the
 * step has mounted.
 */
function SafetyPresenceLine({ call999 }: { call999?: Call999Line }) {
  const styles = useThemedStyles(makeStyles);
  const palette = usePalette();
  return (
    <Animated.View
      entering={FadeIn.duration(motion.fast).reduceMotion(ReduceMotion.System)}
      style={styles.safetyBlock}
    >
      <View style={styles.safetyRow} accessible accessibilityLabel={safetyWords(call999)}>
        <Feather
          name="slash"
          size={sizes.iconSm}
          color={palette.textPrimary}
          style={styles.safetyGlyph}
        />
        <View style={styles.safetyLines}>
          <Text style={styles.safetyText}>{SAFETY_PRESENCE_LINE}</Text>
          {call999 ? <Text style={styles.safetyText}>{call999}</Text> : null}
        </View>
      </View>
    </Animated.View>
  );
}

/** What was it doing? — a pick moves on; a second tap clears and stays.
 *  "Being loaded or towed" is a crime in progress: it shows the safety line
 *  with 999 and stays (owner, 2026-10-20). */
export function StateStep({ answers, setAnswers, advanceSoon, cancelAdvanceSoon }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const shown = shownAnswer(answers, 'state', stateOf(answers));
  const showing = stateShowsSafetyLine(answers);
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
    <LayoutAnimationConfig skipEntering>
      <View style={styles.stack}>
        <CardSelect
          options={options}
          value={shown}
          onSelect={(picked) => {
            const patch = selectState(answers, picked);
            setAnswers(patch);
            const lineNow = stateShowsSafetyLine({ ...answers, ...patch });
            // A pick moves on; clearing it — even inside the beat — stays put,
            // and so does an answer that brings up the safety line (SAFETY).
            if (picked !== shown && !lineNow) advanceSoon?.();
            else cancelAdvanceSoon?.();
            if (!showing && lineNow) announceSafetyLine(SAFETY_999_LINE);
          }}
          accessibilityLabel={CONTEXT_STEP_QUESTIONS.state}
          clearable
          testID="context-state"
        />
        {showing ? <SafetyPresenceLine call999={SAFETY_999_LINE} /> : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** Did it look like it was staying? — only after Parked. */
export function StayingStep({ answers, setAnswers, advanceSoon, cancelAdvanceSoon }: StepProps) {
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
        else cancelAdvanceSoon?.();
      }}
      accessibilityLabel={CONTEXT_STEP_QUESTIONS.staying}
      clearable
      testID="context-staying"
    />
  );
}

/** Which way was it heading? — only after Moving. The compass is spatial, so
 *  it stays; "Not sure" is a card under it. Either moves on after a beat. */
export function DirectionStep({ answers, setAnswers, advanceSoon, cancelAdvanceSoon }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const unsure = isUnsure(answers, 'direction');
  return (
    <View style={styles.direction}>
      <CompassPicker
        value={answers.direction}
        onChange={(direction) => {
          setAnswers(selectDirection(answers, direction));
          if (direction) advanceSoon?.();
          else cancelAdvanceSoon?.();
        }}
        accessibilityLabel={CONTEXT_STEP_QUESTIONS.direction}
      />
      {/* Always there (a space when empty), so the card below never jumps. */}
      <Text
        style={styles.heading}
        // Empty, it only holds the space: no stop for a screen reader.
        importantForAccessibility={answers.direction ? 'auto' : 'no'}
        accessibilityElementsHidden={!answers.direction}
      >
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
            else cancelAdvanceSoon?.();
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
            icon: CONDITION_ICONS[value],
          }))}
          value={conditionsOf(answers)}
          onChange={(next) => {
            const patch = changeConditions(answers, next);
            setAnswers(patch);
            if (!showing && conditionShowsSafetyLine({ ...answers, ...patch })) {
              announceSafetyLine(SAFETY_999_LINE);
            }
          }}
          accessibilityLabel={CONTEXT_STEP_QUESTIONS.condition}
          testID="context-condition"
        />
        {/* Being stripped is a crime in progress: 999 under the line. */}
        {showing ? <SafetyPresenceLine call999={SAFETY_999_LINE} /> : null}
      </View>
    </LayoutAnimationConfig>
  );
}

/** What damage can you see? — only after "Damage visible" (owner, 2026-10-21).
 *  Any that apply, then "Anything else?" in their own words. Never moves on by
 *  itself: a multi-choice is done when the spotter says so, and the box may
 *  still be wanted. Hidden characters are stripped as typed — the server
 *  refuses them, and a spotter can't fix what they can't see. */
export function DamageStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const note = answers.damageNote ?? '';
  // SAFETY: "Fire damage" brings up "Don't approach" with the fire 999 line —
  // the damage may be old, so it asks whether the car is burning now (owner,
  // 2026-10-21).
  const showing = damageShowsSafetyLine(answers);
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={styles.stack}>
        <CardSelectMulti
          options={DAMAGE_KINDS.map((value) => ({
            value,
            label: DAMAGE_KIND_LABELS[value],
            icon: DAMAGE_ICONS[value],
          }))}
          value={answers.damageKinds ?? []}
          onChange={(next) => {
            // One card changes per tap: whichever is in one list but not the other.
            const current = answers.damageKinds ?? [];
            const changed =
              next.find((kind) => !current.includes(kind)) ??
              current.find((kind) => !next.includes(kind));
            if (!changed) return;
            const patch = toggleDamageKind(answers, changed);
            setAnswers(patch);
            if (!showing && damageShowsSafetyLine({ ...answers, ...patch })) {
              announceSafetyLine(SAFETY_FIRE_999_LINE);
            }
          }}
          accessibilityLabel={CONTEXT_STEP_QUESTIONS.damage}
          testID="context-damage"
        />
        {showing ? <SafetyPresenceLine call999={SAFETY_FIRE_999_LINE} /> : null}
        <TextField
          label="Anything else?"
          variant="multiline"
          value={note}
          onChangeText={(text) => setAnswers({ damageNote: stripHiddenCharacters(text) })}
          // UTF-16 units, as maxLength counts them (like the note step).
          counter={`${note.length}/${MAX_DAMAGE_NOTE_LENGTH}`}
          // The counter is hidden from screen readers (TextField's contract);
          // the limit goes here instead, read once on focus.
          accessibilityHint={`Up to ${MAX_DAMAGE_NOTE_LENGTH} characters`}
          maxLength={MAX_DAMAGE_NOTE_LENGTH}
          testID="context-damage-note"
        />
      </View>
    </LayoutAnimationConfig>
  );
}

/** What's missing? — only after "Missing panels or parts" (owner,
 *  2026-10-21). The damage step's shape exactly: any that apply, then
 *  "Anything else?" in their own words; never moves on by itself; hidden
 *  characters stripped as typed. Only parts seen from where they stand
 *  (SECURITY_AND_TRUST §1) — nothing under the car or inside it. */
export function PartsStep({ answers, setAnswers }: StepProps) {
  const styles = useThemedStyles(makeStyles);
  const note = answers.missingPartsNote ?? '';
  return (
    <View style={styles.stack}>
      <CardSelectMulti
        options={MISSING_PARTS.map((value) => ({
          value,
          label: MISSING_PART_LABELS[value],
          icon: MISSING_PART_ICONS[value],
        }))}
        value={answers.missingParts ?? []}
        onChange={(next) => {
          // One card changes per tap: whichever is in one list but not the other.
          const current = answers.missingParts ?? [];
          const changed =
            next.find((part) => !current.includes(part)) ??
            current.find((part) => !next.includes(part));
          if (changed) setAnswers(toggleMissingPart(answers, changed));
        }}
        accessibilityLabel={CONTEXT_STEP_QUESTIONS.parts}
        testID="context-parts"
      />
      <TextField
        label="Anything else?"
        variant="multiline"
        value={note}
        onChangeText={(text) => setAnswers({ missingPartsNote: stripHiddenCharacters(text) })}
        // UTF-16 units, as maxLength counts them (like the damage step).
        counter={`${note.length}/${MAX_MISSING_PARTS_NOTE_LENGTH}`}
        // The counter is hidden from screen readers (TextField's contract);
        // the limit goes here instead, read once on focus.
        accessibilityHint={`Up to ${MAX_MISSING_PARTS_NOTE_LENGTH} characters`}
        maxLength={MAX_MISSING_PARTS_NOTE_LENGTH}
        testID="context-parts-note"
      />
    </View>
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
    safetyLines: {
      flexShrink: 1,
      gap: spacing.xs,
    },
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
      // As SafetyNotice: Satoshi's font padding would throw the glyph's
      // first-line centring off on Android.
      includeFontPadding: false,
    },
  });
