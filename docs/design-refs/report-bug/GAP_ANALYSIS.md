# Gap analysis — our Report a bug screen vs the reference spec

WHAT: Every divergence between the screen as built (2026-08-24, twice in one
      day) and `./REFERENCE_SPEC.md`, with what was changed and what was left.
WHY:  The screen went from one text box to six questions in a day and its
      LAYOUT never moved. This records which of that was closed, which was
      deliberately not, and the two things the pass found that were not design
      problems at all.
LINKS: ./REFERENCE_SPEC.md; src/features/profile/screens/ReportBugScreen.tsx;
      src/shared/ui/StickyActionBar.tsx; src/shared/ui/Screen.tsx.

## The three changes that closed most of the gap

1. **The blanket `gap: spacing.lg` came off the scroll container.** This was the
   whole of "it looks like a plain form". One even gap meant the headline, six
   unrelated questions and a privacy disclosure all sat 16pt apart, so nothing
   grouped, nothing led, and the eye had no reason to stop anywhere. Each
   section now owns `marginTop: spacing.xxl` with `gap: spacing.lg` inside it —
   the house rhythm already written down in `post-wizard-review`'s spec. It is
   the cheapest change here and the one that does the most.

2. **Send moved into a pinned bar.** Six questions put the primary action below
   the fold, which is the one thing the reference is unambiguous about on
   mobile. New `StickyActionBar` + a `footer` slot on `Screen`.

3. **Severity became CardSelect rows.** "Annoying" and "I lost money or data"
   as two identical pills read as two options of equal weight. As rows with an
   icon and a line of explanation they read as what they are — a scale.

## Layout & rhythm

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Gutter | `spacing.xl` (24) ✅ | none — already the house rule for forms | — | — |
| Inter-element rhythm | flat `gap: spacing.lg` everywhere → grouped, 32 between groups | removed the container gap; `styles.section` with `marginTop: spacing.xxl` | S | **Highest** |
| Headline → content | 16 → 24–32 | `intro` block, `marginBottom: spacing.xxl` | S | Medium |
| Elevation | none ✅ | none — reference runs one tier and ours says "prefer none" | — | — |

## Component anatomy

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Severity | `ChoiceChips` pills → large rows with title + description | `CardSelect`, with `description` + lucide `icon` added to `BUG_SEVERITIES` | M | **Highest** |
| Frequency | `ChoiceChips` → rows | `CardSelect`, title-only (both extras are optional on `CardSelectOption`) | S | Medium |
| Area | `SelectField` → full-screen picker with search | none — `SelectScreen` already is the reference pattern | — | — |
| Primary action | last item in scroll → pinned bar | new `StickyActionBar`, new `Screen.footer` slot | M | **Highest** |
| Disclosure panel | hairline + grey caption → grounded panel | `surfaceSubtle`, `radii.lg`, `spacing.lg` padding, title to `cardTitle` | S | High |

⚠️ **The disclosure change reverses a comment in the file**, which said "a quiet
panel rather than a card: this is a disclosure, not an object the reader is
meant to act on". That was right about **affordance** and wrong about
**weight** — it was the most important thing on the screen dressed as the least
important. It now has a ground and a radius and still has no shadow, no chevron
and no press state. The old reasoning is quoted in the new comment rather than
deleted, because the affordance half of it is still the rule.

## Typography & hierarchy

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Screen title | inline in the header bar → in the content, with air | moved to `intro` with a `spacing.xxl` skirt; stayed at `typography.title` | S | High |
| First question | floating label only → its own heading | "What went wrong?" is the ONE required answer and had the quietest treatment on the screen; given a `heading` like the five optional ones | S | High |
| Optionality band | `heading`, indistinguishable from a question title → bands the group | raised to `typography.sectionTitle` (20/26) and lifted out of the section | S | Medium |
| Screenshot warning | `caption` + `textSecondary` → readable | `body` + `textPrimary` — it is the whole mitigation and was set as fine print | S | High |
| Sub-line | absent → one quiet sentence | added, `body` + `textSecondary` | S | Low |
| Question headings | `typography.label` (14) → small but confident | `typography.heading` (18/24) | S | Medium |
| Header bar | chevron + title → chrome only | title removed from the bar | S | Medium |

## Interaction & motion

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Selection feedback | chip fill → border colour at constant width | inherited from `CardSelect` — nothing reflows on tap | — | Medium |
| Keyboard | Send scrolled with content | bar is a FLEX child inside `Screen`'s KeyboardAvoidingView | M | High |
| Motion | none added | none — the reference's restraint is the point | — | — |

