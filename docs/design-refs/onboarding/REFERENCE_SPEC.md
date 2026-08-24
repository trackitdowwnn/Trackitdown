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
- `measured` — read off `ob1.webp`. Nothing here is measured from Airbnb.

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
| Imagery occupies the TOP and bleeds off it; words drop to the lower third | — | measured (`ob1.webp` slides 2–3) | our map takes the upper 55% |
| One circular control bottom-right, Skip bottom-left | — | measured | ✅ `OnboardingRingFab` + ghost Button |
| Headline alternates weight **mid-sentence** | — | measured | ✅ Black against Regular |
| Depth from a soft field, not cards | — | measured | ✅ `OnboardingBackdrop` |
| One shadow tier at most; depth from photography and whitespace | — | reported | ✅ none used here |

## 3 — The hero

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Photography-first is the language | — | reported | ⚠️ **we own zero image assets** — see GAP_ANALYSIS |
| The image is the subject, not decoration | — | inferred | our map is the product's subject |
| It bleeds off the frame edge rather than sitting in a box | — | measured | `slice`, no radius |
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

The safety line ("Never approach or follow a vehicle.") is the one place the
tone hardens, per `docs/SECURITY_AND_TRUST.md` — safety copy is firm and
unmissable. Nothing in the imagery may suggest travelling towards a stolen car,
which is why the alert stage draws **rings, not arrows**.

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| — | — | **None.** The map is drawn in an internal viewBox (geometry, not design tokens, on the `markGeometry.ts` precedent) and every colour it uses already exists: `mapZoneFill`, `mapZoneStroke`, `surface`, `borderStrong`, `primary`, `background`. |
