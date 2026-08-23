# Gap analysis — our review step vs the reference spec

WHAT: What our wizard review step did on 2026-08-22, what the reference asks
for, and what was changed. The closing checklist is the record of what was
matched, adapted, or deliberately skipped.
WHY: So the next person can tell a deliberate divergence from an oversight —
three of the items below are divergences we intend to keep.
LINKS: REFERENCE_SPEC.md (sibling); `src/shared/wizard/ReviewStep.tsx`.

## Scope note — this screen is shared

`ReviewStep` is owned by the **framework** and serves four wizards: post-a-car,
the garage's prefilled post (which inherits post-a-car's review via
`...baseFlow`), add-a-vehicle, and the alert wizard. Structural fixes therefore
land on all four; anything post-specific goes through the two optional slots,
which the other flows simply do not pass.

## The three changes that closed most of the gap

1. **It never showed the car.** `reviewValue` returns a **string**, so a
   seven-photo listing read `Photos — 5 added`. The reference's whole point is
   that the review shows the thing you made.
2. **No money summary existed.** No total, no fee, no escrow or refund line —
   and in reward mode the `Listing` row named **no number at all**. The only
   figure on the last screen before a card charge was inside the button.
3. **Rhythm.** Rows at `paddingVertical: spacing.sm` (8) under a `display`
   (32/38) title, in an app whose sections breathe at 24/32.

## Layout & rhythm

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Row height | ~48pt of text → a real target | the Edit control guarantees 44, plus `spacing.sm` → >= 60pt | S | High |
| Group separation | `gap: spacing.md` only | hairline + `paddingTop: spacing.xxl`, `gap: spacing.lg` → the divider → 32 → title → 16 → rows rhythm `PostDetailBody` uses | S | High |
| Double rules | last row's bottom hairline + next group's top hairline, 24pt apart | the last row draws none; the group's top rule is the boundary | S | Medium |
| Gutter | `spacing.xl` (24) ✅ | none — inherited from `WizardScreen` | — | — |
| Empty groups | a heading could render with no rows | `reviewGroups` drops them | S | Low |

## Component anatomy

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| The preview | absent → the listing as its audience sees it | `review.header` slot + `ReviewListingPreview` on `MediaIdentityCard` | L | **Highest** |
| Photo pattern | duplicated in the garage | extracted to `shared/ui/MediaIdentityCard` | M | — |
| Cost block | absent | `review.footer` slot + `ReviewCostPanel` | M | High |

## Typography & hierarchy

| | Current → Reference | Change |
|---|---|---|
| Title | `display` 32 | kept — it is the screen's one headline |
| Group titles | `heading` 18 ✅ | kept |
| Label/value | `caption` over `body` ✅ | kept |
| The sum | (did not exist) | `heading` 18 — the CTA names it again a thumb below, and `PostDetailBody` removed exactly that duplication once already |
| The sum's colour | — | `accentText` for a REWARD only. A listing fee is the absence of value, and painting it in the value accent is the dilution the rule exists to prevent |

## Interaction & motion

| | Status |
|---|---|
| Per-row edit that jumps to the step | ✅ **already better than the reference asks.** `editStep`/`returnToIndex` opens an edit spur, the CTA becomes "Done", and Back **cancels and restores the pre-edit snapshot**. Untouched. |
| Edit by step **id** from a slot | added — `stepFlatIndex`, so a flow never does index arithmetic |
| Touch target | `hitSlop` alone → `sizes.touchTarget` box in BOTH dimensions. hitSlop grew it vertically but left it exactly as wide as the word "Edit" |
| Photo chrome | `PlateChip` gained an `onMedia` variant: its default `surfaceSubtle` fill tracks the page, so on the photo strip it flipped to charcoal in dark mode beside white text that did not — a flip the photograph never makes |
| Progress | ✅ 4 dots, a11y label "Review" |
| Motion | unchanged; **no `springBouncy`** — reserved for success/reward, which is after payment, not here |

## States

| | Current → Reference | Change |
|---|---|---|
| Blocking answers | **silent** — the CTA re-checks every schema and greys out, with no error, no marked row, nothing naming which of twelve | `invalidStepIds` → a count line under the preview + a per-row flag |
| ⚠️ The flag keeps the value | — | the gate fails on TOO FEW as well as none (photos at 2 of 3), so the row shows "2 added" **and** "Needs another look". Replacing the value said something false and hid what they needed to fix it |
| Submit error | ✅ inline above the footer, live-region announced, every answer kept | untouched |
| Busy | ✅ spinner in the button, Back unmounted, re-entry guarded | untouched |

## Copy register