⚠️ **The keyboard is why the bar is not `position: absolute`.** The obvious
build — absolute bar plus a matching bottom padding on the scroll — puts the
bar *outside* `Screen`'s KeyboardAvoidingView, so on iOS the keyboard rises
straight over the Send button of a form, exactly while the form is being typed
into. Rendered through the `footer` slot it is inside the lift, the ScrollView
shrinks to fit, and there is no padding constant left to drift out of sync.
`useAndroidKeyboardHeight()` covers Android, which is edge-to-edge under SDK 57
and does not resize its window.

## States

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Empty | Send dimmed on empty message ✅ | none | — | — |
| Sending | spinner in the button, full opacity ✅ | none | — | — |
| Error | toast, text retained ✅ | none | — | — |
| No readable device fields | panel still renders ✅ | none — pinned by test | — | — |

## Copy register

| | Current → Reference | Change | Effort | Impact |
|---|---|---|---|---|
| Headline | none → states the task | "Report a bug" + "Tell us what went wrong and we'll take a look." | S | Low |
| Register | flat ✅ | none — owner chose calm and matter-of-fact over the reference's encouraging tone | — | — |
| Expected field | floating label only → its own question | heading "What did you expect instead?", label narrowed to "What should have happened?" | S | Low |

## Fixed on the review pass

Four of these are worth recording because they are the same mistake in
different clothes — a claim in a comment that the code beside it did not keep.

| | Found | Fix |
|---|---|---|
| **Comment vs code** | `diagnosticsLabel` and `diagnosticsValue` BOTH had `flexShrink: 1` under a comment insisting "THE LABEL YIELDS, NOT THE VALUE". flexShrink is *proportional* to base width, so the longer string surrenders more — and the longer string is the value. The comment described the bug it was supposed to have fixed | `flex: 1` on the label, **no** flex property on the value, copying `ListRow` exactly |
| **Touch target** | The screenshot remove button was 36pt with no hitSlop, positioned at negative offsets OUTSIDE its parent — and Android delivers no touch outside a parent, so part of it was simply dead. `PhotoGridPicker` already carries this scar in a comment | Parent padded, button inset to 0, `hitSlop` to a 44pt target |
| **Dark-mode ladder** | `surfaceSubtle` sits *below* `surface` in light and *above* it in dark, so the panel nobody can press was the most-raised surface on the dark screen — brighter than the rows that are tappable | `surface` + a hairline. Also stops the collection promise sharing a fill with the empty screenshot tile |
| **Stale comment elsewhere** | `Screen.tsx` said "Android's adjustResize already does it", which stopped being true at SDK 57's edge-to-edge — and it is the comment a reader hits *before* the one in `StickyActionBar`, so it invites deleting the keyboard lift | Rewritten to say what is actually true and to warn against the simplification |

## A gap found on the way that was not a design problem

**Severity and frequency had no test at all.** They appeared in the test
fixtures only as `null`, so nothing checked that picking one did anything —
which means the chips-to-`CardSelect` swap is precisely the change that could
have shipped them silently broken. Four tests added: the picked values travel,
the row reports `checked` to a screen reader (border colour is invisible to
one), the descriptions render, and Send lives inside the pinned footer. All
four confirmed load-bearing by reintroducing the defect.

## Deliberately left

| | Why |
|---|---|
| The step-per-question restructure | Owner decision with evidence: conversational forms scored *lowest* in the usability study cited in the spec, and six questions is under the threshold where splitting helps. Diverges from `DESIGN_SYSTEM.md`'s own "one topic per screen step" rule, which describes the posting wizard |
| Converting `PostBottomBar` to `StickyActionBar` | Genuinely a different pattern — an absolute overlay over a photo-led scroll with no text input and so no keyboard to dodge. Converting it means restructuring `PostDetailScreen`'s layout to gain nothing. `StickyActionBar` therefore ships to `shared/` with ONE consumer, below the usual bar; the reasoning is written into its header rather than papered over |
| A screenshot count badge on the add tile | The disclosure panel already counts them, and counting twice invites the two to disagree |

## Still open

- **No screenshots in `docs/design-refs/report-bug/`** — this spec is weaker
  than `post-detail`'s, which was measured from eight images.
- **Never seen on a device.** `typography.display` at 200% text, the CardSelect
  rows wrapping, and whether the pinned bar crowds the disclosure panel are all
  unverified on real hardware.
