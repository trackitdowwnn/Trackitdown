# Gap analysis — our onboarding vs the reference spec

WHAT: What the onboarding slideshow did on 2026-08-23, what the reference asks
for, and what changed. The outcome checklist is the record of what was matched,
adapted, or deliberately skipped.
WHY: So the next person can tell a deliberate divergence from an oversight —
and, more than on any other screen here, so the next person knows what has
already been tried.
LINKS: REFERENCE_SPEC.md (sibling); `src/features/auth/README.md` § "Onboarding
(first slice)" — the fuller decision record; `src/features/auth/components/`.

## Hard boundaries honoured throughout (owner, 2026-08-23)

- **Monochrome** (ADR-0006). The reference is lilac; it stays lilac.
- **No new image assets.** The repo has never contained a photograph or an
  illustration, and this change does not add one — the hero is SVG, like the
  wash and the ring before it.
- **⚠️ Two heroes have already been removed from this screen**, and any third
  had to answer them: per-slide emoji in grey circles (🚗 📣 📸 🎉 — the 🎉
  celebrating at someone whose car had just been stolen), then a code-drawn UK
  registration plate that "lasted two days and did not earn the room".
- **The 2026-08-08 restyle is not undone.** The ring FAB, Skip's position, the
  stepped (not swiped) transitions and the weight-contrast headlines are all
  documented decisions and all still right.

## The 3 changes that close most of the gap

1. **C1 — a hero that is the product's subject.** The reference is
   photography-led; we had nothing above the words, for want of assets.
2. **R1 — a first sentence that says what the app is.** The flow opened mid-story.
3. **M1 — one thing that persists across the steps.** Continuity is what makes a
   sequence read as one story rather than four pictures.

## Layout & rhythm

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| L1 | Words low, nothing above them | Imagery top, bleeding off the frame; words lower third | Map in the upper 55% — the exact band the wash holds flat | M | **L** |
| L2 | 24 gutter, ring bottom-right, Skip bottom-left | Same | none — already matches | — | — |
| L3 | No relationship between wash and content | Depth from one soft field | Map fades into the wash at its own lower edge; the backdrop is untouched | S | M |

## Component anatomy

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| C1 | No hero at all | A photograph, full-bleed | `OnboardingMap` — curved roads in SVG under the app's real bounty pills | L | **L** |
| C2 | — | Image is the subject | Pins ARE `MapPins`' pill: `surface` fill, `radii.full`, `borderStrong` hairline, amount in `typography.mapPin`; the focal one inverts to `surfaceInverse` and grows, as the selected pin does | S | M |
| C3 | Ring FAB fuses progress + control | One circular control | none — better than the reference, keep | — | — |
| C4 | — | — | Map yields the screen **at and above 1.3× text scale**, applying the wizard's `fills` rule | S | M |
| C5 | Map and copy shared the same pixels | Text never fights the image | Flex siblings that cannot overlap; the map bleeds under the status bar via a negative top margin | M | **L** |

## Typography & hierarchy

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| T1 | `displayHero` 40/46, weight alternating mid-sentence | Same anatomy | none — this is the part that already matched | — | — |

## Interaction & motion

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| M1 | Every element remounts per step | Continuity across a sequence | Map lives OUTSIDE the keyed stage: words step, map morphs | M | **L** |
| M2 | 250 + `easeOut` + `ReduceMotion.System` | Calm, one curve, reduced-motion first-class | none — map joins the same clock and curve | — | — |
| M3 | — | Celebration only for reward | ⚠️ no `springBouncy` on the recovery stage; a quiet ring settles | S | S |

## States

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| S1 | No loading/empty/error states — the screen has no data | — | unchanged, and correct: onboarding must never wait on anything | — | — |
| S2 | Large text squeezed the copy | "Big text beats the full-bleed map" | C4 — the map yields its band | S | M |
| S3 | Copy overflowed a stage that could not scroll | A fills step scrolls instead | `ScrollView` behind the words, `flexGrow: 1` so they stay bottom-aligned until they must scroll | S | M |

## Copy register

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| R1 | Opens on "Your car, stolen? Post it." | Say what it is before what to do | New first slide: "Stolen cars, **on one map.**" | S | **L** |
| R2 | "People nearby get alerted." had its own slide | One concept per card, minimum cards | Absorbed: the map shows it, the sentence moves into the post slide's body — flow stays at four | S | M |
| R3 | Safety line firm and unmissable | Safety copy is the one firm register | none; and the alert stage draws **rings, not arrows**, so nothing implies approaching | — | — |

## Code hygiene found on the way (not reference-driven)

