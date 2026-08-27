/**
 * WHAT:  Smoke tests for the report-a-bug flow config — that the one required
 *        answer really gates, that the other two steps genuinely do not, and
 *        that the review screen names every answer the payload carries.
 * WHY:   The framework cannot tie a step schema's keys to the answers shape
 *        (wizard/types.ts LIMITATION), so a typo'd key compiles but the step can
 *        never validate — every flow needs this net.
 *
 *        ⚠️ THE SKIPPABILITY IS THE PRODUCT DECISION, so it is pinned rather
 *        than left to the config reading right. A bug report is altruistic and
 *        filed by someone already annoyed; if steps 2 and 3 ever start gating,
 *        a one-line report stops being three taps and the reports stop coming.
 *        That failure is silent — nothing errors, people just give up.
 * LINKS: ./bugReportFlow.tsx; src/shared/wizard/types.ts; docs/TESTING.md.
 */

import { bugDisclosureRows } from '../components/BugDisclosurePanel';
import { BUG_REPORT_MIN_LENGTH, describeMessageProgress } from './bugMessageRules';
import type { BugReportAnswers } from './bugReportAnswers';
import { buildBugReportFlow } from './bugReportFlow';

// Stub the step bodies so the config loads without the image picker's native
// graph — the treatment addVehicleFlow.test gives its own steps. Below the
// imports rather than above them because babel-jest hoists `jest.mock` above
// both regardless, so writing it first only trips `import/first`.
jest.mock('../components/bugWizardSteps', () => ({
  BugWhatHappenedStep: () => null,
  BugContextStep: () => null,
  BugScreenshotsStep: () => null,
}));
// ⚠️ Only the COMPONENT is stubbed. `bugDisclosureRows` stays real, because the
// completeness test below checks the panel half of the review screen against
// the payload — stubbing the row builder would leave it agreeing with itself.
jest.mock('../components/BugDisclosurePanel', () => ({
  ...jest.requireActual('../components/BugDisclosurePanel'),
  BugDisclosurePanel: () => null,
}));

