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

// Stub the step bodies so the config loads without the image picker's native
// graph — the treatment addVehicleFlow.test gives its own steps.
jest.mock('../components/bugWizardSteps', () => ({
  BugWhatHappenedStep: () => null,
  BugContextStep: () => null,
  BugScreenshotsStep: () => null,
}));
jest.mock('../components/BugDisclosurePanel', () => ({
  BugDisclosurePanel: () => null,
}));

import { buildBugReportFlow } from './bugReportFlow';

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

    expect(schema.safeParse({ message: 'The map went blank' }).success).toBe(true);
    expect(schema.safeParse({ message: '' }).success).toBe(false);
    // " " is not a bug report. Without the trim, a space would advance the flow
    // and produce a row nobody can triage.
    expect(schema.safeParse({ message: '   ' }).success).toBe(false);
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

  it('⚠️ carries the disclosure panel as its footer', () => {
    // The panel is what makes the privacy policy honest, and the footer slot is
    // the only place it can go: `reviewValue` returns a string, so a list of
    // rows could be described but never rendered.
    expect(flow.review?.footer).toBeDefined();
    expect(flow.review?.footer?.({})).toBeTruthy();
  });
});