| | Note |
|---|---|
| Preview caption | "Spotters will have 5 photos and 2 distinctive features to go on." — recognition, never outcome; suppressed entirely when there is nothing yet, since "0 photos" under an empty frame reads as a scolding |
| Vocabulary | "distinctive features", matching every other surface — an earlier draft said "marks" a few inches above a row labelled "Distinctive features" |
| Escape values suppressed | the colour escapes ("Other", "Multicolour / wrapped") give way to the note that says what the car looks like, and `BODY_TYPE_UNKNOWN` ("Not sure") is dropped — the same suppression `buildCarDetailRows` already applies |
| ⚠️ No overclaiming | It is a 4:5 confirmation hero, **not** the 4:3 feed card, so the copy never says "this is exactly what spotters see" |
| Money note | echoes `defaultBountyPanelCopy` and the pricing card verbatim in tone; both figures come from `shared/lib/money` |
| Register | verification, not pride — see REFERENCE_SPEC §1 |

## A bug found on the way

`reviewGroups` filtered on `reviewValue` alone and never consulted `step.when`.
`bountyAmountPence` is seeded to £250, so a **no-reward listing showed
"Bounty £250" directly above "Post & pay £5"** — a sum nobody chose and nobody
would be charged, on the one screen that has to be exact about money. The flow's
own comment already claimed the skipped step "contributes no review row"; the
code disagreed.

Fixed with an opt-in `hideReviewWhenSkipped`, **not** by changing the default:
a surviving row is usually right, and the garage's plate step depends on it —
there a photo scan produced a *real* registration the owner confirmed, and an
answer nobody was asked for is precisely the one worth offering to correct. The
framework cannot tell a confirmed answer from a seed, so the flow declares it.

## Checklist

**Matched:** one vertical scroll · one primary action · 24 gutter · hairline
separators · ~32 section rhythm · depth from photography, no shadow · the
preview leads · per-row edit that jumps · progress retained · label-over-value ·
weight-only hierarchy in one family.

**Adapted:** 4:5 portrait hero, not the browsing 4:3 (our confirmation-moment
precedent) · register moved from anticipation to verification · a cost block the
reference has no need for · danger used to name a blocking answer.

**Deliberately skipped:** Rausch coral (ADR-0006 monochrome) · Cereal (Satoshi) ·
3D iconography (lucide) · a post-publish "what's next" screen · rendering the
true feed card as the preview (needs an answers→`PostSummary` adapter).

**Unverified:** every dp figure in the spec. There are no screenshots in this
folder — the spec is inferred from published teardowns, and the numbers are
directional. Adding 5–8 captures of the reference flow would let the next pass
measure rather than infer, as `post-detail/` did.

## Fixed on the second review pass

- **The identity strip was not AA over a bright photo.** White 14pt text over
  `mediaScrim` (`rgba(0,0,0,0.45)`) composites to about 3.4:1 on a white or
  silver car — the two commonest UK colours — and one of those runs is the
  **interactive Edit**. The first pass recorded this as a token-level issue to
  defer; that was wrong. `DESIGN_SYSTEM.md` already files `surfaceOverMedia`
  (opaque `#222222`, identical in both palettes) as the convention for chrome
  CARRYING text on photography — camera counters, the photo-count pill — while
  `mediaScrim` is for gradients BEHIND chrome. Using the right token is not
  forking the system, and it fixes the whole strip at once.
- **The submit gate ignored `when`.** `allStepsValid` skipped only `optional`
  steps, so a non-optional step being walked past still had to validate. Once a
  skipped step could also hide its review row, that combination could disable
  the pay button, count itself in the notice, and offer no row, no Edit and no
  reachable screen to fix it on. The gate now agrees with the walk, and
  `allStepsValid` is derived from `invalidStepIds` so the button and the
  sentence explaining it cannot drift.
- **The blocking notice was announced twice, and cut off the screen title.**
  It now travels inside `WizardScreen`'s single landing announcement.
- **A money-boundary test was asserting against a stale mock.**
  `postACarFlow.test.ts` mocked `MIN_BOUNTY_PENCE: 5000` and asserted £49.99
  was refused — against a floor the app stopped enforcing on 2026-08-13. It
  passed the whole time. The mock now re-exports the real bounds, and the floor
  has its own named assertion.

## Raised in review and deliberately left
- **The caption restates two rows.** The preview says "5 photos and 2
  distinctive features"; the Photos and Distinctive features rows still say
  "5 added" / "2 added" further down. Mild duplication, kept on purpose: the
  caption frames what a spotter has, the rows are the edit affordance for each,
  and silently dropping rows when a flow supplies a header would be magic.
- **The title stays at `display` (32).** Arguably it now labels a list rather
  than asking a question, and `title` (24) would give the hero more room above
  the fold. Left alone because this heading is shared by all four wizards'
  review screens and changing it is a framework-wide type decision, not a
  post-a-car one.
- **Expanding from the review still resets to screen 0.** A saved car with
  enough photos sends the preview's Edit to the confirm step, whose own Edit
  expands the flow — changing the screen-list identity, which the navigation
  reducer answers with a full `reset` (a documented SAFETY behaviour, because
  that path ends in a Stripe charge). Pre-existing, but the preview is now the
  largest tap target on the screen, so it is a hotter path than it was. Fixing
  it means teaching `reset` to preserve position across a widening flow, which
  is a navigation change, not a review-step one.
