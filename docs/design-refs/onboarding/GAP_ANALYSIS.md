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
- ~~**The 2026-08-08 restyle is not undone.** The ring FAB, Skip's position, the
  stepped (not swiped) transitions and the weight-contrast headlines are all
  documented decisions and all still right.~~
  ⛔ **Half true as of 2026-09-03 — see "Second pass" at the foot of this file.**
  The stepped transitions and the weight-contrast headlines stand. The ring FAB
  and Skip's position were both reversed.

## The 3 changes that close most of the gap

1. **C1 — a hero that is the product's subject.** The reference is
   photography-led; we had nothing above the words, for want of assets.
2. **R1 — a first sentence that says what the app is.** The flow opened mid-story.
3. **M1 — one thing that persists across the steps.** Continuity is what makes a
   sequence read as one story rather than four pictures.

## Layout & rhythm

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| L1 | Words low, nothing above them | Imagery top, bleeding off the frame; words lower third | Map takes 55% of the layout below the footer; the wash’s ramp begins beneath it | M | **L** |
| L2 | 24 gutter, ring bottom-right, Skip bottom-left | Same | none — already matches | — | — |
| L3 | No relationship between wash and content | Depth from one soft field | Map fades into the wash at its own lower edge; the backdrop is untouched | S | M |

