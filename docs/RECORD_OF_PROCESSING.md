# Record of processing activities (UK GDPR Art. 30) — DRAFT

WHAT: The controller's record of what personal data Trackitdown processes,
      why, about whom, who receives it, how long it is kept, and how it is
      protected — one entry per processing activity.
WHY:  UK GDPR Art. 30 requires one, and the docs kept saying "add it to the Art.
      30 record" (SECURITY_AND_TRUST §3) when no record existed. It is written
      from what the code ACTUALLY does — the migrations, the Edge Functions and
      SECURITY_AND_TRUST — not from a template, so where the code and the
      privacy policy disagree it says so (§5) rather than smoothing it over.
LINKS: src/features/legal/lib/legalContent.ts (the privacy policy this must
      agree with); docs/SECURITY_AND_TRUST.md; docs/DOMAIN.md;
      docs/OPERATIONS.md; docs/LOGGING.md.

> ## ⚠️ DRAFT — not legal advice. A UK solicitor must review it before launch.
>
> Like the legal texts (src/features/legal/README.md), the **facts** here were
> read from the code; the **law** has not been checked by anyone qualified.
> Lawful bases marked *proposed* are not yet stated in the privacy policy —
> they are a starting point for that review, not a ruling. Drafted 2026-10-21.

**Keeping it true.** A change that adds a table, a column holding personal
data, a third party, or a retention rule updates the matching entry here in the
same PR, and the privacy policy if what users are told changes. Nothing checks
this automatically.

---

## 1. Controller

| | |
|---|---|
| Controller | **TO FILL IN — the registered legal entity**, not the brand. The app says "Trackitdown" (`OPERATOR`, legalContent.ts), marked "Replace with the registered entity before launch". No company number is recorded. |
| Contact | **TO FILL IN.** The app's support address is still a placeholder (`support@trackitdown.example`). |
| Data Protection Officer | None appointed — **to confirm** whether one is required (it likely is not at this scale; the criminal-offence data in §3 is the point to check). |
| ICO registration | **Not done.** The data protection fee very likely applies (legal README). |
| DPIA | **None.** Strongly advisable before launch: location data, criminal-offence data and a public crowd looking for property (§3). |
| Data subjects' territory | UK residents, 18+ only (Terms). |

## 2. Processors and other recipients

