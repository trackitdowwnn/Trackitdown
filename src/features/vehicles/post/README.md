# Post a car (the report-a-stolen-car wizard)

**Actor:** a vehicle owner (a theft victim), signed in.
**One sentence:** the multi-step wizard where an owner lists their stolen car —
car details, photos, where/when it was last seen, a bounty, and proof of
ownership — producing exactly one **draft** post that a moderator later approves.

Built on the shared wizard framework (`src/shared/wizard`). Entered full-screen
from the **bottom tab bar's centre "+" action** ("Report a stolen car") — a
route OUTSIDE the `(tabs)` group, so the tab bar is absent for the whole flow.
(A My Cars entry point can be added later; the route is `/post-a-car`.)

> **Which world are we building?** The **draft → escrow-charge → pending_verification**
> world. `create_post` produces a post in status `draft`; the final wizard CTA
> then takes the bounty into escrow via Stripe PaymentSheet, and the Stripe
> **webhook** performs the server-side `draft → pending_verification` transition.
> The charge slice is built (`src/features/payments` + `supabase/functions/`); it
> is **gated on the Stripe setup** (`supabase/functions/README.md`) — until those
> secrets/functions are deployed, the charge step surfaces a retryable error but
> the rest of the wizard runs. Payout/refunds are still a later slice.

## Phases & steps (Airbnb treatment — an intro screen before each phase)

**Phase 1 — Tell us about your car**

> **Plate capture is deferred (removed 2026-07-24).** The wizard no longer
> collects a number plate — `buildCreatePostParams` always sends `p_plate:
> null`, so every post is plate-less for now and make/model/colour are the
> car's identity. The `plate_available` RPC + migration remain in the backend
> for when the step is re-added; nothing in the wizard calls them today.
> Steps no longer show a helper sub-heading. The distinctive-features step keeps
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
4. **Body type** (`BodyTypeStep` → `CardSelect`) — optional Airbnb-style icon
   cards (Hatchback/Saloon/Estate/SUV/… with a glyph + subtext; `lib/bodyTypes`).
   Stored verbatim on `posts.body_type`. Also editable via the CarDetailsEditor.