## Component anatomy

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| C1 | No hero at all | A photograph, full-bleed | `OnboardingMap` — curved roads in SVG under the app's real bounty pills | L | **L** |
| C2 | — | Image is the subject | Pins ARE `MapPins`' pill: `surface` fill, `radii.full`, `borderStrong` hairline, amount in `typography.mapPin`; the focal one inverts to `surfaceInverse` and grows, as the selected pin does | S | M |
| C3 | ~~Ring FAB fuses progress + control~~ | ~~One circular control~~ | ⛔ ~~none — better than the reference, keep~~ **Reversed 2026-09-03**: split back into dots + a full-width button. "Better than the reference" was an argument from taste; the funnel said 1 completed / 6 skipped. See "Second pass" | — | — |
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
| H1 | `ONBOARDING_VERSION` | Bumped to 2, then **reverted**. Re-showing onboarding to the installed base costs a tapped push: `NotificationsHost` drops one permanently while onboarding is up, and those users have alerts configured. New users see the redesign regardless |
| H2 | Slide copy is pinned character-for-character in three suites | All updated in the same commit, as the tests intend |
| H3 | The ring FAB's track was `border` on the wash's darker end — 1.15:1 light, 1.19:1 dark | `borderStrong`. The ring read as a floating arc with nothing behind it, so "a quarter through" never landed — which is the control's whole job. Pre-existing |
| H4 | ~~The 55% band was written twice~~ — **withdrawn**: `flex: 55` never existed on `main`, the band is new in this commit. A comment and this row both asserted a duplication that had never happened | The shared `ONBOARDING_WASH_HOLD` is still right, but as a deliberate coupling of two DIFFERENT measurements (screen vs. post-footer layout), not a de-duplication |
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
- **The 1.3× gate.** The draft wrote it `<`, reasoning that at exactly 1.3 the
  headline is 52pt and needs the room. That left `DESIGN_SYSTEM` ("stops
  filling ABOVE 1.3×") wrong for one of its two consumers, so it matches
  `WizardScreen`’s `<=` now. Hiding the map also rescued nothing on its own,
  because the stage had no scroll — it has one now.
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

## Second pass — the `ob2` rebuild (2026-09-03)

Everything above is measured against `ob1.webp`. The owner then supplied
`ob2-life360-gold.jpg` and asked for the carousel rebuilt to it. Two of that
file's "matched" items were reversed as a result, so the record needs the
reversal as much as it needed the original decision.

**What forced it was the funnel, not the reference.** `onboarding_events` had
seven real runs in it: **one completed, six skipped.** With a sample that small
nothing is proven, but the direction is the one thing a first-run screen cannot
afford to guess at, and the suspect was obvious — the ring FAB asked a reader
to recognise a circle with a gap in it as the way forward, on the screen where
they know least about us.

| Was | Now | Why |
|---|---|---|
| Ring FAB (progress + control fused), full-width button on the last slide only | One full-width `Button` on every slide, label "Continue" → "Get started" | The 08-08 pass argued "Get started" should be read rather than inferred from an arrow. The same argument applies to "Continue" |
| Progress carried by the ring's arc | `OnboardingDots` above the button, hidden on the last slide | The reference has no progress at all — it is one screen, not four. Dropping the ring without replacing its signal would leave a four-step sequence with no sense of its length |
| Ghost "Skip", footer bottom-left, hidden on the last slide | `OnboardingCloseButton` — an X, top-right, over the hero, on **every** slide | Where the reference puts dismissal, and it empties the footer for the CTA. ⚠️ Kept on the last slide because an X in the opposite corner does not compete with "Get started" the way a second worded button did |
| Five bounty pins on a field | The same pins **plus a dashed sighting trail with report dots** | Owner's call: "bounty amounts, as now, plus a path." Their map is one connected picture because a line runs through it; ours had nothing for the eye to follow between the prices |

**⚠️ The X is an absolute overlay, not part of the map band**, and that is the
one placement detail worth defending in review. Above 1.3× text the hero is not
rendered at all (`displayFontScaleCap`), so a Skip nested inside it would take
the only way out of the intro with it — a reader at large type locked into four
slides. `OnboardingScreen.test.tsx` pins this at 2× explicitly.

**⚠️ The trail is the car's history, not a route to it.** `OnboardingMap`'s
standing rule is "rings, not arrows — nothing here may suggest anyone should
travel towards a stolen car". The trail obeys it by recording where the car has
BEEN SEEN, which is what a spotter's reports actually build; nothing on the map
marks the viewer, so there is no line from them to anywhere. It is dashed
because we know the points and never the journey between them — the same claim
`SightingTimeline`'s dashed uncertainty segment makes.

**Deliberately skipped from `ob2`:** its warm gradient (ADR-0006 is a
monochrome theme) and its eyebrow badge above the headline (it would reinstate
the "01 Post" step rail deleted on 2026-08-08 for restating the headline
directly below it).

**Removed:** `OnboardingRingFab` and its test, and `sizes.fab` / `fabRing` /
`fabRingGap` — the FAB was their only consumer.

## Third pass — the polish pass (2026-09-05)

The owner installed build `796296a4` fresh — the only viewing a first launch
ever gets — and flagged all four areas: the hero, spacing/rhythm, the words,
and the controls, choosing "open to structural changes" over polish-only. This
is what a screen assembled by arithmetic looks like the first time somebody
actually watches it.

**The diagnosis that held up:** since the 2026-09-04 contrast fix flattened
every hero mark to one `textSecondary` ink, the map's hierarchy had to come
from GEOMETRY — and the busiest slide (spot: two concentric rings + trail +
four dots + pills + the safety pill) was wearing the most of it. And the map's
story moved only by opacity: rings that mean "outward" arrived flat, reports
that mean "one, then another" arrived at once.

| Was | Now | Why |
|---|---|---|
| Both alert rings up through the spot slide | Inner ring on the post slide, outer REPLACES it on the spot slide | One pulse propagating outward, not a bullseye stacking under the trail. "Four stages, four pictures" still holds — by substitution rather than addition |
| Four neighbour pins (£50, £1,200, £10, "No reward") | Three — the £10 pin cut | Four amounts on the opening slide read as a price list before a price means anything, under a headline whose message is cars-not-money. The low anchor is now "No reward" + £50 |
| Trail leg 1 a ~60pt shallow wiggle beside the focal pill | Starts at (24, 258) near the fade's edge and climbs ~74 units diagonally; tangent-exact join (both slopes −0.214) | A journey needs somewhere to have come from. Clearances re-derived dense-sampled with S-segments and written into the file per its own rule |
| Everything cross-fades, nothing moves | Alert rings scale 0.85→1 with their fade (shrink back on retract); home ring settles 1.12→1; trail dots stagger in oldest-first at `motion.listStagger`/`motion.fast`, zero delay on exit | The motion rules ban SPECTACLE, not one-shot communicative movement. Same clock, same curve, `ReduceMotion.System` on delays as well as timings |
| Fade onset 0.55 | 0.62 | The early onset dissolved the band's lower third and left a long empty wash under the field on the short-copy slides. Independent of `ONBOARDING_WASH_HOLD`, which must not move |
| Slide 2: "…if you want one — it takes minutes. We'll…" | "…if you want one. We'll…" | The flow's one salesy note — a time promise a 13-step wizard then has to keep |
| Slide 4: "…the spotter is paid the reward." | "…the spotter gets the reward." | "bounty paid" sits directly above; "paid … paid" in ~15 words was the screen's one clumsy note |
| Dots hidden on the last slide | Dots on every slide | Their job is POSITION, not next-ness; "4 of 4" is the payoff of having them. The one place the 09-03 rebuild undercut itself |
| Dot row gap `xs` | `sm` | WizardProgressBar's row gap — the exact silent drift the component's own header promises the shared tokens prevent |

**Refused: a trail draw-on.** Implementable (an over-stroked mask path with
`strokeDashoffset` via `useAnimatedProps`), and refused on meaning rather than
effort: the dash exists because "we know the points, never the journey — we are
joining these up, not asserting the line." A draw-on animates exactly the
journey the dash disclaims. The events (dots) animate; the inference (line)
does not. Revisit only if the stagger still feels dead on a device.

**Untouched, deliberately:** the footer structure, full-width button and X
(funnel-protected); `ONBOARDING_WASH_HOLD` and the band's 55% (coupled, sized
for slide 3 at 1.3×); the 1.3× map gate; the pin pills' `borderStrong` edge
(recorded exception); all four headlines and the safety line; the ring/trail
colour tokens — "lighter" came from geometry, never from tokens or opacity.