| Recipient | Role | What they receive | Location / transfer |
|---|---|---|---|
| Supabase | Processor — database, auth, file storage, Edge Functions, logs | Everything below | EU (Ireland). **Transfer basis to document** (EU adequacy for UK data). |
| Stripe | Independent controller for payments and payout identity checks | Payment details, payer email (receipts), payout identity and bank details (entered on the phone, tokenised; see 4.12) | **Not documented** — likely US; transfer mechanism to record. |
| Expo, then Apple (APNs) / Google (FCM) | Processors — push delivery | Push token, notification title/body (make, colour, district; first names; some amounts — see §5) | **Not documented.** |
| Google Maps / OS geocoder (Google on Android, Apple on iOS) | Processors — maps, place names | Map viewport, coordinates to turn into an address | **Not documented.** |
| Apple, Google | Sign-in providers | Sign-in identity tokens, Apple full name if shared | **Not documented.** |
| Resend | Processor — email | Sign-in codes (Supabase Auth custom SMTP, from `noreply@trackitdown.co.uk`); bug-report emails (message, diagnostics, reporter's email, 7-day screenshot links); ops alerts (payment and post ids) | **Not documented.** |
| Google (Gmail) | The interim operator inbox `trackitdowwnn@gmail.com` receiving bug reports and ops alerts | As Resend, above | **Not documented.** Retention of the emails not set. |
| Waze / Google Maps apps | Opened by the OWNER from a sighting | One coordinate, when the owner taps | User-initiated. |
| The police | Disclosure when required, or to prevent harm | Case-by-case | — |

None of these receives data for its own marketing; we do not sell data
(privacy policy). All of them are named in the privacy policy's "Who we
share it with" since 2026-10-21.

## 3. Criminal-offence and special-category data

- **Criminal-offence data (Art. 10, DPA 2018 s.10–11 and Sch. 1): ⚠️ OPEN.**
  A listing asserts a vehicle was stolen and can say how (`stolen_from`,
  `keys_taken`, the owner's notes); a sighting can record a crime in progress
  ("Being stripped", "Being loaded or towed"), who was near the car
  (`people_presence`) and, in free text, anything at all. Processing
  criminal-offence data outside official authority needs a Schedule 1
  condition and, for most conditions, an appropriate policy document. **Nothing
  in the repo addresses this.** First question for the solicitor.
- **Special-category data:** not sought. The app tells people not to
  photograph faces (Safety guidelines); free text and photos could still
  contain it incidentally.

## 4. Processing activities

Lawful bases quoted are the privacy policy's ("How we use it"): **contract**
(run the service: listings, sightings, messages, bounties), **consent**
(notifications), **legitimate interests** (safety, fraud and misuse),
**legal obligation** (financial records).

### 4.1 Accounts and sign-in
- **Subjects:** users (owners, spotters).
- **Data:** email (`auth.users`); `profiles.first_name`, `display_name`
  (private), `avatar_path` (public `avatars` bucket), `created_at`; session
  tokens in the device keychain.
- **Purpose:** passwordless sign-in; a first name as the public identity.
- **Basis:** contract.
- **Recipients:** Supabase; Apple/Google sign-in; Resend (codes). A profile row
  is readable by its owner only (`profiles_select_self`, 2026-10-26); other
  users see a first name and reputation counters through server functions,
  never `display_name`.
- **Retention:** while the account exists; cascades on deletion.
- **Security:** RLS, own-row writes; emails redacted in logs; keychain storage.

### 4.2 Stolen-vehicle listings
- **Subjects:** owners (theft victims); anyone visible in photos or notes.
- **Data:** `posts` — plate, make, model, colour, year, body type, last-seen
  point / area / locality / time, how it was stolen (`stolen_from`,
  `keys_taken`), descriptions, owner note, status and dates; `post_photos` and
  distinctive-mark photos in the **public** `post-photos` bucket.
- **Purpose:** publish a stolen car so the public can report sightings.
- **Basis:** contract.
- **Recipients:** the public while active (recovered: 30 days more); watchers
  keep a minimal tombstone for 30 days; Supabase.
- **Retention:** a photo uploaded but never attached to a listing (the app
  closed mid-post) is removed after 48 hours by the hourly sweep
  (`enqueue_unreferenced_uploads`, 2026-10-26; the same for sighting photos).
  Cancelled listings hard-deleted 30 days after closing (owner
  warned at 27 days); recovered (and expired) listings deleted 12 months
  after closing, no warning (`purge_old_closed_posts`, 2026-10-22; never
  while money moves). The payments ledger keeps a
  `post_snapshot` (incl. plate) indefinitely (4.11). On the device, an
  unfinished draft for up to 14 days.
- **Security:** public read of `active` rows only; a theft from home is
  coarsened to ~1 km for everyone but the owner in every location-emitting
  RPC; status changes only through SECURITY DEFINER functions; pushes never
  carry the plate or street. **EXIF stripping is client-side only** — the
  public bucket accepts direct uploads (SECURITY_AND_TRUST §3).

### 4.3 Garage (saved, not-stolen vehicles)
- **Subjects:** users.
- **Data:** `vehicles` (plate, make, model, colour, year, nickname…),
  `vehicle_photos`, marks — photos in the public `post-photos` bucket.
- **Purpose:** report a theft faster.
- **Basis:** *proposed:* contract.
- **Recipients:** the user only (no RPC exposes another user's garage).
- **Retention:** until the user deletes the vehicle or the account.
- **In the privacy policy** ("Vehicles: number plate…", 2026-10-21).

### 4.4 Sightings
- **Subjects:** spotters; owners; incidentally, people near the car.
- **Data:** `sightings` — what it was doing and its follow-ups, people seen,
  condition, **what damage was seen (`damage_kinds`) and the spotter's words
  about it (`damage_note`, ≤300)**, **which parts were missing
  (`missing_parts`) and their words about that (`missing_parts_note`, ≤300)**,
  marks confirmed and offered, a note (≤500), a street-level `area_label`,
  district `locality`, time; `sighting_photos` — the photo (private bucket),
  capture GPS and accuracy, capture time, live or library.
- **Purpose:** give the owner evidence of where their car was seen.
- **Basis:** contract.
- **Recipients:** the post's **owner only** sees the photos, exact location and
  all words (through `get_post_sightings`; the damage and missing-parts
  columns are granted to no client role). The public sees, for the latest
  five, only time, district and a ~1 km point. No free text in any push or log
  (counts only).
- **Retention:** 90 days after the post closes, photo GPS is nulled
  (`purge_sighting_location_history`) and the street-level `area_label` and
  all free text are cleared (`purge_closed_sighting_details`, 2026-10-22) —
  never while money on the listing still moves. The photo and the
  structured answers stay until the listing goes (12 months after a
  recovery, 4.2) or the spotter's account does (§5, item 1).
- **Security:** captured only at the moment of reporting, never in the
  background; ≥1 live capture required server-side; 3 per post per day;
  explicit column grants; hidden characters refused; free text unmoderated.

### 4.5 Sighting withdrawal
- **Subjects:** spotters.
- **Data:** `withdraw_reason` (closed list), `withdraw_note` (≤200),
  `withdrawn_notified_at`.
- **Purpose:** tell the owner a sighting was taken back.
- **Basis:** *proposed:* contract.
- **Recipients:** the owner, in the app; the push is a fixed sentence.
- **Retention:** cleared 90 days after the listing closes (with 4.4).

### 4.6 Verification, reputation and review flags
- **Subjects:** spotters.
- **Data:** sighting status and review dates; counters on `profiles`
  (reported, helpful, credited); `review_flags` (collusion signals).
- **Purpose:** badges and trust; fraud control on badges.
- **Basis:** contract (counters); legitimate interests (flags).
- **Recipients:** counters visible to other users; `review_flags` never leaves
  the database.
- **Retention:** while the rows / account exist.

### 4.7 Messages and blocking
- **Subjects:** owners and spotters.
- **Data:** `threads` (participants, a ≤140-character preview), `messages`
  (≤2000), `user_blocks`.
- **Purpose:** owner–spotter conversation after a sighting; blocking.
- **Basis:** contract.
- **Recipients:** the two participants; the push names the sender and the car,
  never the content; the operator reads a thread by hand only in a dispute.
- **Retention:** read-only after the post closes; kept until the post or
  either account goes. No time limit.

### 4.8 Watchlist and collections
- **Subjects:** users. **Data:** watched posts, collection names (≤40).
- **Basis:** *proposed:* contract. **Recipients:** the user only.
- **Retention:** with the post or account.

### 4.9 Alert areas
- **Subjects:** spotters.
- **Data:** `alert_zones` — a point **snapped to ~1 km by the server before it
  is stored**, radius, label (e.g. "Home"), criteria.
- **Purpose:** alert spotters to matching stolen cars nearby.
- **Basis:** consent (notifications); *proposed:* contract for the stored area.
- **Recipients:** the user; matching is service-role only; owners see only a
  coarse, floored count of reach.
- **Retention:** with the account (paused areas kept).

### 4.10 Notifications
- **Subjects:** users.
- **Data:** `push_tokens`, `push_sends`, `push_receipts`, in-app
  `notifications` (title, body, ids), notification preferences.
- **Purpose:** deliver alerts, sightings, messages and money events.
- **Basis:** consent.
- **Recipients:** Expo, Apple, Google.
- **Retention:** in-app notifications 90 days; `push_sends` 30 days;
  `push_receipts` ≤24 h (opportunistic); push tokens 270 days after the app
  last registered them — every cold start — (`purge_stale_push_tokens`,
  2026-10-22), or with the account. Trade-off: a phone idle that long and
  then signed into a DIFFERENT account records no handset-switch link
  (`device_links`, 4.13), since the old token row is gone. Signing out keeps
  a hashed `push_token_releases` row (the last account on that device, so a
  different account signing in next still links — 2026-10-26); it goes at the
  same 270 days, or with the account.
- **Security:** payloads carry ids only; visible text bounded (§5, item 2 on
  what it actually carries).

### 4.11 Payments — listing fee, bounty, refunds, reward term
- **Subjects:** owners (payers); spotters (payees).
- **Data:** `payments` — Stripe ids, amounts, fees, status and dates,
  `post_snapshot`, `payee_snapshot` (the payee's Stripe account id once their
  account is deleted); `stripe_webhook_events` ids. **No card details.**
- **Purpose:** take the fee or hold the bounty; refund; pay the spotter.
- **Basis:** contract; legal obligation (financial records); Art. 17(3)(b)/(e)
  for the snapshot kept after a post is deleted.
- **Recipients:** Stripe (with the payer's email, for receipts).
- **Retention:** "as long as financial and tax law requires" — *proposed:*
  6 years from the end of the financial year (the usual UK tax-records rule;
  to confirm with the solicitor/accountant). Not enforced yet: no ledger row
  is that old. Webhook dedup ids: 30 days (`purge_old_webhook_events`,
  2026-10-22).
- **Security:** amounts server-authoritative; signed webhooks; service-role or
  SECURITY DEFINER access only.

### 4.12 Payouts and identity checks (Stripe Connect)
- **Subjects:** spotters credited with a bounty.
- **Data held by us:** `stripe_connected_accounts` — the Stripe account id,
  onboarding and payout status, the last payout's status/amount/dates, and
  **`bank_last4`: the last four digits of the payout bank account** (Stripe's
  answer, exactly four digits, owner-only).
- **Not held:** name, date of birth, address, phone, sort code, account
  number — tokenised on the phone and sent to Stripe. ⚠️ The **legacy Express
  path** (`submit-payout-details`, older accounts only) still passes them
  through our function in transit, never stored or logged.
- **Purpose:** know-your-customer checks and paying out 95% of the bounty.
- **Basis:** contract; Stripe acts as a controller for the identity checks.
- **Retention:** with the profile. The Stripe account id is copied to the
  deletion audit (4.17) and kept on payments made to them (`payee_snapshot`,
  for reconciliation). On deletion `delete-account` closes the account at
  Stripe (since 2026-10-23); whether it worked is recorded in 4.17, and a
  failure emails the operator to close it by hand.

### 4.13 Fraud controls (collusion check)
- **Subjects:** owners and spotters.
- **Data:** `payout_reviews` (machine-word reasons), `device_links` (hashed
  push tokens moved between accounts). At payout time only, not stored:
  normalised emails compared, card fingerprints looked up at Stripe. **No IP
  addresses are stored.**
- **Purpose:** stop an owner paying a bounty to themselves.
- **Basis:** legitimate interests (fraud prevention).
- **Recipients:** operator only.
- **Retention:** `device_links` **indefinitely, surviving account deletion**
  (fraud evidence). `payout_reviews`: an unresolved one blocks deletion of the
  people in it; a resolved one is archived into the snapshot with the owner's
  listing, or kept anonymised (spotter cleared) when the spotter deletes
  (2026-10-23).

### 4.14 Refund holds and disputes
- **Subjects:** owners and spotters.
- **Data:** `refund_holds`; `refund_disputes` including a ≤500-character
  statement.
- **Purpose:** a 72-hour window for a spotter to contest a refund, decided by a
  person.
- **Basis:** *proposed:* legitimate interests (fair outcomes; fraud).
- **Recipients:** operator; each party sees their own.
- **Retention:** kept past the 90-day sighting-notes rule on purpose — it is
  evidence in a money decision (the privacy policy says so). An open dispute
  blocks deletion of either person. Once settled: archived into the payments
  snapshot (statement included) indefinitely when the owner deletes; kept
  anonymised — spotter, sighting and **statement cleared** — when the spotter
  deletes (2026-10-23).

### 4.15 Moderation reports
- **Subjects:** reporters and the people reported.
- **Data:** `post_flags`, `flags` (target and a ≤500 reason).
- **Purpose:** report misuse — including tracking a person rather than a car.
- **Basis:** legitimate interests.
- **Recipients:** operator only, by hand (no tooling, no audit log).
- **Retention:** with the reporter's account or the post.

### 4.16 Bug reports
- **Subjects:** reporters; anyone in a screenshot or the text.
- **Data:** message, what they expected, area, severity, frequency, app
  version, platform, OS version, device model, up to 50 step names, up to three
  screenshots (private `bug-screenshots` bucket).
- **Purpose:** support and fixing faults.
- **Basis:** *proposed:* legitimate interests.
- **Recipients:** operator; Resend and the Gmail inbox (§2).
- **Retention:** rows and screenshot files with the account (delete-account
  sweeps `bug-screenshots` since 2026-10-21). Emails in the inbox: no
  retention set.

### 4.17 Account deletion audit
- **Data:** `account_deletions` — the deleted user id, Stripe account id,
  whether that account was closed at Stripe (`stripe_account_closed`, since
  2026-10-23), objects removed, time. No name, email or content.
- **Purpose / basis:** accountability (Art. 5(2)); financial records.
- **Retention:** indefinite.

### 4.18 Onboarding funnel and telemetry
- **Subjects:** app users, before and after sign-in.
- **Data:** `onboarding_events` (random per-run id, slide, step);
  `telemetry_events` (random per-session id, event, ≤8 scalar properties —
  coordinates, plates, contact details and tokens refused; ids allowed).
  Supabase function logs. **Sentry is not wired.**
- **Purpose:** how far people get; error counts.
- **Basis:** *proposed:* legitimate interests (treated as anonymous).
- **Retention:** 180 days (onboarding) and 90 days (telemetry), run by the
  hourly sweep since 2026-10-21. Platform log retention not documented.
- **In the privacy policy** ("How the app is used", 2026-10-21).

### 4.19 Bounty guidance and area insights
- **Data:** per-post recommendations shown; counts on a ~1 km grid with
  minimum thresholds.
- **Basis:** *proposed:* contract. **Retention:** with the post.

### 4.20 Data exports ("Download your data", 2026-10-23)
- **Subjects:** the user asking for their own data (Art. 15 access, Art. 20
  portability).
- **Data:** per request, a readable PDF and the same data as JSON (linked from
  the PDF, for portability) in the private `data-exports` bucket —
  their account, listings, garage, own sightings, chats (the other person
  shown as "other person"), anonymised sightings on their listings, watchlist,
  alert areas, notifications, payments, payout status, holds/disputes, reports
  and blocks they made, bug reports, devices. **Never** other people's
  personal data, card details, internal fraud signals or push token values
  (`supabase/functions/_shared/dataExport.ts` picks every field by name).
  `data_export_requests` logs each file (ids, path, size, times — no payload).
- **How:** Profile → Support & legal → Download your data → a 15-minute
  download link. One file a day (a second request re-sends the same file).
- **Retention:** the file 24 hours (removed by the hourly sweep), and with the
  account if it is deleted first; the request row with the account.
- **Security:** service-role only (no storage policy, RLS on the log); never
  logged (URL, payload, email). Every list is read in pages (never a silently
  cut-down file); stray files no request names are swept after 25h.
- **Withheld, and why:** internal fraud signals (`payout_reviews`,
  `device_links`, review flags) — DPA 2018 Sch. 2 para 2 (prevention of crime);
  other people's identities — Art. 15(4). Their messages within the user's
  own conversations ARE included (owner's decision, 2026-10-23).

## 5. Known gaps — where the code, the policy and this record disagree

Each is a decision for the owner (and, for 1–3, the solicitor). Recorded here
so it is not mistaken for a decision already made.

1. ~~A spotter's photos do not survive their account deletion~~ — **closed
   2026-10-22** by the policy: the owner kept the behaviour (sightings
   cascade, photos erased by the sweep) and the policy now says so. Keeping
   evidence on a live listing would mean anonymising instead — not built.
2. ~~What a push carries~~ — **closed 2026-10-22** by the policy: it now
   names the sender's first name and a bounty's amount and date.
3. ~~"Detailed location history … deleted after 90 days"~~ — **closed
   2026-10-22**: the street-level `area_label` and all sighting words now go
   with the photo GPS at 90 days, and the policy says exactly that. The
   listing's own last-seen point stays until the listing is deleted.
4. **Free text:** sighting, damage, missing-parts and withdrawal notes —
   **closed 2026-10-22** (cleared at 90 days; kept while a payment on the
   listing is under 180 days old — chargebacks are not recorded, so the
   age is the guard). Still kept, and the policy says so: refund-dispute
   statements (money evidence, archived with the ledger). Messages go with
   the listing.
5. ~~Recipients and data missing from the policy~~ — **closed 2026-10-21**:
   Resend, Gmail, Apple/Google sign-in, Apple geocoding, Waze, telemetry and
   garage plates are named.
6. **Purges depend on one clock.** Every retention rule runs in the hourly
   sweep (`release-held-refunds`) — so if the sweep stops, all of them stop
   silently. `sweep_runs` records each run's counts; nothing alerts yet.
7. ~~Bug-report screenshots outlive account deletion~~ — **closed
   2026-10-21**: delete-account sweeps `bug-screenshots`.
8. **Retention periods** — **closed 2026-10-22** for recovered listings (12
   months), push tokens (270 days) and webhook ids (30 days). Still open:
   payment records (*proposed* 6 years, 4.11) and the operator's inbox
   (*proposed* 90 days for bug-report emails — a mailbox rule, not code).
9. **Transfers:** no mechanism documented for any non-UK/EU recipient.
10. **Criminal-offence data** (§3) — no Schedule 1 condition or policy
    document.
11. **Controller, contact, ICO registration** — not yet in place (§1).