const flow = buildBugReportFlow([{ label: 'App version', value: '1.0.0' }]);
const steps = flow.phases.flatMap((phase) => phase.steps);
const step = (id: string) => {
  const found = steps.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no step ${id}`);
  return found;
};

describe('the shape of the flow', () => {
  it('is three steps in one phase, then review', () => {
    // Not one-question-per-screen, deliberately — see the flow's own header.
    expect(flow.phases).toHaveLength(1);
    expect(steps.map((s) => s.id)).toEqual(['what-happened', 'context', 'screenshots']);
    expect(flow.review).toBeDefined();
  });

  it('never labels the final button something vague', () => {
    expect(flow.finalCtaLabel).toBe('Send report');
  });
});

describe('⚠️ what gates and what does not', () => {
  it('requires a message, and rejects whitespace as an answer', () => {
    const schema = step('what-happened').schema;

    expect(schema.safeParse({ message: 'The map went blank when I opened it' }).success).toBe(true);
    expect(schema.safeParse({ message: '' }).success).toBe(false);
    // " " is not a bug report. Without the trim, a space would advance the flow
    // and produce a row nobody can triage.
    expect(schema.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('⚠️ holds the gate at exactly BUG_REPORT_MIN_LENGTH, measured after trimming', () => {
    const schema = step('what-happened').schema;
    const exact = 'x'.repeat(BUG_REPORT_MIN_LENGTH);

    expect(schema.safeParse({ message: exact }).success).toBe(true);
    expect(schema.safeParse({ message: 'x'.repeat(BUG_REPORT_MIN_LENGTH - 1) }).success).toBe(
      false,
    );
    // ⚠️ Padding is not length. Without the trim, twenty spaces around "hi"
    // would clear a minimum that exists to make a report triageable.
    expect(schema.safeParse({ message: `  ${'x'.repeat(BUG_REPORT_MIN_LENGTH - 1)}  ` }).success)
      .toBe(false);
    // And the counter must agree with the gate at the boundary, or a disabled
    // Next sits under a caption saying the answer is already long enough.
    expect(describeMessageProgress(exact)).not.toContain('more character');
    expect(describeMessageProgress('x'.repeat(BUG_REPORT_MIN_LENGTH - 1))).toContain(
      '1 more character',
    );
  });

  it('⚠️ lets the last two steps advance with nothing filled in', () => {
    // The fast path: message → Next → Next → Send.
    expect(step('context').schema.safeParse({}).success).toBe(true);
    expect(step('screenshots').schema.safeParse({}).success).toBe(true);
  });

  it('⚠️ marks them optional so the REVIEW gate does not demand them either', () => {
    // Separate from the schema, and both are needed: without `optional` the
    // review screen's final CTA re-checks every step, so an unanswered step
    // blocks submission from a screen that never said why.
    expect(step('context').optional).toBe(true);
    expect(step('screenshots').optional).toBe(true);
    expect(step('what-happened').optional).toBeFalsy();
  });
});

describe('the review screen', () => {
  it('shows the message that was typed', () => {
    expect(step('what-happened').reviewValue?.({ message: '  The map went blank  ' })).toBe(
      'The map went blank',
    );
  });

  it('⚠️ names all three context answers in its one row', () => {
    // A step gets exactly one review row and this step asks three things.
    // Spending it on the area alone would leave severity and frequency
    // unreviewable on the one screen that exists to show what is being sent.
    expect(
      step('context').reviewValue?.({
        area: 'explore',
        severity: 'blocked',
        frequency: 'always',
      }),
    ).toBe('Explore & map · I couldn’t finish something · Every time');
  });

  it('reads a skipped context step as skipped, not as three refusals', () => {
    expect(step('context').reviewValue?.({})).toBe('Not said');
  });

  it('names a partly-answered context step with only what was given', () => {
    expect(step('context').reviewValue?.({ area: 'messages' })).toBe('Messages');
  });

  it('counts screenshots, and says None rather than 0', () => {
    expect(step('screenshots').reviewValue?.({ shots: [] })).toBe('None');
    expect(
      step('screenshots').reviewValue?.({ shots: [{ uri: 'a', width: 1, height: 1 }] }),
    ).toBe('1 image');
  });

  it('⚠️ names EVERY answer that reaches the payload', () => {
    // THE TEST THAT WOULD HAVE CAUGHT IT. `expected` shipped for one commit
    // with no reviewValue covering it and no disclosure row either — a
    // free-text field, the kind most likely to carry a plate or an address,
    // leaving the device unshown on the screen that exists to say what is being
    // sent. On the old single form both boxes sat in the same viewport as the
    // button; splitting the flow is what made it possible to lose one.
    //
    // ⚠️ DERIVED FROM THE FIXTURE, NOT A LIST OF STRINGS, and the first version
    // was the list — a typed fixture followed by six hand-written `toContain`s,
    // which is a net with no bottom: adding a key to BugReportAnswers, wiring
    // it into the payload and showing it NOWHERE passed green, because nothing
    // linked the assertions to the keys. Three separate comments cited this
    // test as the guarantee. The mapping below is `Record<keyof ...>`, so a new
    // answer is a compile error here AND an assertion, and both halves of the
    // review screen are searched — the step rows and the disclosure panel.
    const filled: BugReportAnswers = {
      message: 'The map went blank',
      expected: 'It should show pins',
      area: 'explore',
      severity: 'blocked',
      frequency: 'always',
      shots: [{ uri: 'a', width: 1, height: 1 }],
    };

    /** What the reviewer must be able to SEE for each answer they gave. */
    const shownAs: Record<keyof BugReportAnswers, string> = {
      message: 'The map went blank',
      expected: 'It should show pins',
      area: 'Explore & map',
      severity: 'I couldn’t finish something',
      frequency: 'Every time',
      shots: '1 image',
    };

    // Both halves of the screen: the step rows are what the reporter chose or
    // typed, the panel is what travels that they did not. An answer named by
    // neither is an answer that leaves the device unshown.
    const rows = steps
      .map((step) => step.reviewValue?.(filled))
      .filter((value): value is string => Boolean(value));
    const panel = bugDisclosureRows({
      lines: [{ label: 'App version', value: '1.0.0' }],
      area: filled.area ?? null,
      shots: filled.shots?.length ?? 0,
    }).map((row) => `${row.label}: ${row.value}`);
    const onScreen = [...rows, ...panel].join(' | ');

    for (const [answer, expected] of Object.entries(shownAs)) {
      // Named per key, so a failure says WHICH answer went invisible.
      expect(`${answer} → ${onScreen}`).toContain(expected);
    }
    // And the fixture itself must stay exhaustive: every key of the answers
    // shape needs an entry above, or the loop silently checks fewer things.
    expect(Object.keys(shownAs).sort()).toEqual(Object.keys(filled).sort());
  });

  it('⚠️ carries the disclosure panel as its footer', () => {
    // The panel is what makes the privacy policy honest, and the footer slot is
    // the only place it can go: `reviewValue` returns a string, so a list of
    // rows could be described but never rendered.
    expect(flow.review?.footer).toBeDefined();
    expect(flow.review?.footer?.({})).toBeTruthy();
  });
});