5. **Year** (`YearStep`) — optional, range-bound 1900–2100.
6. **Distinctive features** — its own step (2026-07-24): owner-authored photo +
   description evidence pairs (`DistinctiveFeaturesStep` → `DistinctiveFeaturesField`
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
7. **Photos** — `PhotoGridPicker`, min 3 / max 6, first photo = cover.

**Phase 2 — When and where**
8. **Last seen when** — `DateTimeField`, max = now.
9. **Last seen where** — `LocationPicker` (embedded), storing point +
   `addressLabel`; the coarse grouping `lastSeenArea` is derived here.
10. **Description** — free-text `descRecognise` ("About this car"), ≤1000 chars
   (`DescriptionStep`). Replaced the old theft-context step; the theft-context
   fields (`stolenFrom`/`keysTaken`/`descDrives`) are no longer collected in the
   wizard but stay editable post-hoc via the detail's theft-context pencil.

**Phase 3 — Reward** (two steps since 2026-08-20, ADR-0014)
11. **Pricing mode** — `CardSelect`: *offer a reward* (a bounty) or *no reward,
    £5 to list*. **Deliberately unseeded**, so Next stays disabled until the
    owner chooses: defaulting to `bounty` makes the £50 minimum feel pre-agreed
    (the barrier this option exists to remove), and defaulting to `fee` nudges
    them off a reward that makes their car more likely to be found. The fee card
    names its price AND says non-refundable — this step is the ONLY pre-payment
    disclosure surface in the flow, because there is no checkout screen.
11b. **Bounty** — `MoneySlider` with the 95/5 + escrow/refund transparency panel.
    **Walked past entirely** when there is no reward to set (the wizard's `when`
    gating), so it contributes no screen and no schema check — and no review
    row either, which needed `hideReviewWhenSkipped` and did not hold until
    2026-08-22 (see step 12).
    `bountyAmountPence` keeps its value across a mode switch, so changing your
    mind restores your own figure rather than resetting the control.
    (Proof-of-ownership / V5C collection was REMOVED from the app — there is no
    verification step.)
12. **Review** — the framework's built-in review (edit-jump-return per step),
    with both of its optional slots filled (redesigned 2026-08-22):
    * `review.header` → **`ReviewListingPreview`**: the cover photo with the
      car's identity over its lower edge and an Edit that jumps to the photos
      step. Until this existed the screen described a seven-photo listing as
      "Photos — 5 added", which says how many were picked and nothing about
      whether a stranger could recognise the car. ⚠️ Its register is
      VERIFICATION, not pride, and its copy names recognition — never recovery,
      which we measure nothing about.
    * `review.footer` → **`ReviewCostPanel`**: the sum and one honest line on
      what happens to it. Every figure is borrowed from `shared/lib/money`
      (`estimateRefundPence` is binding — one function, or two screens disagree
      about the same number) and is DISPLAY ONLY.
    * The bounty row is hidden in fee mode via `hideReviewWhenSkipped`. It used
      to show "Bounty £250" — the seed — directly above "Post & pay £5".
13. **Submit** — the final CTA reads "Post & pay £<amount>" — the bounty, or
    £5 in fee mode (a dynamic `finalCtaLabel`; a payment button names its sum
    in both modes).
    `onComplete` (in `PostACarScreen`) calls `create_post` (draft), then opens
    the escrow `PaymentIntent` (`createBountyPaymentIntent`) and presents Stripe's
    PaymentSheet (`useBountyPayment`). On **paid** it routes to the new post (the
    webhook advances it to `pending_verification`); on **cancel/decline** it
    throws so the wizard stays intact — and it holds the draft's id
    (`createdPostIdRef`) so a retry reuses the same draft + PaymentIntent (no
    duplicate draft, no double charge). See *Handoff* below.

## Data & server rules

- **One RPC, `create_post` (SECURITY DEFINER)** — the single write boundary.
  Assembles the draft post + photos + feature tags atomically and
  **re-validates server-side** everything the client's zod
  checked: bounty £10–£5,000, 3–6 photos, required fields, and the
  `stolen_from`/`keys_taken` enums. (It still enforces plate format +
  one-active-post-per-plate when a plate is given, but the wizard now always
  sends `p_plate: null` — plate capture is deferred.) Hard-codes
  `status = 'draft'` and `expires_at = now() + 90 days`; pins `owner_id` to the
  caller. Never advances the lifecycle (that's server-side, on escrow success).
  Migration: `20260713190000_post_a_car.sql` (+ `…191000` deny-anon).
- **Photos upload on submit, not per step** — to the **public** `post-photos`
  bucket under the owner's own folder. (Proof-of-ownership / V5C collection was
  removed, so nothing is written to the private `verification-documents` bucket.)
  The draft is created after uploads succeed,
  then the escrow charge is taken — a cancelled/declined charge leaves a
  re-payable draft (reused on retry), not a half-post. Upload paths are stable
  per source photo so a retry overwrites rather than orphaning.
- **Distinctive features (2026-07-24)** — owner photo+description pairs live in a
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
- **The dormant verification objects are NOT a cheap cut** (investigated
  2026-08-01, after a project review proposed deleting them as dead code). Four
  objects survive ADR-0007: the `verification_documents` table, the private
  `verification-documents` bucket, `update_post_verification`, and
  `plate_available`. "Dormant" undersells the entanglement:
  - `create_post` still has a **live write branch** into `verification_documents`,
    reached whenever its `p_verification_path` argument is non-null. The client
    hard-codes `null` (pinned by `postApi.test.ts`), so no row is ever written —
    but dropping the table means changing the signature of the SECURITY DEFINER
    function on the money path, which needs a coordinated client+server deploy
    or every post fails with PGRST202 in the gap.
  - Three SQL suites assert against these objects, and two of the assertions are
    **security walls, not coverage**: `anon_role_verification.sql` CHECK 3 (anon
    cannot read V5C paths) and CHECK 8 (anon cannot use `plate_available` as a
    logged-out plate-existence oracle). Deleting the objects deletes the walls;
    a future re-add would come back without them.
  - `edit_post_sections_verification.sql` pins `update_post_verification`'s exact
    signature in five places.

  Net: a multi-hour, deploy-coordinated change to remove objects that cost
  nothing to keep and that ADR-0007 kept **on purpose**. Keep them. The one thing
  worth doing is confirming the private bucket is empty in production — it is a
  storage-cost and data-retention question, not a code one.
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
- DOMAIN.md — draft → pending_verification → active lifecycle; £10–£5,000 bounty;
  90-day default expiry. `stolen_from = 'driveway'` marks the last-seen point as
  the owner's home — coarsened for non-owners downstream (already handled in
  `get_post_detail`; the approve-to-active path must coarsen too).

## Exit & failure

- Exit uses the framework's dirty-check confirm — copy acknowledges the
  situation ("Your details won't be saved yet — you can start again any time.").
- Submission failure (upload, `create_post`, opening the charge, or a
  cancelled/declined PaymentSheet) keeps the wizard alive with every answer
  intact + an inline error/retry, and the created draft's id is retained so the
  retry never re-creates it. **Losing a completed wizard to a network blip — or
  double-charging on retry — is the unforgivable failure here.**

