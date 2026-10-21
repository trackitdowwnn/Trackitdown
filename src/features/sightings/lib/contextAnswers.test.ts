/**
 * WHAT:  Tests for the report's context rules — each pick's patch, the
 *        cross-question clearing (the damage details with "Damage visible"),
 *        "Looks intact"'s exclusivity, "Not sure", and the safety-line checks.
 * WHY:   Once the questions sit on separate steps (owner, 2026-10-20) these
 *        rules are the only thing holding them together; no screen sees them
 *        all. sightingApi.test's golden payload pins where they lead.
 * LINKS: ./contextAnswers.ts; ../api/sightingApi.test.ts (GOLDEN).
 */

import type { ReportSightingAnswers } from '../types';
import {
  CONTEXT_STEP_IDS,
  UNSURE,
  changeConditions,
  conditionShowsSafetyLine,
  conditionsOf,
  hasMarks,
  isMoving,
  isParked,
  peopleShowSafetyLine,
  selectDirection,
  selectPeople,
  selectState,
  selectStaying,
  setDirectionUnsure,
  shownAnswer,
  stateOf,
  stateShowsSafetyLine,
  stepAnswered,
  stepApplies,
  stepTouched,
  toggleDamageKind,
  toggleMark,
} from './contextAnswers';

type Answers = Partial<ReportSightingAnswers>;
const apply = (answers: Answers, patch: Answers): Answers => ({ ...answers, ...patch });

describe('reading the answers', () => {
  it('finds the state and the conditions inside contextFlags', () => {
    const a: Answers = { contextFlags: ['damage_visible', 'driving', 'plate_changed'] };
    expect(stateOf(a)).toBe('driving');
    expect(conditionsOf(a)).toEqual(['damage_visible', 'plate_changed']);
    expect(isMoving(a)).toBe(true);
    expect(isParked(a)).toBe(false);
  });

  it('has marks only when the post offered some', () => {
    expect(hasMarks({})).toBe(false);
    expect(hasMarks({ confirmableFeatures: [] })).toBe(false);
    expect(hasMarks({ confirmableFeatures: [{ id: 'm1', description: 'Dent' }] })).toBe(true);
  });

  it('shows "Not sure" as chosen only when nothing is stored', () => {
    expect(shownAnswer({ contextUnsure: ['people'] }, 'people', undefined)).toBe(UNSURE);
    expect(shownAnswer({ contextUnsure: [] }, 'people', 'nearby')).toBe('nearby');
    expect(shownAnswer({}, 'people', undefined)).toBeNull();
  });
});

describe('what it was doing', () => {
  it('picks a state, keeping the conditions', () => {
    const patch = selectState({ contextFlags: ['damage_visible'] }, 'parked');
    expect(patch.contextFlags).toEqual(['parked', 'damage_visible']);
  });

  it('⚠️ a new state clears the OLD state\'s follow-up and its "Not sure"', () => {
    let a: Answers = {};
    a = apply(a, selectState(a, 'parked'));
    a = apply(a, selectStaying(a, UNSURE));
    a = apply(a, selectStaying(a, 'settled'));
    a = apply(a, selectState(a, 'driving'));
    expect(a.parkedLikelihood).toBeUndefined();
    expect(a.contextUnsure).not.toContain('staying');

    a = apply(a, setDirectionUnsure(a, true));
    a = apply(a, selectState(a, 'being_loaded'));
    expect(a.direction).toBeUndefined();
    expect(a.contextUnsure).not.toContain('direction');
  });

  it('a real pick after "Not sure" replaces it', () => {
    let a: Answers = {};
    a = apply(a, selectState(a, UNSURE));
    a = apply(a, selectState(a, 'parked'));
    expect(a.contextFlags).toEqual(['parked']);
    expect(a.contextUnsure).not.toContain('state');
  });

  it('picking the chosen state again clears it', () => {
    const a = apply({}, selectState({}, 'parked'));
    expect(selectState(a, 'parked').contextFlags).toEqual([]);
  });

  it('"Not sure" stores no state, only remembers the pick — and a second tap clears it', () => {
    const start: Answers = { contextFlags: ['parked'] };
    const a = apply(start, selectState(start, UNSURE));
    expect(a.contextFlags).toEqual([]);
    expect(a.contextUnsure).toContain('state');
    expect(selectState(a, UNSURE).contextUnsure).not.toContain('state');
  });
});

