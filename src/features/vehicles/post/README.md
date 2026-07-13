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
1. **Plate** → DVLA lookup on continue. DVLA is **stubbed** this build: the
   step's `onContinue` runs a format/uniqueness check only (no external call),
   and the manual make/model/colour/year path is the one we ship. An existing
   *active* post for the plate blocks (one active post per plate).
2. **Distinguishing features** — the `vehicle_feature` taxonomy via
   `ChoiceChipsMulti`, plus a guided prompt ("How would someone recognise it at
   a glance?" → `descRecognise`).
3. **Photos** — `PhotoGridPicker`, min 3 / max 6, first photo = cover.

**Phase 2 — When and where**
4. **Last seen when** — `DateTimeField`, max = now.
5. **Last seen where** — `LocationPicker` (embedded), storing point +
   `addressLabel`; the coarse grouping `lastSeenArea` is derived here.
6. **Theft context** — `stolenFrom` / `keysTaken` (structured), `descDrives`.

**Phase 3 — Bounty and verification**
7. **Bounty** — `MoneySlider` with the 95/5 + escrow/refund transparency panel.
8. **Ownership proof** — V5C via `PhotoGridPicker` single-photo mode → the
   **private** `verification-documents` bucket only.
9. **Review** — the framework's built-in review (edit-jump-return per step).
10. **Submit** — the final CTA reads "Post & pay £<bounty> bounty". This build
    calls `create_post` (draft) via the wizard's async `onComplete`; **payment
    is stubbed** (see Handoff). On success the wizard routes away to the new
    post; on failure the wizard stays fully intact for retry.

## Data & server rules

- **One RPC, `create_post` (SECURITY DEFINER)** — the single write boundary.
  Assembles the draft post + photos + feature tags + verification-doc row
  atomically and **re-validates server-side** everything the client's zod
  checked: plate format, one-active-post-per-plate, bounty £50–£5,000, 3–6
  photos, required fields, and the `stolen_from`/`keys_taken` enums. Hard-codes
  `status = 'draft'` and `expires_at = now() + 90 days`; pins `owner_id` to the
  caller. Never advances the lifecycle (that's server-side, on escrow success).
  Migration: `20260713190000_post_a_car.sql` (+ `…191000` deny-anon).
- **Photos upload on submit, not per step** — to the **public** `post-photos`
  bucket under the owner's own folder; the V5C to the **private**
  `verification-documents` bucket. The post is created only when uploads **and**
  the (stubbed) payment succeed — no half-posts. Upload paths are stable per
  source photo so a retry overwrites rather than orphaning.
- **Plate availability** — the plate step's `onContinue` calls the
  `plate_available` RPC for early feedback; `create_post` re-checks at submit.
- **Status transitions are server-only** (DOMAIN.md lifecycle).
- **Funnel logging** — per-step completion / drop-off (`[vehicles]` tag) is
  **not yet wired**; the upload + create_post calls log start/duration/failure.

## Rules & safety applied

- SECURITY_AND_TRUST §2 — nothing public before verification (draft is private
  to the owner via existing post RLS); one active post per plate; verification
  docs in a private, own-folder bucket.
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
  exists yet — deferred).

## Draft resume — NOT built (ROADMAP)

This is the flow the framework's deferred *save & exit* was designed for. A
prominent TODO + ROADMAP line track draft resume; it is **not** built now.

## Out of scope

Draft resume · editing after posting · multiple vehicles per post ·
bounty-free posting (all ROADMAP, not built).

## Done means

- The wizard runs end-to-end producing a `draft` post (with photos, features,
  location, bounty, and a V5C in the private bucket) via `create_post`.
- Server-side re-validation rejects crafted bad requests (covered by the SQL
  test `supabase/tests/create_post_verification.sql`).
- Submission failure leaves the wizard intact; success routes to the post.
