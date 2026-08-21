# ADR-0016 — The brand mark: the "T" monogram

**Status:** accepted · **Date:** 2026-08-21 · **Supersedes
[ADR-0015](./ADR-0015-brand-mark.md)**

## Context

ADR-0015's concentric alert rings shipped on 2026-08-20 and were rejected by the
owner within a day: *"I do not like this logo, I want something much more
professional, eye catching."*

The verdict was right, and research says why. Apple's current guidance is to
**"avoid sharp edges and thin lines, opt for rounder corners and bolder line
weights"** — the rings were thin strokes, the exact pattern being warned
against. And because a home screen is categorised in 100–200ms with **colour as
the primary scanning cue**, a monochrome mark has little to be scanned for.

An intermediate design (a bold car silhouette on an indigo→violet gradient) was
built to address both faults, and is recorded here only because its *machinery*
survived: the signed-distance renderer that replaced the ring-era radial band
model. It was never shipped.

**The owner then supplied a finished logo** (`trackitdown-icon-pack`,
2026-08-21) and asked for it to be used as-is: a black **"T" monogram with a
baseline dot** on white. That is the decision.

## Decision

1. **Use the supplied mark exactly** — shapes, proportions and colours
   untouched. `#000000` on `#FFFFFF`, per the pack's README. Note this is
   blacker than the app's own near-black `colors.primary` (`#1A1A1A`); it is the
   designer's value and an icon is not UI, so it stands.

2. **It stays monochrome, so ADR-0006 needs no exception.** The gradient
   exception drafted for the intermediate car design was withdrawn. The one real
   fault of the rings — thin strokes — does not apply here: both bars are thick
   pills. What the mark does *not* get back is the colour scanning cue, and that
   trade was made knowingly by the owner after being shown the research.

3. **Transcribe the master SVG into geometry rather than shipping the pack's
   PNGs.** The mark is two pill bars and a circle, which the existing
   signed-distance renderer already draws. Transcribing buys four things the
   supplied PNGs cannot:
   - **Native rendering at every size** — sharper than downscaling a master, and
     it is why the 48px favicon and 24dp notification glyph stay crisp.
   - **The five assets the pack omits**: Android foreground and monochrome
     layers, the notification glyph, and both splash marks.
   - **Per-target correction** of the two faults below.
   - **The whole test suite** keeps working against it.

   `assets/brand/trackitdown-icon.svg` is committed as the master of record, and
   a test re-derives the normalisation from it so the two cannot drift apart.

   Fidelity was verified rather than assumed: rendering the transcription at the
   pack's own placement and diffing against its 1024px export gives **0.28%
   difference in ink pixels, with 95.7% of differing pixels within 2px of an
   edge** and spread across the whole perimeter — rasteriser anti-aliasing, not
   a geometry error.

4. **Two faults in the supplied pack are corrected, and only these two.**
   - **It overflowed Android's guaranteed-visible circle by 55px.** Launcher
     masks would have clipped the dot and the crossbar's corner. The pack's
     README anticipates the issue but suggests a 66% fill, which is still too
     generous: the binding constraint is not width but the **diagonal reach of
     the low-right dot**, which extends 1.272S from centre. The Android layers
     use a **0.47** fill, computed rather than guessed.
   - **Its ink sat 13px right and 19px above the canvas centre.** The geometry
     is expressed about the ink's *own* bounding-box centre, so every target
     centres it optically.

## Consequences

- **The icon is re-derivable from a vector**, and the CI gate is 15 tests. Three
  are regression tests for real faults rather than hypotheticals: the Android
  safe zone, the centring, and SVG-to-spec drift.
- **The `gradient` machinery is gone**, not left dormant — dead code that
  describes an unshipped design is worse than none.
- **Known limits, on the record:** the mark is monochrome, so it competes on
  shape alone in a colour-scanned grid; and a monogram borrows its meaning from
  brand recognition, which this product does not yet have. Both were the owner's
  call, made with the research in hand.
- **Unchanged from ADR-0015 and still true:** assets are generated from numbers
  rather than drawn; `jimp` is a PNG encoder only; anti-aliasing is analytic;
  alpha is straight with ink in every pixel; the iOS Icon Composer bundle stays
  deleted (with its tinted-variant landmine recorded there); `BrandLoader` still
  renders the wordmark as text; and `expo-notifications`' near-black `color` on
  Android's dark shade is still flagged rather than changed.
