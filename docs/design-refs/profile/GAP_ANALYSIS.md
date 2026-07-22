# Gap analysis — our profile surfaces vs the Airbnb reference spec

WHAT: Every divergence between our profile feature (ProfileScreen,
EditProfileScreen, PublicProfileSheet) and REFERENCE_SPEC.md, grouped per the
/airbnb-redesign phases, each with current → reference → proposal, effort
(S/M/L) and visual impact.
WHY: The decision sheet for the redesign — options and the build trace back
to lines here.
LINKS: REFERENCE_SPEC.md (sibling); src/features/profile/README.md.

Hard boundaries honoured throughout (owner, 2026-07-16): PublicProfileSheet's
privacy absence test is untouchable; delete-account stays findable-but-quiet
with its blocked-by-escrow behaviour; dev section stays __DEV__-gated and out
of the way; our tokens, never their coral.

## Layout & rhythm

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| L1 | No screen title — the identity row IS the top | Large scroll-away title above everything ("Profile") | Add `typography.title` "Profile" heading | S | M |
| L2 | Identity = borderless row (2023-era shape) | 2025: elevated identity hero card, `radii.xl`, soft shadow, avatar ~2× | Promote identity to a hero card with `avatarXl` + stats column (composition decision — see options) | M | **L** |
| L3 | Sections separated by bare `spacing.xl` gaps only | Whitespace + clear section headers + hairline dividers between rows | Add hairline dividers inside groups; bump section-header scale (T1) | S | M |
| L4 | Reputation sits as a second full card directly under identity | Their stats live INSIDE the identity card; no second trust card on the root | Fold the three counters into the hero card's stats column; ReputationCard's story/badges/goal moves behind a push ("Your spotter story") or stays as-is (composition decision) | M | **L** |

## Component anatomy

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| C1 | Avatar `avatarLg` 72 in a left-aligned row | ~100pt centred hero avatar with trust badge overlapping bottom-right | `avatarXl` 96 centred; trusted-spotter BadgeCheck chip on the avatar (derives from existing counters) | S–M | **L** |
| C2 | TrustedSpotterPill beside the name | Quiet role line under name; "verified" as an icon row / avatar badge | Keep the pill OR move trust to the avatar badge + quiet caption — per composition | S | M |
| C3 | Sign out = icon ListRow in an "Account" group | Underlined plain-text "Log out" after the last group, version caption under it | Restyle sign-out as underlined text row + add version caption (`expo-constants`); delete-account stays a quiet destructive row near it (our App-Store rule beats their bury-it-deep) | S | M |
| C4 | EditProfile avatar affordance = "Change photo" text hint under the photo | Camera-icon chip riding the avatar's bottom-right | Adopt the camera chip (shared pattern with C1 badge geometry) | S | M |
| C5 | PublicProfileSheet = centred stack: md avatar, name, pill, since, then the FULL ReputationCard (incl. "Next badge" progress) | Passport card: identity + stacked stat column, hairlines, trust as icon row; **no goal/progress UI in public view**; degrade by omission | Recompose sheet as passport anatomy from the permitted five fields; drop the progress bar from the PUBLIC sheet (shows less, never more — privacy test unaffected) | M | **L** |

## Typography & hierarchy

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| T1 | Section titles `label` 14 Medium grey | ~22pt bold headers carrying the page rhythm | `typography.heading` 18 SemiBold ink for group headers | S | M |
| T2 | Stat presentation is narrative-only (highlight lines) | Big-number-over-caption stat rows, value ≈ 2× label | New StatColumn/StatRow pattern at `title`-weight value + `caption` label (used by hero card and public sheet) | M | **L** |

## Interaction & motion

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| M1 | Identity row pushes /edit-profile directly | Whole identity card pushes the (view) profile; Edit lives inside | If hero-card composition wins: card → keeps pushing edit (we have no separate "view own profile" page — deliberate simplification) | — | note |
| M2 | ReputationCard animates fade-rise + bar fill | Profile surfaces are motion-quiet; passports save motion for one moment | Keep card entrance; if the sheet drops the progress bar its motion goes with it | S | S |

## States

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| S1 | Fresh accounts: warm invitation line in ReputationCard ✅ | Degrade by omission; never zeros; tenure-adaptive units | Already aligned — extend the principle to the hero stats column (young account → member-since leads, no zero stats) | S | M |
| S2 | Guest state: EmptyState invitation ✅ | n/a (login-walled) | Keep | — | — |

## Copy register

| # | Current | Reference | Proposal | Effort | Impact |
|---|---|---|---|---|---|
| R1 | "Reputation" section title | Warm, possessive, human ("Your…") | "Your spotter story" where the narrative card lands | S | S |

## Code hygiene found on the way (not Airbnb-driven)

| # | Item | Effort |
|---|---|---|
| H1 | TrustedSpotterPill comments still say "sage" twice — palette is orange since ADR-0005 | S |

## Outcome checklist (built 2026-07-16, composition B)

**Matched** (reference pattern adopted as measured):
- Identity hero card: `radii.xl` + soft shadow, the one elevated object;
  `avatarXl` 96; name + member-since in the identity half; whole card = tap
  target, no chevron (L2, C1, M1).
- Counters as a stacked value-over-caption stat column with hairlines
  between rows only, inside the hero and the public sheet (L4, T2).
- Trust badge riding the avatar's bottom-right with a white ring (C1);
  camera chip riding the edit avatar the same way (C4).
- Section rhythm: heading-scale ink group titles + hairline dividers between
  rows (L3, T1).
- Sign-out as quiet underlined text + version caption; log-in/out wording
  unified ("Log out") (C3).
- Degrade by omission everywhere: zero counters → no stat rows, fresh
  passports are identity-only (S1).
- Public passport shows EARNED trust only — no goal/progress UI (C5).

**Adapted** (their pattern, our translation — with reasons):
- Delete account stays on the ROOT (quiet, muted danger) instead of buried
  one level deep — App-Store findability rule beats their placement (C3).
- Settings stay grouped-and-flat (2023-era anatomy) rather than the 2025
  hub row — we have three settings rows; a hub would bury them (§1c).
- Hero shows FIRST NAME only (passport-style); display name lives on the
  edit screen instead of beside the name (C2).
- Public sheet drops the highlight sentences — the stat column already
  tells those numbers; emblems stay as the earned-trust stamps (C5).
- Trust marker on the public sheet stays the TrustedSpotterPill (their
  quiet role-line slot) — owners need the explanatory wording (C2).
- "Your spotter story" push row instead of their profile-completion promos;
  goal/progress lives there, own-view only (L4).

**Deliberately skipped** (with reasons):
- 3D/Lava icon language, book-flip passport animation — trade dress and
  spectacle; our motion system stays calm (hard rule).
- Bell/notification chip in the header — no root notification surface here.
- Past trips / Connections social cards — no analogue; new scope if ever.
- Per-field push editors + nav Edit/Done on edit-profile — over-machinery
  for two fields (§3).
- White canvas — our warmer `background`/`surface` split is a deliberate
  palette decision (ADR-0005).

## The 3 changes that close most of the gap

1. **L2+L4+T2** — the identity hero card with the counters as its stats
   column (the 2025 anatomy, which happens to promote our trust economy).
2. **C5** — the PublicProfileSheet recomposed as passport anatomy (identity +
   stat column, no public progress bar): the owner's trust-decision moment
   gains the most per point of effort.
3. **L3+T1+C3** — section rhythm: heading-scale group titles, hairline
   dividers, quiet underlined sign-out + version caption.