describe('the follow-ups', () => {
  it('staying: pick, "Not sure", tap again to clear', () => {
    expect(selectStaying({}, 'moving').parkedLikelihood).toBe('moving');
    const unsure = apply({}, selectStaying({}, UNSURE));
    expect(unsure.parkedLikelihood).toBeUndefined();
    expect(unsure.contextUnsure).toEqual(['staying']);
    expect(
      selectStaying({ parkedLikelihood: 'moving' }, 'moving').parkedLikelihood,
    ).toBeUndefined();
  });

  it('direction: a heading and "Not sure which way" replace each other', () => {
    let a: Answers = { direction: 'N' };
    a = apply(a, setDirectionUnsure(a, true));
    expect(a.direction).toBeUndefined();
    expect(a.contextUnsure).toEqual(['direction']);
    a = apply(a, selectDirection(a, 'SW'));
    expect(a.direction).toBe('SW');
    expect(a.contextUnsure).toEqual([]);
  });
});

describe('anyone in or near it', () => {
  it('picks, clears on a second tap, and remembers "Not sure"', () => {
    expect(selectPeople({}, 'nobody').peoplePresence).toBe('nobody');
    expect(selectPeople({ peoplePresence: 'nobody' }, 'nobody').peoplePresence).toBeUndefined();
    expect(selectPeople({}, UNSURE).contextUnsure).toEqual(['people']);
  });

  it('⚠️ SAFETY: the line shows for people near it, someone in it, and "Not sure"', () => {
    expect(peopleShowSafetyLine({ peoplePresence: 'nearby' })).toBe(true);
    expect(peopleShowSafetyLine({ peoplePresence: 'in_vehicle' })).toBe(true);
    expect(peopleShowSafetyLine({ contextUnsure: ['people'] })).toBe(true);
    expect(peopleShowSafetyLine({ peoplePresence: 'nobody' })).toBe(false);
    expect(peopleShowSafetyLine({})).toBe(false);
  });
});

describe('its condition', () => {
  it('keeps the state in front and the conditions in the order ticked', () => {
    const patch = changeConditions({ contextFlags: ['parked'] }, [
      'plate_changed',
      'damage_visible',
    ]);
    expect(patch.contextFlags).toEqual(['parked', 'plate_changed', 'damage_visible']);
  });

  it('"Looks intact" clears the rest, and anything else clears it', () => {
    const damaged: Answers = { contextFlags: ['damage_visible', 'plate_changed'] };
    expect(
      changeConditions(damaged, ['damage_visible', 'plate_changed', 'looks_intact']).contextFlags,
    ).toEqual(['looks_intact']);

    const intact: Answers = { contextFlags: ['looks_intact'] };
    expect(changeConditions(intact, ['looks_intact', 'being_stripped']).contextFlags).toEqual([
      'being_stripped',
    ]);
  });

  it('⚠️ losing "Damage visible" clears what damage — unticked, or by "Looks intact"', () => {
    let a: Answers = {};
    a = apply(a, changeConditions(a, ['damage_visible']));
    a = apply(a, toggleDamageKind(a, 'fire_damage'));
    a = apply(a, { damageNote: 'Scorched bonnet' });

    // Another condition beside it keeps them.
    const kept = apply(a, changeConditions(a, ['damage_visible', 'plate_changed']));
    expect(kept.damageKinds).toEqual(['fire_damage']);
    expect(kept.damageNote).toBe('Scorched bonnet');

    const unticked = apply(a, changeConditions(a, []));
    expect(unticked.damageKinds).toBeUndefined();
    expect(unticked.damageNote).toBeUndefined();

    const intact = apply(a, changeConditions(a, ['damage_visible', 'looks_intact']));
    expect(intact.contextFlags).toEqual(['looks_intact']);
    expect(intact.damageKinds).toBeUndefined();
    expect(intact.damageNote).toBeUndefined();
  });

  it('⚠️ SAFETY: "Being loaded or towed" brings up the line — a crime in progress', () => {
    expect(stateShowsSafetyLine({ contextFlags: ['being_loaded'] })).toBe(true);
    expect(stateShowsSafetyLine({ contextFlags: ['parked'] })).toBe(false);
    expect(stateShowsSafetyLine({})).toBe(false);
  });

  it('⚠️ SAFETY: "Being stripped" brings up the line — people are working on the car', () => {
    expect(conditionShowsSafetyLine({ contextFlags: ['being_stripped'] })).toBe(true);
    expect(conditionShowsSafetyLine({ contextFlags: ['damage_visible'] })).toBe(false);
  });
});

