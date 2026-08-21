# ADR-0015 — The brand mark: concentric alert rings

**Status:** ~~accepted~~ **SUPERSEDED by
[ADR-0016](./ADR-0016-brand-mark-v2.md)** (2026-08-21) · **Date:** 2026-08-20 ·
First visual identity; closes the two `TODO(art)` markers' *asset* half and the
missing notification icon

> **The MARK described here was rejected within a day** and replaced by a bold
> car silhouette on an indigo→violet gradient. In short: it was thin strokes in
> black on white, and a home screen is scanned by COLOUR before shape, so it had
> nothing to be scanned for. Apple's own current guidance is to avoid thin lines
> and pure black/white backgrounds. ADR-0016 has the full reasoning.
>
> **What survives, and is still the live design:** everything below about the
> PIPELINE — assets generated from numbers rather than drawn, `jimp` as a PNG
> encoder only, analytic anti-aliasing, straight alpha with ink in every pixel,
> native rendering per target with no downsampling, the Android safe zone, the
> deleted iOS Icon Composer bundle (including its tinted-variant landmine), and
> the CI gate. ADR-0016 changed the mark and the renderer's shape primitives;
> it kept all of this.

## Context

Every launcher asset in the repo was still Expo's boilerplate — a blue `#007AFF`
chevron on pale blue. `git log -- assets/` confirms none had ever been touched.
That contradicted the documented identity on every axis: `docs/DESIGN_SYSTEM.md`
specifies **monochrome, near-black `#1A1A1A`, calm, "never alarmist, never
police-app dark-and-red"**.

Two things surfaced in the audit that shaped the work more than the design did:

1. `app.json` set `"ios": { "icon": "./assets/expo.icon" }` — an Apple Icon
   Composer bundle that **overrides the top-level icon on iOS entirely**.
   Replacing `icon.png` alone would have left every iPhone showing the Expo
   chevron, and nothing would have caught it until a device build.
2. **The light-mode splash was invisible.** `splash-icon.png` was pure white
   (measured `rgb(255,255,255)` across its opaque pixels) on a `#F7F7F7`
   background — a **1.03:1 contrast ratio**. It had presumably always been so.

## Decision

1. **The mark is concentric "alert rings"** — a solid centre with rings
   radiating out — in near-black on white. It is the alert-radius circle the map
   already draws (`mapZoneFill` / `mapZoneStroke`), so the icon depicts *what the
   app does* rather than being another car silhouette. Rejected: a car
   head-on (every car app on the store is a car silhouette, and it collapses to
   a blob with two dots at 48px), and a "T" monogram (a monogram borrows all its
   meaning from brand recognition we do not have yet).

2. **Two rings, not three.** Android's adaptive icon is a 108dp canvas whose
   guaranteed-visible region is a 66dp circle — **61.1%** — because launchers
   translate the foreground during parallax. At a 48dp launcher cell that leaves
   a **29.3dp** circle: a radial budget of 14.65dp. A dot plus three rings spends
   it on seven alternating bands, putting every element on the 1.5–2.0dp
   legibility floor simultaneously and shrinking the centre to a ~5dp speck.
   Seven bands across 4.6mm is texture, not structure. Two rings plus a generous
   dot is not a dilution: concentricity is what carries "radiating", and
   **strokes thinning outward with gaps widening outward** reads as a wave losing
   energy — which three identical rings could never have said.

3. **One geometry, two composite scales.** The mark is defined once in
   normalised units and placed at **60.2%** of the Android foreground (inside the
   crop) and **70.3%** of the iOS/web square (no crop). Same shape everywhere; no
   third ring on iOS just because it fits.

4. **One declared exception.** At Android's 24dp status bar the outer ring falls
   to ~1.4dp, so the **notification glyph alone** uses a reduced mark — centre
   plus one ring. Simplifying at small sizes is what Apple and Google both do;
   what matters is that it is bounded to one asset and enforced by a test.

5. **The assets are generated, not drawn.** `scripts/brand/markSpec.mjs` holds
   the geometry; `renderMark.mjs` rasterises it; `generate-brand-assets.mjs`
   writes the PNGs (`npm run assets:brand`). The mark is five circles — its
   "artwork" is five numbers — so a binary would have been a worse source of
   truth than the numbers themselves.

6. **`jimp-compact` as a PNG encoder only; all drawing is our own maths.**
   Rejected `sharp`: it is a native module whose prebuilds come from a separate
   CDN, which is exactly what breaks behind the corporate TLS interception this
   repo already works around, and its bundled rasteriser changes output between
   versions so the assets would stop being reproducible. An SVG source of truth
   buys nothing for five circles.

   **Anti-aliasing is analytic, not supersampled** — a 1px linear ramp on each
   band edge. 4× SSAA gives only 17 discrete alpha levels and stair-steps on
   shallow curves; this gives full 8-bit AA at 1× the cost, and degrades
   honestly: a sub-pixel stroke attenuates to grey rather than dropping out.

7. **Deleted `assets/expo.icon/` and the `ios.icon` key.** Authoring a
   replacement Icon Composer bundle would unlock iOS 18/26 light/dark/tinted, and
   the format is text — but it is sparsely documented, `actool` compiles it
   *inside an EAS build*, and with `ios/` being gitignored CNG and no Mac here
   there is no way to validate it locally. Bad risk profile. The supported route
   (`ios.icon: { light, dark, tinted }`) stays available and the same script can
   emit it.

   ⚠️ **Landmine for whoever does that**: prebuild forces `removeTransparency`
   and a white background on the **tinted** variant, so an alpha-based tinted
   asset gets flattened and disappears. Ship `light` + `dark` only and let iOS
   derive `tinted` — which a near-black mark on white does cleanly, and which is
   why deleting the key is safe today.

## Consequences

- **The icon is re-tunable by editing a radius.** Three numbers and
  `npm run assets:brand`.
- **Six tests gate it in CI**, and two of them cover failures nothing else can
  see: ink escaping Android's safe zone (clipped only on *other people's*
  phones) and a committed PNG drifting from the geometry. The staleness check
  compares **decoded pixels, never file bytes** — zlib output is not stable
  across Node versions, and CI runs Node 20 against a local Node 24.
- **The splash is fixed as a side effect**, with per-mode assets. Background
  colours are untouched: `#F7F7F7` / `#141414` are exactly `colors.background` /
  `darkColors.background`, and `BrandSplash.tsx` documents that the invisible
  handover from the OS splash depends on that.
- **Known softening, on the record**: at iOS's 20pt notification tray the outer
  ring reaches ~1.10px, and a browser downscaling the 48px favicon to a 16px tab
  does the same. Both are declared rather than designed around; a 16px
  reduced-mark favicon is a follow-up (`web.favicon` takes one path, so it needs
  a hand-written `<link>`).
- **Not done, deliberately**: `BrandLoader.tsx` still renders the wordmark as
  literal `<Text>`. Putting the mark there is a design decision about an in-app
  loading identity, not an asset swap, and it interacts with the
  one-view-per-character shimmer and the reduced-motion branch. The markers now
  say so instead of implying a swap.
- **Flagged, not changed**: `expo-notifications`' `color: '#1A1A1A'` is the
  accent Android applies behind the small icon, and near-black on the dark
  notification shade is close to invisible. Pre-existing; a behaviour change does
  not belong inside an asset change.
