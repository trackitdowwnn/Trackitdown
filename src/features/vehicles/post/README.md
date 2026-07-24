# Post a car (the report-a-stolen-car wizard)

**Actor:** a vehicle owner (a theft victim), signed in.
**One sentence:** the multi-step wizard where an owner lists their stolen car —
car details, photos, where/when it was last seen, a bounty, and proof of
ownership — producing exactly one **draft** post that a moderator later approves.

Built on the shared wizard framework (`src/shared/wizard`). Entered full-screen
from the **bottom tab bar's centre "+" action** ("Report a stolen car") — a
route OUTSIDE the `(tabs)` group, so the tab bar is absent for the whole flow.
(A My Cars entry point can be added later; the route is `/post-a-car`.)

> **Which world are we building?** The **draft + payment-stub** world.
> `create_post` produces a post in status `draft`. The Stripe escrow charge and
> the `draft → pending_verification` transition are the payments feature's job
> (BUILD_PLAN Phase 2) and are **stubbed** here behind a clearly-marked handoff
> contract — see *Handoff* below. No real money moves in this flow yet.

## Phases & steps (Airbnb treatment — an intro screen before each phase)

**Phase 1 — Tell us about your car**

> **Plate capture is deferred (removed 2026-07-24).** The wizard no longer
> collects a number plate — `buildCreatePostParams` always sends `p_plate:
> null`, so every post is plate-less for now and make/model/colour are the
> car's identity. The `plate_available` RPC + migration remain in the backend
> for when the step is re-added; nothing in the wizard calls them today.
> Steps no longer show a helper sub-heading. The distinctive-marks step keeps
> a **"None to add"** skip: Next requires ≥1 mark, and a centred, underlined
> `StepSkipButton` (shown while the list is empty) advances marks-less.

1. **Make** — its own step (2026-07-23), the flow's first: the full-screen
   searchable make picker (`MakeStep` → `MakeField` → `SelectScreen`;
   browse-first, "Popular makes" pinned, A–Z index, type-to-add for unlisted
   makes). `create_post` requires make/model/colour.
2. **Model** — its own step (2026-07-23), **dependent on the make**:
   `ModelStep` → `ModelField` lists that make's models from the static
   `carModels` dataset (`modelsForMake`, the data-source seam), with a
   "Popular <Make> models" group and a free-text row; a make with no seeded
   models (or a free-typed make) drops to a plain free-text model input. The
   chosen make is folded into the step **title** ("Which BMW model?") via a
   dynamic `question` (a function of the answers, resolved by the framework's
   `resolveQuestion`) — no separate make chip in the body.
   **make→model dependency:** changing the make clears the model
   (`makeChangePatch` in `MakeStep`) so a model never carries across makes —
   the model step then re-gates as incomplete (review blocks submit until a
   model under the new make is chosen).
3. **Colour** — its own step (2026-07-23): a named-swatch grid (`ColourStep` →
   `ColourField`) of real UK car colours (`carColours` — DATA, token-exempt
   hexes). The stored value is the canonical NAME (a clean enum driving the
   card/detail colour text and future colour filters), never a hex. Every
   swatch shows its name (colour-blind spotters read the word — never colour
   alone). Light swatches (white/silver/gold) get a border. The escapes
   ("Multicolour / wrapped" / "Other") open a free-text note stored separately
   (`colourNote` → `owner_note`) so it never pollutes the colour enum.
4. **Year** (`YearStep`) — optional, range-bound 1900–2100.
5. **Distinctive marks** — its own step (2026-07-24): owner-authored photo +
   description evidence pairs (`DistinctiveMarksStep` → `DistinctiveFeaturesField`
   → the pure `distinctiveFeatures` model), e.g. "Cracked nearside wing mirror".
   A card list + a full-screen editor (pick photo → describe → Add); 0–8,
   optional, description required per photo (3–80, trimmed). **Gallery upload is
   allowed here** — this is the OWNER photographing their own (now-stolen) car,
   NOT spotter evidence, so the sightings camera-only rule (DOMAIN.md, ADR-0003)
   deliberately does **not** apply. Photos upload on submit (own-folder `mark-`
   namespace); each pair → a `post_distinctive_feature` row.
   **Replaced the old `vehicle_feature` chip-taxonomy step AND the free-text
   "how would someone recognise it?" prompt** (2026-07-24) — a photographed mark
   identifies a car far better than a checkbox. The `post_feature` /
   `vehicle_feature` tables + `PostDetail.features` rendering stay for OLD posts;
   `create_post` still accepts `p_feature_keys` but the wizard now sends null.
