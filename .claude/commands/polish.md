---
description: Sweep a section of the app for polish opportunities — the small gaps between "works" and "feels finished" — and fix the approved ones
argument-hint: <section, screen, or feature to polish>
---

Find and fix polish opportunities in: $ARGUMENTS

This is a FINISH pass, not a bug hunt or a redesign. The target already
works; the job is the difference between "functional" and "feels
professionally made". Do NOT propose new features or restructure — polish
is small, high-craft, low-risk.

## Phase 1 — Experience the section as a user

Read the target's code, then walk it in your head state by state. Polish
gaps hide in the states nobody demos. Check systematically:

1. THE FOUR STATES every data-driven surface needs: loading (skeleton,
   not a spinner, per DESIGN_SYSTEM), empty (a warm, on-brand EmptyState
   with a way forward — never a blank screen or bare "No results"), error
   (ErrorState with retry, human copy), and populated. Flag every missing
   one.
2. TRANSITIONS & MOTION: abrupt appear/disappears where a fade or slide
   is warranted, missing press feedback (the 0.98 scale), list items
   popping in without entrance, screen/sheet transitions that snap,
   anything janky against the motion tokens. Also over-animation to tone
   down.
3. MICROCOPY: placeholder or robotic text, jargon, inconsistent
   terminology (against the glossary if one exists), buttons labelled
   "Submit"/"OK" where a specific verb fits, missing helper text at
   confusing moments, error messages that don't say what to do next.
4. SPACING & ALIGNMENT: inconsistent padding vs the spacing scale,
   cramped touch targets (<44pt), things not optically aligned, hairline/
   divider inconsistency, content touching safe-area edges.
5. FEEDBACK & AFFORDANCE: actions with no confirmation (missing Toast
   after a save), tappable things that don't look tappable, loading
   states missing on async buttons, no haptics where they'd feel right.
6. EDGE CONTENT: long text overflow/truncation, tiny/missing images,
   zero/singular/plural correctness ("1 sightings"), very large dynamic
   type breaking layout, the longest-realistic-value case.
7. THE SMALL DELIGHTS: a moment that could carry a little warmth and
   currently doesn't (a success state, a first-time empty state) —
   propose sparingly, register-appropriate (calm on theft-side, warmth
   allowed on spotter/success/neutral surfaces).

## Phase 2 — Interview me briefly

One small batch: anything in this section that's bugged me or felt
unfinished? How polished is this area meant to be right now (ship-it vs
showcase)? Any state I know is incomplete?

## Phase 3 — Polish report (no changes yet)

A checklist grouped: **Missing states** (highest priority — these are
holes, not polish) / **Motion & feedback** / **Copy** / **Spacing &
alignment** / **Edge cases** / **Optional delight**. Each: one line,
file:line, effort S/M/L, and the specific fix. Mark anything that's
actually a bug (→ suggest /diagnose-and-fix-bug) or a real redesign (→
/improve) — polish stays in its lane. Give me the shortlist of highest
impact-per-effort items up top.

## Phase 4 — Implement approved items

Smallest first; tokens and shared components only (a polish pass that
hard-codes values or forks components has failed); reuse existing
EmptyState/ErrorState/Skeleton/Toast rather than inventing; respect
reduced-motion on any motion added; update copy against the design
system voice. Run ui-reviewer, and the both-phones look walking every
state (deliberately trigger empty and error — the states you just
filled are the ones to verify). Suggest the commit.

## Rules
- Polish never changes behaviour, structure, or scope — if a fix does,
  it's not polish, route it correctly.
- Missing states are the highest-value find — an unhandled empty or
  error state is the most common "unfinished" tell in any app.
- Consistency over cleverness: match how the rest of the app already
  does it rather than introducing a nicer one-off.
- If a section is genuinely polished, say so — don't manufacture work.