## Payment handoff (escrow charge — BUILT; `src/features/payments`)

The escrow-charge slice is built. The contract between this flow and payments:

1. This flow calls `create_post(...)` → `{ post_id, status: 'draft' }`.
2. `createBountyPaymentIntent(post_id)` invokes the `create-payment-intent` Edge
   Function, which verifies the caller **owns** the draft, reads the price
   **from the DB** (the client never sends an amount, and never sends the fee —
   the price is not ours to name), creates a Stripe PaymentIntent (idempotency
   key = kind + `post_id` + amount), records a `requires_payment` ledger row,
   and returns the client secret. **Which price** is decided by the post, not by
   this flow: a null `bounty_amount_pence` means the fee applies (ADR-0014).
   `buildCreatePostParams` is the single place `pricingMode: 'fee'` becomes the
   `p_bounty_amount_pence: null` the server reads.
3. `useBountyPayment` presents Stripe's PaymentSheet with that secret.
4. The **`stripe-webhook`** function is the authoritative state change: on
   `payment_intent.succeeded` it calls ONE dispatcher
   (`mark_post_payment_held`), which serves both pricing modes — a bounty and a
   listing fee both reach `held`, told apart only by `payments.kind` — and
   either way the post goes **`draft → active`** (live-on-payment, server-side,
   idempotent); on
   `payment_intent.payment_failed` it marks the ledger `failed` and leaves the
   draft for retry. The client's "paid" result only routes away.

DB functions: `supabase/migrations/20260726100000_post_payment.sql`
(`record_post_payment_intent` / `mark_post_payment_held` /
`mark_post_payment_failed` / `claim_stripe_event` — all service-role only).
**Still deferred (later slices):** spotter Connect onboarding, the 95/5
`release-payout`, refunds/cancellation, and the abandoned-draft reaper.
**Setup + local testing:** `supabase/functions/README.md`.

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
- **Orphaned storage objects on edit** — `update_post` replaces the child ROWS
  (post_photos / verification_documents) but never deletes the underlying storage
  objects, so removing a hero photo, or **replacing the V5C** (a new hash → a new
  private `verification-documents/<uid>/v5c-*.jpg` object), leaves the old object
  orphaned. Hero-photo orphans are cost/clutter (public bucket); the replaced-V5C
  orphan is a private ownership document that outlives its post row — the one
  worth cleaning for the retention rules. Pre-existing in the create/retry path
  (stable per-uri hash overwrites there), amplified by edit's photo-swapping.
  Fix (media-hardening pass): after a successful `update_post`, delete the
  now-unreferenced objects.

## Draft resume — NOT built (ROADMAP)

This is the flow the framework's deferred *save & exit* was designed for. A
prominent TODO + ROADMAP line track draft resume; it is **not** built now.

## Editing a listing — PER SECTION on the post detail (BUILT)

An owner opens their post from **Profile → My Posts** (`list_my_posts` →
`MyPostsScreen`, route `/my-posts`) and edits it **one section at a time** on the
detail screen. Two entry points reach the same editor: a pencil
(`SectionEditButton`) beside each editable section, and the matching row in the
sticky bar's "Manage post" sheet (`PostManageSheet`). Both go through
`PostSectionEditorHost` → the section's editor in `components/editors/`.

**Presentation.** The host picks it per section and passes it down as context
(`editorPresentation.ts`), so the editors themselves don't know or care and the
shared `PostSectionEditor` scaffold lays itself out accordingly:
- **Bottom sheet** (six of seven) — the right weight for one section: the listing
  stays visible behind it and swipe-down is a free cancel. The sheet auto-sizes
  and scrolls internally, so even the taller editors fit. In sheet mode the
  scaffold must render **bare** — no `Screen`, no `ScrollView` — because
  `BottomSheetScrollView` already scrolls and nesting scrollers breaks both it
  and the drag-to-close.
- **Full screen** (`last_seen` only) — it embeds an interactive map whose pan
  gestures would be read as dragging the sheet. Photo pickers need no exception:
  they open as opaque native `Modal`s *above* the sheet.

Each editor reuses the wizard's Field/Step components with a local answers slice,
validates, and Saves via a section RPC, then the detail refetches
(`usePostDetail.retry`). No payment step — a draft isn't charged until "Post &
pay"; the bounty editor is draft-only anyway.