6. **Photos** — `PhotoGridPicker`, min 3 / max 6, first photo = cover.

**Phase 2 — When and where**
7. **Last seen when** — `DateTimeField`, max = now.
8. **Last seen where** — `LocationPicker` (embedded), storing point +
   `addressLabel`; the coarse grouping `lastSeenArea` is derived here.
9. **Theft context** — `stolenFrom` / `keysTaken` (structured), `descDrives`.

**Phase 3 — Bounty and verification**
10. **Bounty** — `MoneySlider` with the 95/5 + escrow/refund transparency panel.
11. **Ownership proof** — V5C via `PhotoGridPicker` single-photo mode → the
    **private** `verification-documents` bucket only.
13. **Review** — the framework's built-in review (edit-jump-return per step).
14. **Submit** — the final CTA reads "Post & pay £<bounty> bounty". This build
    calls `create_post` (draft) via the wizard's async `onComplete`; **payment
    is stubbed** (see Handoff). On success the wizard routes away to the new
    post; on failure the wizard stays fully intact for retry.

## Data & server rules

- **One RPC, `create_post` (SECURITY DEFINER)** — the single write boundary.
  Assembles the draft post + photos + feature tags + verification-doc row
  atomically and **re-validates server-side** everything the client's zod
  checked: bounty £50–£5,000, 3–6 photos, required fields, and the
  `stolen_from`/`keys_taken` enums. (It still enforces plate format +
  one-active-post-per-plate when a plate is given, but the wizard now always
  sends `p_plate: null` — plate capture is deferred.) Hard-codes
  `status = 'draft'` and `expires_at = now() + 90 days`; pins `owner_id` to the
  caller. Never advances the lifecycle (that's server-side, on escrow success).
  Migration: `20260713190000_post_a_car.sql` (+ `…191000` deny-anon).
- **Photos upload on submit, not per step** — to the **public** `post-photos`
  bucket under the owner's own folder; the V5C to the **private**
  `verification-documents` bucket. The post is created only when uploads **and**
  the (stubbed) payment succeed — no half-posts. Upload paths are stable per
  source photo so a retry overwrites rather than orphaning.
- **Distinctive marks (2026-07-24)** — owner photo+description pairs live in a
  new `post_distinctive_feature` table (`post_id, photo_url, description,
  position`), written only by `create_post` (SECURITY DEFINER), readable exactly
  when the post is (mirrors `post_photos` RLS). `create_post` gained a trailing
  `p_distinctive_features jsonb` param (`[{photo_url, description}]`; ≤8, each
  description 3–80, each photo own-folder `post-photos`) — validated + inserted
  atomically with the rest. Photos upload on submit under the `mark-` key
  namespace, in order, so the URLs zip back onto their descriptions; a per-item
  failure throws and leaves the wizard (and every pair) intact for retry.
  Migration: `20260724100000_post_distinctive_features.sql` (+ SQL verification).
  **Gallery upload is allowed** (owner's own car — see step 5 / DOMAIN.md
  ADR-0003 contrast with sightings' camera-only rule).
  **Render deferred:** `get_post_detail` does not yet return these and the
  detail-page section is unbuilt — the `PostDetail.distinctiveFeatures` type +
  parse default to `[]` (graceful absence on every post today), ready for the
  detail work to consume. Tracked in *Out of scope* below.
- **Plate availability** — the `plate_available` RPC + its migration stay in
  the backend for when plate capture is re-added, but **nothing in the wizard
  calls them today** (the plate step and its `onContinue` were removed
  2026-07-24). `create_post` still owns the real enforcement at submit.
- **Status transitions are server-only** (DOMAIN.md lifecycle).
- **Funnel logging** — per-step completion / drop-off (`[vehicles]` tag) is
  **not yet wired**; the upload + create_post calls log start/duration/failure.

## Rules & safety applied

- SECURITY_AND_TRUST §2 — nothing public before verification (draft is private
  to the owner via existing post RLS); one active post per plate (server-
  enforced, dormant while plate capture is deferred); verification docs in a
  private, own-folder bucket.
- SECURITY_AND_TRUST §6 — RLS/grants deny-by-default; status & financial columns
  server-owned; SECURITY DEFINER hardening; `create_post` denied to anon.
- DOMAIN.md — draft → pending_verification → active lifecycle; £50–£5,000 bounty;
  90-day default expiry. `stolen_from = 'driveway'` marks the last-seen point as
  the owner's home — coarsened for non-owners downstream (already handled in
  `get_post_detail`; the approve-to-active path must coarsen too).

## Exit & failure

- Exit uses the framework's dirty-check confirm — copy acknowledges the
  situation ("Your details won't be saved yet — you can start again any time.").
- Submission failure (upload or the stubbed payment) keeps the wizard alive with
  every answer intact + an inline error/retry. **Losing a completed wizard to a
  network blip is the unforgivable failure here.**

## Handoff contract (payments feature — NOT built here)

The payments feature owns the escrow charge and the lifecycle advance. Its
contract with this flow:

1. This flow calls `create_post(...)` → `{ post_id, status: 'draft' }`.
2. Payments takes the escrow charge for `bountyAmountPence` against `post_id`.
3. On escrow success, payments performs the **server-side** `draft →
   pending_verification` transition (never the client).
4. On escrow failure, the draft is left as-is (owner may retry / abandon); a
   retention job reaps abandoned drafts.

Until payments lands, step 10's submit creates the draft and shows a
clearly-marked "payment coming in Phase 2" stub — no charge is taken.

## Known security residuals (tracked — media-hardening pass)

Reviewed and accepted as LOW for this foundation pass (draft-only posts; every
post is human-moderated before it can activate):

- **Photo-URL host is anchored to `*.supabase.co`, not our exact project ref.**
  `create_post` accepts photo URLs from any Supabase project subdomain, so an
  owner with their own project could serve a "photo" from a domain they control.
  Exploitability is weak (public objects are static, CDN-cached, no per-request
  IP logging) and moderation catches a bait-and-switch. Proper fix — pin the
  project ref or move `post_photos` to path-based storage (build the public URL
  at read time, like avatars) — lands with the media-hardening pass, since it
  touches the shipped feed/detail/map read RPCs.
- **Server-side EXIF stripping** is not enforced; the client re-encode strips it
  today (see `toJpegBytes`). Cross-cutting (avatars too) — same pass.
- **V5C path validates only the first segment** (`<uid>/…`); a literal `..` in a
  later segment passes `split_part` but is not a traversal (Storage keys are
  literal). Optional `..` reject to add if the moderation reader ever
  path-normalises.
- **`plate_available` is a per-plate existence oracle** for RLS-hidden in-flight
  posts (pending_verification / recovery_claimed). Authenticated-only, exact
  plate (no enumeration across the space), short window before the post is
  public anyway — rated an acceptable Low. Optional hardening: a per-user rate
  limit on the RPC so it can't be scripted as a bulk oracle (no rate-limit infra
  exists yet — deferred). **No caller today** — the wizard's plate step was
  removed (2026-07-24); the RPC stays for when plate capture returns.

