# Reference spec — a first-run intro sequence

WHAT: Reference spec for the app's first-launch slideshow. Unusually among the
specs in this folder, **the reference is not an Airbnb screen** — Airbnb has no
first-run slideshow at all. What is specified here is their design *language*
plus the general research on intro carousels, and the one Airbnb sequence that
is structurally analogous.
WHY: `OnboardingScreen` is the only chance to explain an unusual product to
someone who has never heard of it. This spec is the measurable standard
`GAP_ANALYSIS.md` compares against.
LINKS: GAP_ANALYSIS.md (sibling); docs/DESIGN_SYSTEM.md;
`src/features/auth/README.md` § "Onboarding (first slice)" — which is the real
decision record and predates this file.

## Sources & conventions

**Confidence vocabulary**, per item:
- `reported` — stated in published design-system teardowns or UX research.
- `inferred` — deduced from the reference image or from Airbnb's language
  applied to a screen they do not have. Treat numbers as directional.
- `measured` — read off `ob1.webp` or `ob2-life360-gold.jpg`. Nothing here is
  measured from Airbnb.

⚠️ **A SECOND REFERENCE LANDED 2026-09-03**: `ob2-life360-gold.jpg`, a Life360
Gold upsell, supplied by the owner. It is not an Airbnb screen either, and it
disagrees with `ob1.webp` about the footer. Where they conflict, **`ob2` wins for
the footer and the hero's connective tissue**, and §6 records why; everything
else in this file is still measured against `ob1`. Rows superseded by it are
struck through rather than deleted, so a reader can tell a reversal from a gap.

⚠️ **The analogue is WEAK, and the command that produced this file says to say
so.** Airbnb's answer to first-run is to let you *shop before registering* —
splash straight into search, no intro carousel. The nearest sequence that
exists is **Airbnb Setup's three host intros** ("Tell us about your place" /
"Make your place stand out" / "Finish up and publish"), each a headline, a
supporting line and an illustration. Our post wizard already copies that
pattern; this screen borrows its anatomy at one remove.

⚠️ **The image in this folder is not Airbnb.** `ob1.webp` is a concept for a
book-summaries app — lilac, three artboards. It is what the 2026-08-08 restyle
was built against and it is a legitimate reference for *onboarding anatomy*; it
is not a reference for Airbnb.

**Trade dress excluded by rule:** their Rausch `#FF385C`, Cereal, the 2025 3D
iconography, and verbatim copy. The reference image's lilac and its 📖 emoji are
excluded on the same basis. We take structure, rhythm, anatomy, motion feel.

