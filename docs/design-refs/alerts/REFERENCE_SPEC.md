# Reference spec — a list of standing watches, mostly empty

WHAT: The measurable target for the alerts screen: layout rhythm, card anatomy,
      the empty state, and the emotional register of the copy — each mapped to
      one of our tokens.
WHY:  Five screens had Airbnb passes and established a house skeleton; this list
      screen missed all of it, which is why it read as a different app. This
      file is the standard the redesign is measured against, so "it looks
      better" can be checked rather than asserted.
LINKS: ./GAP_ANALYSIS.md; src/features/notifications/screens/AlertsScreen.tsx;
      docs/DESIGN_SYSTEM.md; docs/design-refs/report-bug/REFERENCE_SPEC.md
      (the other no-screenshots spec this follows).

## Sources & confidence

⚠️ **NO SCREENSHOTS.** `docs/design-refs/alerts/` holds no reference images —
the owner chose to proceed on web research (2026-08-27). Every observation is
from secondary sources, and the numeric values are **community-observed, not
vendor-published**.

⚠️ **THE ANALOGUE IS WEAK, AND FOR AN UNUSUAL REASON: THE SCREEN DOES NOT
EXIST.** Airbnb ships no consumer saved-search-alerts list. Third-party products
(AlertBnB, Alertstays) exist *precisely* to fill that gap, and Airbnb's own help
centre documents only channel preferences — which notifications reach you by
push/email/SMS — not user-created rules. So there is no layout to copy at all.

| Candidate | Fit | Verdict |
|---|---|---|
| **Wishlists** | A list of user-created saved things, with a strong first-use empty state | **Closest structural twin** — its list and empty-state anatomy is what we borrowed |
| Notification settings | A toggle list | Wrong shape: ours are rules, not switches |
| Saved searches | Functionally identical | Not a consumer surface |

Confidence: **high** on grid, type hierarchy, elevation and empty-state anatomy
(all general to the design language); **low** on anything screen-specific.

Trade dress excluded by rule: Rausch `#FF385C`, Cereal, their icon set, their
verbatim copy. We take structure, rhythm, anatomy, motion feel.