## Draft resume — NOT built (ROADMAP)

This is the flow the framework's deferred *save & exit* was designed for. A
prominent TODO + ROADMAP line track draft resume; it is **not** built now.

## Out of scope

Draft resume · editing after posting · multiple vehicles per post ·
bounty-free posting (all ROADMAP, not built).

**Follow-up — surface the colour note on the detail page.** The wrapped/other
colour note is stored (`owner_note`) and shown in the wizard review, but is NOT
yet rendered on the post detail. Surfacing it end-to-end (`get_post_detail`
selects `owner_note` → a `PostDetail` field → a `carDetails.ts` row appended to
the colour) is a small tracked follow-up so a spotter sees "matte black wrap
over silver", not just "Multicolour / wrapped".

**Follow-up — render the distinctive marks on the detail page + gallery.** The
photo+description pairs are captured and stored (`post_distinctive_feature`) but
the detail render is deferred: `get_post_detail` needs to select them (owner-vs-
public visibility is the same active-or-owner gate as `post_photos`), then a
distinctive-features section (photo + description rows) + gallery consume
`PostDetail.distinctiveFeatures` (already typed, `[]` today).

## Done means

- The wizard runs end-to-end producing a `draft` post (with photos, features,
  location, bounty, and a V5C in the private bucket) via `create_post`.
- Server-side re-validation rejects crafted bad requests (covered by the SQL
  test `supabase/tests/create_post_verification.sql`).
- Submission failure leaves the wizard intact; success routes to the post.
