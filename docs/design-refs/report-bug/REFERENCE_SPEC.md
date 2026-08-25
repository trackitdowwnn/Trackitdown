# Reference spec — a support form the user fills in while annoyed

WHAT: The measurable target for "Report a bug": layout rhythm, type hierarchy,
      row anatomy, what sticks and what scrolls, and the emotional register of
      the copy — each mapped to one of our tokens.
WHY:  The screen grew from one text box to six questions in a day and its
      LAYOUT never grew with it. This file is the standard the redesign is
      measured against, so "it looks better" can be checked rather than
      asserted.
LINKS: ./GAP_ANALYSIS.md; src/features/profile/screens/ReportBugScreen.tsx;
      docs/DESIGN_SYSTEM.md; docs/design-refs/post-wizard-review/REFERENCE_SPEC.md
      (the section-rhythm spec this reuses).

## Sources & confidence

⚠️ **NO SCREENSHOTS.** `docs/design-refs/report-bug/` holds no reference
images — the owner chose to proceed on web research (2026-08-24). Every
observation below is therefore from secondary sources or reasoned from
Airbnb's public surfaces, and the numeric values are **community-observed,
not vendor-published**. That is a real limitation: this spec is weaker than
`post-detail/REFERENCE_SPEC.md`, which was measured from eight screenshots.

⚠️ **THE ANALOGUE IS WEAK, AND THIS IS THE WEAKEST ONE WE HAVE ATTEMPTED.**
Airbnb has no public bug-report screen. Their nearest relatives are *Report
this listing* (a step-per-question flow) and **Airbnb Setup**, the listing
creation flow. Airbnb publishes essentially nothing about either — three
separate searches for teardowns of the reporting flow returned no measurable
detail, which is itself the finding. So we borrow the **language**, not a
screen: confidence is high on grid, type hierarchy, elevation and the sticky
mobile CTA; low on anything screen-specific.