**Secondary sources:** design-system teardowns
([Superdesign](https://superdesign.dev/blog/airbnb-design-system)); NN/G on
[mobile-app onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/)
and [skipping it where possible](https://www.nngroup.com/videos/onboarding-skip-it-when-possible/);
[Material Design on onboarding](https://m2.material.io/design/communication/onboarding.html).

## 1 — Whether this screen should exist at all

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Airbnb ships no first-run carousel | — | reported | — |
| NN/G does not recommend deck-of-cards intros: they "make interfaces appear more complicated than they are" | — | reported | — |
| Where one exists: **highly visible Skip**, minimum cards, **one concept per card** | — | reported | ✅ all three today |
| Benefits-oriented suits easy apps; **function-oriented suits complex or unusual ones** | — | reported | ours is unusual → the loop is the right content |
| Material: "Don't show app UI if users haven't experienced it yet. Show the user benefit first." | — | reported | ⚠️ binds the hero: a map of the SUBJECT is fine, a screenshot of our UI is not |

**Our conclusion:** the slideshow earns its place — nobody knows what a stolen-car
noticeboard with bounties is — but it must stay short, skippable, and lead with
what the thing *is*.

## 2 — Layout & rhythm

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Base grid | 4pt | reported | ✅ 4/8/12/16/24/32/48 |
| Screen gutter | 24 | reported | `spacing.xl` ✅ |
| Imagery occupies the TOP and bleeds off it; words drop to the lower third | — | measured (`ob1.webp` slides 2–3) | our map takes 55% of the layout below the footer |
| ~~One circular control bottom-right, Skip bottom-left~~ | — | measured (`ob1`) | ⛔ **superseded 2026-09-03** — see §6 |
| Full-width pill CTA at the foot, dismissal as an X over the hero | — | measured (`ob2`) | ✅ `Button` + `OnboardingCloseButton` |
| Headline alternates weight **mid-sentence** | — | measured | ✅ Black against Regular |
| Depth from a soft field, not cards | — | measured | ✅ `OnboardingBackdrop` |
| One shadow tier at most; depth from photography and whitespace | — | reported | ⚠️ **two tiers, both argued**: `shadows.soft` on the map pins (MapPins' anatomy, copied wholesale) and `shadows.lifted` on the close button, which shadows.ts sanctions for chrome floating over media. ⚠️ Neither carries an edge on its own — `lifted` casts black and is nothing on dark, so the close button also has a hairline |

## 3 — The hero

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Photography-first is the language | — | reported | ⚠️ **we own zero image assets** — see GAP_ANALYSIS |
| The image is the subject, not decoration | — | inferred | our map is the product's subject |
| It bleeds off the frame edge rather than sitting in a box | — | measured | `preserveAspectRatio="none"`, no radius — it stretches rather than cropping, which is the right trade for abstract curves |
| Text never fights the image for the same pixels | — | inferred | words sit below on `background` |
| Small text over a photo needs an opaque backing, not a 45% scrim | ~3.4:1 measured in-house 2026-08-23 | measured | `surfaceOverMedia`, never `mediaScrim` |

## 4 — Motion & interaction

| Observation | Confidence | Ours |
|---|---|---|
| "Calm and continuity-focused, never spectacle" | reported | `motion.standard` 250 + `easeOut` throughout |
| One deceleration curve, no ad-hoc mixing | reported | ✅ `easeOut` is the only curve on this screen |
| Reduced motion is part of the system | reported | ✅ `ReduceMotion.System` on every animation |
| Continuity across steps — something persists so the sequence is one thing | inferred | the map does not remount; only the words step |
| Celebration reserved for genuine reward | reported | ⚠️ **no `springBouncy` here** — a 🎉 on the recovery slide was removed in August for exactly this |

## 5 — Copy register

Airbnb writes for anticipation. **This screen has two readers at once**: someone
idly curious, and someone whose car was stolen an hour ago. The register that
serves both is *calm and factual* — neither cheerful nor grave. Sentence case,
plain English, short.

The safety line is the one place the
tone hardens, per `docs/SECURITY_AND_TRUST.md` — safety copy is firm and
unmissable. Nothing in the imagery may suggest travelling towards a stolen car,
which is why the alert stage draws **rings, not arrows**.

## 6 — What the `ob2` reference adds (2026-09-03)

Measured off `ob2-life360-gold.jpg`.

| Observation | Confidence | What we did |
|---|---|---|
| Footer is a single full-width pill CTA, nothing beside it | measured | ✅ one `Button` on every slide, label changing "Continue" → "Get started" |
| Dismissal is an X on a rounded SQUARE, top-right, floating over the hero | measured | ✅ `OnboardingCloseButton` — square, because every other floating element there is a pill and the difference separates chrome from content |
| That X is white with a black glyph | measured | ⚠️ **inverted deliberately**: `surfaceOverMedia` + `textOnMedia`, the pairing this app already uses for chrome over media. A white chip would be darker than the field in our dark scheme — a hole, not a button |
| The map is one connected picture: a trail with waypoints, not scattered markers | measured | ✅ the sighting trail — dashed run + report dots, in two legs |
| No progress indicator of any kind | measured | ⚠️ **we add one.** Theirs is a single upsell screen; ours is one of four, and the ring it replaced carried that signal |
| Warm gradient behind the hero; eyebrow badge above the headline | measured | ⛔ **skipped.** ADR-0006 is a monochrome theme, and an eyebrow would reinstate the step rail deleted on 2026-08-08 for restating the headline |

⚠️ **Why `ob2` beat `ob1` on the footer**: the funnel, not taste. Seven real
runs — **one completed, six skipped**. The ring FAB asked a first-time reader to
recognise a circle-with-a-gap as the way forward on the screen where they know
least about us.

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| `sizes.onboardingTrailDot` / `…DotRing` | 8 / 2 | The trail's report dots and the field-coloured ring that punches the dash out from under each one. Own tokens rather than `timelineDot`/`timelineDotRing`: those are the sighting timeline's LIST geometry, sized against a 24px rail beside text. Same meaning, different constraint. |
| `sizes.onboardingTrailStroke` / `…Dash` / `…Gap` | 2 / 6 / 5 | The trail's weight and dash rhythm, in the field's viewBox units. |
| `sizes.onboardingRingStroke` | 1.5 | The alert and home rings' weight, previously a bare literal written twice in the file that minted every other number here. Lighter than the trail on purpose: the rings are a moment, the trail is the record. |
| — | — | Nothing else. The map is drawn in an internal viewBox (geometry, not design tokens, on the `markGeometry.ts` precedent) and every colour it uses already exists: `surfaceSubtle` (the land and the dot rings), `mapZoneStroke` (roads), `surface` (pin fills), `textSecondary` (the trail, the rings and the resting dots), `surfaceInverse` (the posted car and the report dots) and `background` (the fade). |

⚠️ **`borderStrong` is NOT the graphic token on this screen, and that is a
correction.** It is the app's 3:1 floor token, but `colors.test.ts` only ever
asserts it against `background` and `surface`. Almost everything drawn here
stands on `surfaceSubtle` — one step further down — where it measures **2.79:1
light / 2.81:1 dark** and misses the floor in both schemes. CI could not see it.
`textSecondary` clears it at 4.66:1 / 5.69:1, which is the finding
`ChoiceChipsMulti`'s swatch ring already records with the same two ratios.

**Removed by the same pass:** `sizes.fab`, `fabRing`, `fabRingGap` — the ring
FAB was their only consumer.
