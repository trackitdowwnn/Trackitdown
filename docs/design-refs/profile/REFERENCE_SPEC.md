# Reference spec — Airbnb profile surfaces (mobile app + web passport)

WHAT: Measured reference spec of Airbnb's profile surfaces — the Profile tab
(2023-era AND the May-2025 hero-card redesign), the public profile / host
passport, and the edit-profile screen. Web-research based (no screenshots in
this folder yet); every observation carries a confidence level and is mapped
to our nearest `DESIGN_SYSTEM.md` token; proposed additions are marked **NEW**.
WHY: The profile feature (ProfileScreen, EditProfileScreen, PublicProfileSheet)
is being recomposed against this standard. This is the measurable spec that
GAP_ANALYSIS.md compares against.
LINKS: GAP_ANALYSIS.md (sibling); docs/DESIGN_SYSTEM.md;
src/features/profile/README.md.

## Sources & conventions

- **No folder screenshots** — research-only pass (owner's call, 2026-07-16).
  Confidence per item: **measured** (live DOM via getComputedStyle on
  airbnb.co.uk host profiles, July 2026 / press-asset + video-frame pixel
  measurement, ±10–15%), **reported** (teardowns, help-centre steps, release
  coverage), **inferred**.
- **Era note:** the Profile *tab* had two distinct designs. 2023–early-2025:
  borderless identity row + four titled settings groups. May 2025 redesign:
  elevated identity hero card (avatar 2×, stats column) + settings collapsed
  to an "Account settings" hub row + 3D "Lava" iconography. The public
  passport card (2023, refined since) is one continuous design.
- **Trade dress excluded by rule:** Rausch `#FF385C`, Cereal, Lava/3D icons,
  their verbatim copy. We take structure, rhythm, anatomy, motion feel.

## 1 — Profile tab

### 1a. Header

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Large left-aligned screen title ("Profile"), plain content, scrolls away (not sticky) | 2023: ~28–30pt bold · 2025: ~36pt | measured | `typography.title` (24/30) — our largest sanctioned screen-title scale |
| Title margin / title-to-content gap | ~24pt / ~24–28pt | measured | `spacing.xl` ✅ |
| Bell/notifications affordance top-right (2025: 40pt grey circle chip on its own row above the title) | — | measured | no analogue on our root — skip |

### 1b. Identity block (the era fork)

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| **2023 era:** borderless row — 48pt avatar, ~16–17pt semibold name, grey "Show profile" subtitle, chevron, hairline below; row ~64pt | — | measured | ≈ our current header row |
| **2025 era:** full-width elevated hero CARD on near-white canvas | ~345×205pt | measured | `surface` + `radii.xl` + `shadows.soft` |
| Hero card corner radius | ~22–24pt | measured | `radii.xl` (24) — NOT the default card `lg` 16; the passport is deliberately the most elevated, roundest object |
| Avatar in hero card | ~100pt circle, centred in identity half | measured | **NEW `sizes.avatarXl` 96** (avatarLg 72 too small for a hero) |
| Verified badge overlapping avatar bottom-right | ~30pt circle, white ring, brand fill, shield glyph | measured | our analogue: `colors.primary` circle + BadgeCheck for trusted spotters (derives from existing counters — no new data) |
| Name under avatar | ~26–28pt semibold, centred | measured | `typography.title` ✅ |
| Subtitle (location / "Guest") | ~15–16pt grey | measured | `typography.body` + `textSecondary` |
| **Stats column** (right half): 3 stacked stats — value over label, hairlines between rows, no chevron; whole card is the tap target → pushes full profile | value ~24pt bold / label ~13pt; rows ~38pt | measured | value `typography.title` weight at 20–24 / label `typography.caption` ✅; `colors.border` hairlines |
| Their stats: Trips · Reviews · Years on Airbnb; tenure units adapt ("1 Month hosting", never "0 years") | — | measured | ours: Sightings · Helped · Recoveries (the Reputation v1 counters) with the same adaptive-tenure idea available via `memberSinceLabel` |

### 1c. Settings rows

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| **2023 era (the richer reference for a root with few settings):** four titled groups, all flat on white — whitespace + bold section headers, no grey grouping fills | headers ~22pt bold | measured | `typography.heading` (18 SemiBold) — ours currently uses `label` 14 grey, see gaps |
| Row anatomy: leading 24pt outline icon, ~16pt regular label, trailing chevron, hairline divider BETWEEN rows | rows ~47pt | measured | `ListRow` ✅ (52pt, icon, chevron) — minus the dividers |
| Group order: Settings → Hosting → Support → Legal | — | measured | ours: Settings → Support & legal → Account ≈ same shape |
| **2025 era:** root collapsed to a sparse hub (Account settings / Get help / View profile rows ~52pt); groups moved one level deeper | — | measured | wrong translation for us — we have 3 settings rows total; a hub would bury them for nothing |

### 1d. Sign-out & destructive placement

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| "Log out": plain left-aligned **underlined** text after the last group — not red, not iconed, not in a group | ~16pt, ink | measured (2023 era; 2025 root placement unverified) | our "underline = tappable" convention fits exactly (`typography.body` underlined) |
| Version caption under log out ("Version 24.38.3 (…)") | ~12pt grey | measured | `typography.caption` + `textSecondary` (needs `expo-constants` — one-liner) |
| Log-out confirm: centred modal, plain Cancel + one filled button | — | measured | `ConfirmDialog` ✅ |
| **Account deletion is NOT on the root** — lives under Privacy and sharing, one level deep, as a captioned row | — | measured | our App-Store + "findable-but-quiet" rule: keep on root but at sign-out's quiet register (see gaps) |

### 1e. Promos (context only)

2-up "Past trips"/"Connections" feature cards and the "Become a host" banner
(3D icons, NEW stickers) — measured, **no analogue**; our root carries no
promo. The dark `PAYOUTS_ENABLED` row may some day take the quiet-banner slot.

## 2 — Public profile (passport) → our PublicProfileSheet

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Composition: passport CARD leads; photo → name → quiet role line in the left/identity column; stats stacked in a right column | card 345×230 / 395×212 (listing) | measured | `surface` + `radii.xl` + `shadows.soft` inside our BottomSheet |
| Card recipe: white, radius 24, hairline ring + ONE soft ambient shadow, on a plain page | `0 0 0 1px rgba(0,0,0,.02), 0 8px 24px rgba(0,0,0,.1)` | measured | `radii.xl` + `shadows.soft` (our soft shadow ≈ theirs) |
| Avatar | 104pt (profile page) / 88pt (listing card) | measured | sheet context → **NEW `sizes.avatarXl` 96** |
| Name | ~31.5pt w600 | measured | `typography.title` (sheet-compressed) |
| Role line ("Superhost"/"Host") | 12pt grey + 12pt glyph, LOW weight | measured | our TrustedSpotterPill already carries this slot (caption + BadgeCheck) |
| Stats: value ~2× label scale, hairlines between rows only | 22pt w600 / 10pt w500; rows ~38pt | measured | value 20–24 SemiBold / `caption` label; `colors.border` hairline |
| "Identity verified": icon + text ROW at the end of the facts list — 24pt shield-check outline + 16pt text | — | measured | ours: "Trusted spotter" as icon row (derived, inside the privacy set) |
| **Degrade by omission**: sparse profiles keep the card, drop absent sections entirely — no placeholders, no zeros; tenure units adapt | — | measured | = our ReputationCard fresh-story principle ✅ |
| Rating suppressed until ≥3 reviews ("New") | — | measured | analogue: young accounts lead with member-since, not zero counters |
| Progress/goal UI: **absent** from the public view — passports show earned trust only | — | measured (by absence) | our sheet currently shows "Next badge" progress — see gaps |

## 3 — Edit profile

| Observation | Value | Confidence | Nearest token |
|---|---|---|---|
| Entry: "Edit" text link top-right of profile; commits with "Done" | — | reported | translation: our pushed screen + Save is fine at 2 fields |
| **Avatar edit affordance rides ON the photo**: small circular camera-icon badge at the avatar's bottom-right (not a text hint) | ~32pt chip | reported/measured | `surface` circle + `colors.border` hairline (or `primary` fill) + Camera icon; replaces our "Change photo" text |
| Fields: first-person prompt rows pushing to per-field editors, each saving atomically | — | measured (help steps) | over-machinery at our 2 fields — deliberately skip |
| Account-settings identity fields: per-row Edit link, expand-in-place, per-row Save | — | measured | same verdict |
| Edit sheet (2025): full-height modal, rounded top, full-width dark "Done" pill | — | measured | our Save/Cancel buttons ≈; presentation stays a push |

## 4 — Motion & interaction

| Observation | Confidence | Ours |
|---|---|---|
| Row/card taps: horizontal push; tab switches cross-fade; no screen-level choreography on profile | measured | matches our navigation conventions ✅ |
| Passport open animation (3D book-flip, shared element) | reported | spectacle — skip; our sheet present (`motion.standard`) is the calm equivalent |
| Depth from whitespace + photography; shadows nearly absent EXCEPT the passport card, deliberately the most elevated object | measured/inferred | sanctions ONE elevated identity card per surface; everything else flat |

## 5 — Copy register

First-person fragments ("My work", "I'm obsessed with"), warm second-person
release copy, quiet role labels ("Host"). Measured. Ours translates to:
sentence-case, human, possessive-lite — "Your spotter story", "Member since
March 2026" — already the house tone; profile is a NEUTRAL space so warmth
may run higher than theft-side screens (owner's rule, 2026-07-16).

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| **NEW `sizes.avatarXl`** | 96 | hero/passport avatar (theirs 100–104); `avatarLg` 72 stays for compact headers |
| (no new radii/shadow/type) | — | `radii.xl` + `shadows.soft` + existing scale cover everything measured |