describe('what damage', () => {
  it('toggles a kind in and out, in the order tapped', () => {
    let a: Answers = {};
    a = apply(a, toggleDamageKind(a, 'fire_damage'));
    a = apply(a, toggleDamageKind(a, 'smashed_window'));
    expect(a.damageKinds).toEqual(['fire_damage', 'smashed_window']);
    expect(toggleDamageKind(a, 'fire_damage').damageKinds).toEqual(['smashed_window']);
  });

  it('a state picked afterwards keeps "Damage visible" and its details', () => {
    let a: Answers = {};
    a = apply(a, changeConditions(a, ['damage_visible']));
    a = apply(a, toggleDamageKind(a, 'dents_scrapes'));
    a = apply(a, selectState(a, 'parked'));
    expect(a.contextFlags).toEqual(['parked', 'damage_visible']);
    expect(a.damageKinds).toEqual(['dents_scrapes']);
  });
});

describe("the owner's marks", () => {
  it('toggles a mark in and out', () => {
    const a = apply({}, toggleMark({}, 'm1'));
    expect(a.confirmedFeatureIds).toEqual(['m1']);
    expect(toggleMark(a, 'm1').confirmedFeatureIds).toEqual([]);
  });
});

describe('the steps', () => {
  it('counts a step answered once it has an answer — "Not sure" included', () => {
    expect(stepTouched({}, 'state')).toBe(false);
    expect(stepTouched({ contextUnsure: ['state'] }, 'state')).toBe(true);
    expect(stepTouched({ contextFlags: ['parked'] }, 'state')).toBe(true);
    // A state is not a condition, nor a condition a state.
    expect(stepTouched({ contextFlags: ['parked'] }, 'condition')).toBe(false);
    expect(stepTouched({ contextFlags: ['damage_visible'] }, 'state')).toBe(false);
    expect(stepTouched({ direction: 'N' }, 'direction')).toBe(true);
    expect(stepTouched({ note: '   ' }, 'note')).toBe(false);
    expect(stepTouched({ confirmedFeatureIds: ['m1'] }, 'marks')).toBe(true);
    // What damage: a kind, or words — a blank box is neither.
    expect(stepTouched({}, 'damage')).toBe(false);
    expect(stepTouched({ damageKinds: [], damageNote: '  ' }, 'damage')).toBe(false);
    expect(stepTouched({ damageKinds: ['broken_lights'] }, 'damage')).toBe(true);
    expect(stepTouched({ damageNote: 'Mirror hanging off' }, 'damage')).toBe(true);
    expect(stepAnswered({ damageNote: 'Mirror hanging off' }, 'damage')).toBe(true);
  });

  it('a step holds a real answer only when something is sent — "Not sure" is not one', () => {
    expect(stepAnswered({ contextUnsure: ['people'] }, 'people')).toBe(false);
    expect(stepAnswered({ peoplePresence: 'nobody' }, 'people')).toBe(true);
    expect(stepAnswered({ contextUnsure: ['state'] }, 'state')).toBe(false);
    expect(stepAnswered({ note: 'Bins' }, 'note')).toBe(true);
  });

  it('applies the follow-ups and the marks only where they belong', () => {
    expect(stepApplies({ contextFlags: ['parked'] }, 'staying')).toBe(true);
    expect(stepApplies({ contextFlags: ['parked'] }, 'direction')).toBe(false);
    expect(stepApplies({}, 'marks')).toBe(false);
    expect(stepApplies({}, 'people')).toBe(true);
    // What damage: only after "Damage visible".
    expect(stepApplies({ contextFlags: ['parked', 'damage_visible'] }, 'damage')).toBe(true);
    expect(stepApplies({ contextFlags: ['being_stripped'] }, 'damage')).toBe(false);
    expect(stepApplies({}, 'damage')).toBe(false);
    expect(CONTEXT_STEP_IDS).toEqual([
      'state',
      'staying',
      'direction',
      'people',
      'condition',
      'damage',
      'marks',
      'note',
    ]);
  });
});