| # | Finding | Action |
|---|---|---|
| H1 | `ONBOARDING_VERSION` was still 1 | Bumped to 2 — a redesign nobody already onboarded would ever see is not worth building |
| H2 | Slide copy is pinned character-for-character in three suites | All updated in the same commit, as the tests intend |
| H3 | The ring FAB's track was `border` on the wash's darker end — 1.15:1 light, 1.19:1 dark | `borderStrong`. The ring read as a floating arc with nothing behind it, so "a quarter through" never landed — which is the control's whole job. Pre-existing |
| H4 | The 55% band was written twice, as `offset="0.55"` and `flex: 55` | One exported `ONBOARDING_WASH_HOLD`; both derive from it |
| H5 | jest-expo reports `fontScale: 2`, so the map was absent in every test | The new gate tests pin it through `Dimensions.get` — spying the hook itself does nothing, and one test had been passing for the wrong reason |

## The first draft, and why it was rebuilt

The hero was drawn once and reviewed before it shipped. The verdict was **keep
the concept, reject the execution**, and it was right on every count:

- **The field was the app’s own loading skeleton.** Five rounded grey rects at
  the top of the screen, `mapZoneFill` composing to 1.22:1. DESIGN_SYSTEM
  specifies loading as “skeleton placeholders in `surfaceSubtle`” — rounded grey
  blocks, top of screen. Anyone who had watched the feed load had already been
  taught that this shape means *not loaded yet*, which is the exact
  “unfinished” charge that killed the emoji hero. The blocks are gone; curved
  roads and pills carry the field.
- **The pins were dots, and this app bans dots.** “Never ship a price-less map
  marker… it reads as a GROUP” — learned four separate times on the real map.
  The onboarding hero was introducing the product’s map using the one marker
  the product refuses to ship. They are now the real bounty pill, which also
  quietly teaches the bounty that slide four pays off.
- **⚠️ The alert rings fired a slide late.** They were gated on the *spot*
  slide, but the absorbed sentence lives on the *post* slide — so the one screen
  whose words claimed people nearby were alerted showed a single pin and no
  alert. That mis-sync undercut the entire justification for absorbing a slide.
- **The rings reached one pin out of six.** Radii of 40 and 70 against distances
  of 49–145. The picture could not do the job the deleted sentence did.
- **Dark mode inverted the figure and ground.** Pin fill was `surface`, which in
  dark (`#1E1E1E`) is *darker* than the field it sits on (`#2F2F2F`) — a hole
  punched in a block, not a marker. The real map uses `surfaceInverse` for
  precisely this reason and the treatment had been copied without its inverting
  token.
- **⚠️ The headline was already on the image** at ordinary text sizes, because
  the map was absolutely positioned and the copy was `flex-end` in the same
  space. Nothing kept them apart; it only looked survivable because the fade
  happened to have washed the ink out that far down. This file and the README
  both state that rule as absolute, and the code broke it. They are now flex
  siblings that cannot overlap at any size on any device.
- **The 1.3× gate was `<=`,** keeping the map at exactly the scale least able to
  afford it, and hiding the map rescued nothing because the stage had no scroll
  either. Strict now, with a `ScrollView` behind it.
- **The fade shared the field’s cropped viewBox,** so on a 16:9 handset it was
  clipped with a seventh of the map still showing. It has no viewBox now.

## Outcome checklist (built 2026-08-23, rebuilt after review)

**Matched:** 4pt grid · 24 gutter · imagery top / words low · one circular
control bottom-right with Skip opposite · weight alternating mid-sentence · one
curve, one duration · reduced motion first-class · visible Skip, one concept per
card, four cards (L2, C3, T1, M2, R3).

**Adapted:** the hero is a **drawn map**, not a photograph — the language asks
for photography and we own no images, so the subject is rendered rather than
shot (C1). It is **abstract, not cartographic**: a real map means a real place,
and on first launch we have neither permission nor cause to ask. Continuity is
expressed by a hero that does not remount, which is our answer to
`OnboardingSlide`'s standing objection to per-slide artwork (M1). The register
is calm-and-factual rather than Airbnb's anticipation, because this screen has
a distressed reader as well as a curious one (R1, R3).

**Deliberately skipped:** lilac and all reference trade dress (ADR-0006) ·
photography (no assets; the layout is chosen so a photo can replace the map in
one component when there are) · a screenshot of our own UI as the hero
(Material advises against it, and it would be showing UI before anyone has
used it) · swipe (given up in August; layout animations move between settled
states and tracking a finger is a different idea) · celebration motion on the
recovery slide (M3).

**Not attempted:** Airbnb's actual first-run answer — let people look before
asking anything. Dropping straight into the feed would suit the language better
than any slideshow, but it is a product decision about activation, not a visual
one, and the owner asked for the slideshow to stay and do its job better.