**FROZEN, not frozen-out (product call 2026-08-01).** A project review put this
surface up for deletion as "seven screens where one form would do". It survives,
and the reasoning is worth keeping because the surface *looks* more expensive
than it is: `PostSectionEditor` + `PostSectionEditorHost` hold all the machinery
(~310 lines), so each of the seven concrete editors is only 47–82 lines of field
wiring. Collapsing them into one edit-everything form would DELETE less than it
added, and would lose the property that makes the per-section design correct —
the server gates editability *per section per status* (see below), which a single
form cannot express without rebuilding the same seven cases inside itself.

Frozen means: no eighth editor without a product reason, and no new capability
routed through this pattern. It is finished, not a foundation.

- **Editable by status.** DRAFT → every section. The **money-neutral** sections —
  *car details*, *theft context*, *distinctive features*, *description* — are
  gated to `draft + pending_verification + active`, so they stay editable on a
  **LIVE** listing (`20260731100000_edit_safe_sections_when_live.sql` for the
  prose three, `20260731110000_edit_car_details_when_live.sql` for car details).
  *Photos*, *last-seen* and the *bounty* stay **draft-only**: imagery and where
  the car was taken from must not move once the crowd is matching against them,
  and the bounty is frozen by escrow. This is a hard **server** gate, not just UI.
  (The V5C / proof-of-ownership editor was removed with verification; its RPC
  `update_post_verification` remains in the schema but is dormant/unused — see
  the cut note below before proposing its deletion.)
- **Why the money-neutral four are editable while live.** Live-on-payment
  publishes on payment, so `active` is the state an owner actually lives in. A
  WRONG detail actively harms the search — spotters scan for "silver Golf" and
  skip the right car — and the only previous remedy was deactivate + refund +
  repost, which burns the hours that matter most. The widening is money-neutral by
  construction: each RPC names its own columns / child rows and never writes
  `bounty_amount_pence`, `status`, `owner_id` or `expires_at`.
- **The plate is immutable.** `plate` is in NO per-section RPC, so a live listing
  can never be edited onto a different registration — the identifier police and
  ANPR match on is fixed at posting. That is what keeps "editable identity" from
  being identity laundering; bait-and-switch is otherwise handled reactively
  (paid, card-on-file, non-anonymous accounts + `post_flags` + takedown).
  Asserted by CHECK 2b in `supabase/tests/edit_post_sections_verification.sql`
  (the four draft-only RPCs must still raise `POST_NOT_EDITABLE` on a live post,
  the plate must survive an edit, and `cancelled` stays closed to everything).
- **Backend — per-section RPCs** (`20260727130000_edit_post_sections.sql`
  plus `_description` in `20260728100000_edit_post_description.sql`),
  each SECURITY DEFINER, owner-pinned, status-gated (→ `POST_NOT_EDITABLE`),
  `create_post`-parity validation of ITS fields, writing only ITS columns /
  child rows, NEVER status/owner/expires: `update_post_car_details` / `_photos` /
  `_last_seen` / `_bounty` (bounty column only, draft), and
  `_theft_context` / `_distinctive_features` / `_description` (`desc_recognise`
  only — draft + pending). (`update_post_verification` exists but is no longer
  called — proof-of-ownership was removed.) Client:
  `post/api/editSectionApi.ts` (keeps remote photos via `isRemotePhoto`, uploads
  only new locals). Prefill comes from the already-loaded `PostDetail`
  (`get_post_detail` now returns distinctive features —
  `20260727120000_post_detail_distinctive_features.sql`).
- **Retired:** the earlier "re-open the full wizard to edit a draft" approach
  (`update_post` / `get_post_for_edit` RPCs — dropped in
  `20260727140000_drop_whole_post_edit.sql`; `edit-post/[id]` route,
  `EditPostScreen`, `usePostForEdit`, `editPostApi`, `postApi.updatePost` — all
  removed). "My cars" is now a garage placeholder; listings live in "My Posts".

## Out of scope

Editing photos / last-seen / bounty on a **paid** post — live or pending (a
bounty change needs refund-or-top-up; photo and last-seen changes need the
unbuilt re-moderation flow); today the owner deactivates + reposts. Changing the
**plate** at all after posting — deliberately impossible, see above · draft
resume · multiple vehicles per post · bounty-free posting (all ROADMAP, not
built). *(The money-neutral four — car details, description, theft context,
distinctive features — ARE editable while live; see "Editable by status".)*

**Follow-up — surface the colour note on the detail page.** The wrapped/other
colour note is stored (`owner_note`) and shown in the wizard review, but is NOT
yet rendered on the post detail. Surfacing it end-to-end (`get_post_detail`
selects `owner_note` → a `PostDetail` field → a `carDetails.ts` row appended to
the colour) is a small tracked follow-up so a spotter sees "matte black wrap
over silver", not just "Multicolour / wrapped".

**Follow-up — render the distinctive features on the detail page + gallery.** The
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
