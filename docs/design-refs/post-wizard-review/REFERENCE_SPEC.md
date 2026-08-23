# Reference spec — the final review step of a listing-creation flow

WHAT: Reference spec for the last screen of a multi-step creation flow before
the commit action, drawn from Airbnb's listing-creation flow ("Airbnb Setup")
plus general review-step research. Every observation is mapped to our nearest
`DESIGN_SYSTEM.md` token.
WHY: The posting wizard's review step (`src/shared/wizard/ReviewStep.tsx`) is
the last thing between a theft victim and a card charge. This spec is the
measurable standard `GAP_ANALYSIS.md` compares against.
LINKS: GAP_ANALYSIS.md (sibling); docs/DESIGN_SYSTEM.md;
`src/features/vehicles/post/README.md` (our flow's anatomy);
`../post-detail/REFERENCE_SPEC.md` (the sibling spec, and a stronger one — it
had screenshots).

## Sources & confidence

- ⚠️ **NO SCREENSHOTS.** Unlike `post-detail/`, which was measured from eight
  captures, this folder has none — the owner chose to proceed on web research
  (2026-08-22). **Every dp value below is inferred from published design-system
  teardowns, not measured from the product.** Treat structural claims as solid
  and numeric ones as directional.
- **Secondary:** design-system teardowns —
  ([Superdesign breakdown](https://superdesign.dev/blog/airbnb-design-system)),
  flow documentation
  ([Mobbin's listing flow](https://mobbin.com/explore/flows/b5ea8e47-40c6-4adf-bcea-d07703bebcdf)),
  and review-step research
  ([Baymard on checkout flow UX](https://baymard.com/learn/checkout-flow-ux-optimization)).
- **The analogue is strong but not a twin.** Airbnb's flow ends with a review
  that previews the listing, then Publish. Ours ends with a review that
  previews the listing, then a **payment**. The extra weight on money is ours;
  nothing in the reference covers it, so §5 leans on payment-UX research rather
  than Airbnb.

## 1 — What this screen is for

| Observation | Note |
|---|---|
| It is the **payoff**, not a form | The reference shows the host their listing as guests will see it — the work made visible |
| One vertical scroll | No tabs, no accordion; everything visible by scrolling |
| **One primary action** | Teardowns are explicit: "reserve the red for the single primary action only" |
| Per-section edit that JUMPS | Baymard: users catch errors here, and must be able to fix one without walking back through every preceding step |
| Progress still shown | Baymard across 100+ studies: progress indication reduces abandonment |

### ⚠️ Emotional translation — the one place we must diverge

The reference sells **anticipation**: a host is about to earn, and the preview
is a small moment of pride. **Ours is reached by someone whose car was stolen
hours ago.** The same pattern must carry a different sentence — not *"look what
you've made"* but *"would a stranger recognise this car?"*

Consequences, binding on our implementation:
- No celebration copy, no `springBouncy` (our motion doc reserves it for
  success/reward — the post-payment moment, not this one).
- The preview's caption must describe **recognition**, never outcome. Nothing
  we ship may imply photos or a bounty affect whether a car is **recovered**;
  we measure reach, not recovery.
- Warmth is not the register. Competence is.

## 2 — Layout & rhythm

| Observation | Reference | Nearest token |
|---|---|---|
| Base grid | 4pt | our scale is 4/8/12/16/24/32/48 ✅ |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48, 64 | ✅ to 48; we have no 64 |
| Content gutter | 24dp, a text/form screen | `spacing.xl` ✅ (`DESIGN_SYSTEM.md` — the 16 gutter is an image-led-feed exception) |
| Section rhythm | divider → ~32dp → title → ~16dp → content | `spacing.xxl` / `spacing.lg`; our `PostDetailBody` already does this |
| Section separator | full-width hairline, light grey | `StyleSheet.hairlineWidth` + `colors.border` ✅ |
| Depth | **one shadow tier at most**; depth from photography and whitespace, not shadows | `shadows.soft` ✅ — and prefer none |

## 3 — The preview

| Observation | Reference | Nearest token |
|---|---|---|
| The listing appears **as the audience sees it** | a card: photo, title, price | — |
| Photo leads | full-bleed within a rounded frame | `radii.lg` (16), inside the 12–20 the teardowns report |
| Card construction | rounded photo, **no border and no shadow** | ✅ our `VehicleCard` is deliberately borderless |
| Identity over/under the photo | title + one supporting line | `sectionTitle` + `label` |
| An edit affordance on the preview | jumps to the photos step | `typography.label`, underlined (our "underline = tappable" rule) |

**Our adaptation:** a 4:5 portrait hero rather than the browsing card's 4:3,
matching `VehicleSummaryStep`'s existing confirmation-moment decision. Because
that is *not* the feed card, **the copy must not claim it is** — say what
spotters go on, never "this is exactly what spotters see".

## 4 — The answer list

| Observation | Reference | Nearest token |
|---|---|---|
| Grouped by the flow's own phases | headings match the steps taken | `typography.heading` (18) |
| Label over value | quiet label, ink value | `caption`/`textSecondary` over `body`/`textPrimary` ✅ |
| Row height | generous; a tap target, not a table row | `spacing.md` vertical min; 44pt on the control |
| Edit per row | text link, right-aligned | ✅ ours, plus `sizes.touchTarget` |
| Missing answers | named, not merely disabled | `colors.danger`, sparingly |

## 5 — The commit (ours, not the reference's)

Airbnb's Publish costs nothing, so the reference is silent here. From payment-UX
research: state the sum, state what happens to it, avoid clutter, and never let
the person discover a charge later than this screen.

| Rule | Ours |
|---|---|
| The sum appears **on the screen**, not only in the button | `typography.title` + `accentText` |
| One honest line on what happens to the money | `caption`/`textSecondary` |
| Every figure comes from the single source | `estimateRefundPence`, `LISTING_FEE_PENCE` — its own doc makes this binding |
| Display only | the charge is server-read from the post's price column |

## 6 — Deliberately not adopted

| Reference behaviour | Why not |
|---|---|
| Rausch coral on the primary CTA | ADR-0006: monochrome near-black since 2026-07-24. Value reads via weight and fill, not hue |
| Airbnb Cereal | We use Satoshi. Weight-only hierarchy in one family is the transferable idea; the typeface is trade dress |
| 3D/skeuomorphic iconography (2025 refresh) | lucide, flat, monochrome — a house decision unaffected by this screen |
| A post-publish "what's next" screen | We route straight to the live listing. Worth revisiting; a separate decision |
| Rendering the true feed card as the preview | Needs an answers→`PostSummary` adapter. Considered and deferred 2026-08-22 |