Sources:
- [Airbnb design system breakdown — Superdesign (2026)](https://superdesign.dev/blog/airbnb-design-system)
  — 4px grid; radii 8 (buttons) / 12–20 (cards) / 999 (pills); one type family,
  weight-only hierarchy; **one elevation tier** ("depth from photography,
  whitespace and rounded corners — not heavy shadows").
- [Airbnb DLS — DesignSystems.one](https://www.designsystems.one/design-systems/airbnb-design)
- [The 2022 Winter Release: Introducing Airbnb Setup](https://news.airbnb.com/2022-winter-release/)
  — the three-step listing creation flow.
- [Airbnb 2025 Summer Release](https://news.airbnb.com/airbnb-2025-summer-release/)
  — the current, more dimensional design language.
- [Comparing single-page, multipage and conversational forms — usability study](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8190652/)
  — conversational forms scored **lowest** (57 vs 76 single-page).
- [One-question-at-a-time vs single-page forms — Fillout](https://www.fillout.com/blog/one-question-at-a-time-form)
  — the ~12-question threshold above which splitting starts to help.

## 1 — What this screen is for

| Observation | Note |
|---|---|
| Its job | Capture enough to reproduce a bug, from someone who is not being paid to help us |
| Its user | An existing member, mid-task, who has just hit something broken |
| Emotional context | Mild frustration and a favour being done. Not anticipation, not distress |
| Success | They finish it. Every second added is a chance they abandon and we learn nothing |

### ⚠️ Emotional translation — the one place we must diverge

Airbnb Setup is paced for someone **excited to earn money from their home**.
Steps feel considered because the user wants the outcome and will forgive the
taps. Our user wants to close the screen. Fidelity to the *feeling* — get them
out fast, look like we take it seriously — beats fidelity to the *structure*.

This is also why the copy stays flat. "Help us make Trackitdown better" asks
someone irritated to feel warm about doing us a favour; "What went wrong?"
just gets on with it.

## 2 — Layout & rhythm

| Observation | Reference | Nearest token |
|---|---|---|
| Base grid | 4px | `spacing` is 4pt-based ✅ |
| Screen gutter | Generous, consistent | `spacing.xl` (24) ✅ — DESIGN_SYSTEM's rule for forms |
| Gap between related controls | ~16 | `spacing.lg` ✅ |
| Gap between question groups | ~32 | `spacing.xxl` ✅ — matches `post-wizard-review` §2's "divider → 32 → title → 16 → content" |
| Headline → first control | ~24–32 | `spacing.xxl` |
| Elevation | One tier; depth from whitespace and radius, **not shadows** | `shadows.soft` exists but DESIGN_SYSTEM says "prefer none" ✅ — use none here |
| Grouped panel radius | 12–20 | `radii.lg` (16) ✅ |

## 3 — The header and headline

| Observation | Reference | Nearest token |
|---|---|---|
| Header bar | Chrome only — a back/close control, no title competing with the headline | Hand-rolled chevron row (house pattern, ~16 screens) |
| Screen title | Lives in the CONTENT, not in the bar | `typography.title` (24/30) — see the note below |
| Sub-line | One quiet sentence under it, sets expectation | `typography.body` + `textSecondary` |
| Question headings | Small, confident — Airbnb's own headings are deliberately quiet (listing h1 is 22/500) | `typography.heading` (18/24 Bold) |

⚠️ **The headline was built at `display` (32/38 Black) and stepped down to
`title` after review.** The tension in the sources is real — Airbnb's *browse*
surfaces use small type (28px homepage h1, 22px listing h1) while their
*creation* flow goes large per screen — and the first build took the creation
flow's size. Three things settled it the other way: every content-level
`display` in this app is a QUESTION or a MOMENT (the wizard's step, the
permission primer) whereas this is a screen NAME, which is what DESIGN_SYSTEM
scopes `title` to; `display` is the loudest type in the app and this is its
least celebratory screen, against a register the owner chose as "calm and
matter-of-fact"; and uncapped at fontScale 2 it reached 64/76 — roughly 150pt
of headline before the first question on a 390×844 phone.

What gives the screen a top is putting the title in the CONTENT with air under
it, not the point size. Every heading below it stays quiet either way.

## 4 — The answer rows

| Observation | Reference | Nearest token |
|---|---|---|
| Choice with a sentence of explanation | Large tappable row: icon, title, description | `CardSelect` ✅ — icon + `cardTitle` + `caption`, `radii.lg`, selection by **border colour** so nothing reflows |
| Choice that is one or two words | Compact pill | `ChoiceChips` ✅ — correct where it is used, wrong where the option needs explaining |
| Long closed list | Full-screen picker with search | `SelectField` → `SelectScreen` ✅ |
| Selection indicator | Never a heavy fill | `CardSelect` uses `border` → `primary` at constant `sizes.selectBorder` ✅ |
| Touch target | Generous | `sizes.touchTarget` (44) minimum ✅ |

## 5 — The commit (ours, not the reference's)

| Observation | Reference | Nearest token |
|---|---|---|
| Primary action | **Sticky bottom bar on mobile** — never scrolls away | New `StickyActionBar`; precedent is `PostBottomBar` ("The Airbnb move") |
| Bar ground | Solid surface, hairline top border | `surface` + `StyleSheet.hairlineWidth` + `border` ✅ |
| Safe area | Bar pads for the home indicator | `insets.bottom + spacing.md` (the `PostBottomBar` formula) |
| Scroll compensation | ⚠️ **NOT NEEDED — do not add it** | The bar is a FLEX sibling via `Screen`'s `footer`, so the ScrollView is already bounded by it. `insets.bottom + sizes.control + spacing.xl` is `PostBottomBar`'s formula, for an ABSOLUTE overlay; applying it here double-counts and leaves a dead band under the panel |
| Disclosure before commit | The thing you are agreeing to sits directly above the action | `surfaceSubtle` panel, `radii.lg`, `spacing.lg` padding |

⚠️ The disclosure panel takes **weight without affordance**: a ground and a
radius, but no chevron, no shadow, no press state. Airbnb's card language would
happily make this a card; a card invites a tap, and there is nothing here to
tap. It is a statement, and it has to look like an important one.

## 6 — Deliberately not adopted

| Not adopted | Why |
|---|---|
| **One question per screen** | Their flow is paced for a motivated host. Six questions is under the ~12 threshold where splitting helps, and the usability study scored conversational forms *lowest*. Diverges from `DESIGN_SYSTEM.md`'s own "one topic per screen step" rule — that rule describes the posting wizard, which guards a £5 transaction |
| Step progress indicator | Nothing to progress through |
| Rausch `#FF385C` and their accents | ADR-0006 — monochrome near-black `#1A1A1A` is our action colour |
| Airbnb Cereal | Satoshi, and weight is a family (no SemiBold face exists) |
| Their 3D/skeuomorphic 2025 icon set | lucide stays |
| Heavy card elevation | Their own system is one tier; ours says "prefer none" |
| Verbatim copy | Register borrowed, words ours |