Sources:
- [Airbnb design system breakdown — Superdesign (2026)](https://superdesign.dev/blog/airbnb-design-system)
- [Airbnb DLS spec — awesome-design-md](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/airbnb/DESIGN.md)
  — 4px base with a 2px micro-step; radii 8 buttons / ~14 cards / 9999 pills;
  **flat on ~95% of surfaces**; one family with weight-only hierarchy.
- [Empty state UI design — Setproduct](https://www.setproduct.com/blog/empty-state-ui-design)
  — headline → body → illustration → **exactly one** CTA; first-use states
  explain what the screen does; use a visual *native to the context*.
- [Managing your notifications — Airbnb Help Centre](https://www.airbnb.com/help/article/14)
  — the evidence that channel preferences, not saved rules, are all they ship.

## 1 — What this screen is for

| Observation | Note |
|---|---|
| Its job | Show the standing watches a user has set, and make setting the first one easy |
| Its user | A spotter volunteering to look, or an owner whose car is already gone |
| Emotional context | Civic willingness, or distress. **Not anticipation** |
| Success | An empty account leaves with one alert. A populated one can tell five apart at a glance |
| The stake | The feature README: *"the app's core loop — nobody is notified about anything until one exists"* |

### ⚠️ Emotional translation — the one place we must diverge

Airbnb's Wishlists empty state sells anticipation: *"Build the perfect trip"*,
*"Get started"*, a heart in a suitcase. Ours cannot. The owner chose **calm and
capable**, which is the register the bug-report pass settled on: *"'Help us make
Trackitdown better' asks someone irritated to feel warm about doing us a favour;
'What went wrong?' just gets on with it."*

What we keep from their empty state is its **anatomy and its job** — explain the
feature, show something native to it, offer exactly one action — not its tone.

## 2 — Layout & rhythm

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Spacing base | 4px, 2px micro-step | measured | `spacing` xs4 sm8 md12 lg16 xl24 xxl32 ✅ |
| Screen gutter | 16–24 depending on density | inferred | `spacing.xl` (24) — a settings-shaped screen ✅ |
| Between sections | 64 on web bands, tighter on mobile | measured | `spacing.xxl` (32) ✅ |
| Between cards in a set | 16 gutters | measured | `spacing.md` (12) — reads as one continuous set |
| Elevation | **Flat on ~95% of surfaces**; hairlines, not shadows | measured | `StyleSheet.hairlineWidth` + `border` ✅ NEW for this screen |
| One elevated object per surface | — | house rule | none on this page ✅ |

⚠️ **The single flat gap was the biggest structural problem.** The old screen
used one `gap: spacing.lg` for the primer, the notice, every row, the button and
the footnote alike — so nothing grouped and nothing led. This is the same gap
the report-bug pass scored **"Highest"** impact.

## 3 — The header

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Headline scale | Their h1 is 28/700; sub-heads 20–22 | measured | `typography.title` (24/30 Bold) ✅ |
| Not `display` | — | house rule | `display` is for questions, moments and hero values |
| Back affordance | Always escapable from one place | inferred | Chevron + title inline, the idiom 16 screens share |

⚠️ **The header now renders OUTSIDE the state switch.** Headers are hidden
app-wide and this is a pushed route, so the old error and signed-out branches —
a bare view with no title and no chevron — were dead ends with only the iOS
edge-swipe out. Asserted per state in the suite.

## 4 — The card

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Picture leads the card | Photography is the hero; copy restrained around it | measured | `AlertZoneThumb` at `sizes.alertThumb` (72) |
| Card radius | ~14px | measured | `radii.lg` (16) ✅ |
| Card internal padding | 16 for card meta | measured | `spacing.md` (12) — a 72pt tile is doing the work |
| Title | 16/600 | measured | `typography.cardTitle` (16 Bold) ✅ |
| Meta beneath | 14/400 muted | measured | `typography.caption` (13) + `textSecondary` ✅ |
| Secondary actions | Behind one affordance, not on the resting card | inferred | "⋯" → `BottomSheet` |

⚠️ **An alert IS a place, which is what makes the thumbnail defensible rather
than decorative.** Airbnb leads with a photograph because a listing is a room; a
zone map is the closest equivalent an alert has. Five alerts previously read as
five identical grey text blocks differing only by a ·-joined caption.

⚠️ **The thumbnail must never be load-bearing.** See `AlertZoneThumb` — the
drawn plate is the bottom layer of every tile and the map fades in over it, so
a missing API key, Expo Go, offline, web and the kill switch all resolve to the
same correct picture.

## 5 — The empty state

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Order | headline → body → illustration → one CTA | measured | `EmptyState` already has this anatomy ✅ |
| Exactly one action | "Multiple options create confusion" | measured | one `Button` |
| Illustration native to the feature | A heart in a suitcase for Wishlists | measured | `AlertZoneGlyph` — the same two marks the map draws |
| First-use copy | Explain what the screen does, then one CTA to create | measured | frequency + privacy, harvested from `AlertNudgeSheet` |
| Action weight | A vibrant, unmissable CTA | measured | **solid primary**, overriding `EmptyState`'s ghost |

⚠️ **The ghost action was the wrong default here.** `EmptyState`'s button is a
ghost by contract, so it *"invites, not shouts"* — right for an incidental empty
screen, wrong for the app's core loop having its one conversion moment. The
garage documents making exactly this override; alerts had not.

## 6 — Deliberately not adopted

| Their move | Why not |
|---|---|
| Aspirational copy ("Build the perfect trip") | Wrong register for a stolen car — see §1 |
| Rausch on the CTA | Our accent is near-black by ADR-0005; `accent` is bounty-only |
| A character illustration | The app has one other `EmptyState` illustration in ~35; a token composition avoids starting an illustration library on this screen |
| 1:1 photography in the card | An alert has no photograph. The map is the substitute, and it is 72pt, not a hero |
| A match-count preview ("would have matched N cars") | **The data does not exist.** `useAlertReach` answers an owner-side question about spotter coverage and is superseded dead code |

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| `sizes.alertThumb` | 72 | The zone tile. Matches `avatarLg` so a row of alerts and a row of people share one silhouette, and is optically the row's own text height — the picture costs the card no extra height |
| `sizes.alertGlyphRing` | 44 | The drawn zone circle inside that tile |
| `sizes.alertGlyphDot` | 10 | The point at its centre |
| `NudgeRow.gutter` | `'feed' \| 'none'` | The row hard-coded the feed's 16pt inset; inside a 24-padded scroll that lands at 40 and reads narrower than everything beside it |
| `AppMap.liteMode` | boolean | Android bitmap rendering — what makes maps-in-a-list defensible, and what answers `MapCornerMask`'s open question for this card |
| `AppMap.onReady` | callback | Fades the plate out from under a thumbnail only once tiles exist |
