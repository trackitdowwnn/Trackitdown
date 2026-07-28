# garage

Users pre-register their vehicles ("My cars") so that if one is ever stolen,
reporting it takes **seconds instead of minutes**. The garage is a peacetime
feature whose entire payoff arrives at the worst moment of someone's week.

**Actor:** owner, pre-theft. There is no spotter or moderator surface here, and
no guest surface — the `/my-cars` guest state (an invitation `EmptyState` behind
the `tab_my_cars` gate intent) is unchanged.

## Placement

`features/garage` owns saved vehicles; `features/vehicles` stays about posts.
The `/my-cars` route (pushed from Profile — My Cars left the tab bar on
2026-07-23) composes both: a **My cars** section from this feature, and a link
through to **My posts** (`/my-posts`, owned by `features/vehicles`).

## The shared vehicle sub-flow

The posting wizard's `car` phase collects *exactly* what the garage collects, so
those seven steps exist **once** and are consumed by both flows:

```
features/vehicles/post/lib/vehicleSteps.tsx
    buildVehicleSteps({ minPhotos }) → make · model · colour · body-type ·
                                       year · distinctive-features · photos
         ├──> buildAddVehicleFlow()        (garage: plate? + these + nickname?)
         └──> postACarFlow's `car` phase   (posting, minPhotos: 3)
```

**Why the steps live in `features/vehicles`, not here.** Vehicles already owns
the step components and the answer type. If the shared list lived in the garage,
`vehicles` would have to import the garage for it *and* the garage would import
vehicles for the components — a cycle, which ARCHITECTURE.md rule 1 forbids. So
the dependency is one-way: **garage → vehicles, never back**. The prefilled
posting flow takes a plain `VehicleAnswers`-shaped seed, so `vehicles` never
learns that a garage exists.

The only legitimate difference between the two consumers is `minPhotos`:
posting demands 3 (a spotter needs several angles); the garage allows 0.

### Reporting a saved car stolen

`lib/prefilledPostFlow.tsx` swaps the posting flow's `car` phase for a single
`VehicleSummaryStep` — *"Blue BMW 320d · AB12 CDE · 4 photos"* — seeded with the
saved answers, so the owner only completes when/where, bounty, review and pay.

- **Edit is a flow swap, not a jump.** Tapping it rebuilds with `expanded: true`,
  restoring all seven steps with the SAME answers. The wizard has no
  jump-to-step API, and adding one would be the framework change we deliberately
  avoided. Every prefilled value stays changeable — a stolen car's details may
  need a last-minute correction, and a prefill you can't fix is worse than none.
- **Exception:** a car with fewer than 3 photos keeps the real photos step, so it
  can't reach review and fail on `create_post`'s `PHOTO_COUNT`.
- `shared/wizard` is **not** changed. Composing two step arrays avoids putting a
  `skipIf` predicate into a framework that also powers the money flow.

## Screens

- **`MyCarsScreen`** (rewritten, moved here from `features/vehicles`) — the
  garage list + the My-posts link. Empty, loading (skeletons), error and
  populated states.
- **`AddVehicleScreen`** — `WizardScreen` over `buildAddVehicleFlow()`. Serves
  **both** add and edit (`/add-vehicle`, `/edit-vehicle/[vehicleId]`): the flow
  and the mapping are identical, only the RPC and the toast differ.
- **`ReportSavedCarScreen`** — `/report-stolen/[vehicleId]`. Resolves the car,
  builds the prefilled flow, and renders `PostACarScreen` with it. Fails kindly
  when the car is gone or already has a live listing.

Garage cards show photo, nickname or make/model, `PlateChip`, and an overflow
for Edit / Remove (`ConfirmDialog`). A car with a live post reads **"Currently
reported stolen"**, and its report action becomes a link to that post.

## Data & server

```
vehicles                      id, user_id → profiles ON DELETE CASCADE,
                              plate?, make, model, colour, year?, body_type?,
                              nickname?, verification_state (RESERVED — no
                              writer), created_at, updated_at
vehicle_photos                vehicle_id CASCADE, url, position
vehicle_distinctive_feature   vehicle_id CASCADE, photo_url, description, position

posts += vehicle_id  NULL REFERENCES vehicles(id) ON DELETE SET NULL
```

RPCs (SECURITY DEFINER, owner-pinned): `add_vehicle`, `update_vehicle`,
`delete_vehicle`, `list_my_vehicles`. `delete_vehicle` raises
`VEHICLE_HAS_ACTIVE_POST` while a live post references the car.
`list_my_vehicles` returns `is_currently_posted` + `active_post_id`.

**SNAPSHOT, NOT REFERENCE — the decision that would bite later.** Posts already
store every vehicle field denormalised on the post row, with `post_photos` and
`post_distinctive_feature` as children. Posting from the garage pushes the saved
values through that same `create_post` path, so the post owns a copy taken at
posting time. `posts.vehicle_id` is **provenance only** — nothing reads it for
display — and `ON DELETE SET NULL` means someone tidying their garage a year
later can neither mutate nor orphan a historical recovery record.

Photos reuse the **`post-photos`** bucket at the existing `<uid>/…` own-folder
path, via the shared `uploadOwnFolderPhoto` in `shared/api/photoUpload.ts`
(promoted out of `postApi` once two features needed it). So `create_post`'s URL
regex accepts a garage photo URL unchanged and posting needs **no re-upload** —
that is where most of the speed win lives.

The garage's data layer imports **nothing** from `features/vehicles`: it has its
own error copy and its own `VehicleSaveError`. Reaching for the vehicles barrel
dragged `PostDetailScreen`, and through it the Stripe native module, into the
garage — which broke an unrelated test and would have loaded payments code just
to list saved cars.

**Limits:** 5 vehicles per user; one saved car per plate **per user** (global
uniqueness would leak other people's garages); plate optional throughout.

## Rules & safety applied

- **One active post per plate** is reactivated: today every post is plate-less
  (`p_plate: null`), so `create_post`'s `PLATE_IN_USE` check is dormant. Once the
  garage supplies plates it starts firing, and `plate_available` gets its first
  caller as an advisory check at add time.
- **No money, no `posts.status` change, no Edge Function.** Nothing here touches
  the DOMAIN lifecycle.
- **No DVLA lookup** — it is stubbed app-wide and is a separate v1
  infrastructure item, not part of this feature.
- **No V5C / pre-verification** — deliberately excluded. It buys no time (a paid
  post already goes live instantly under live-on-payment) and would require the
  moderator queue, which does not exist. `verification_state` is reserved so
  re-introduction needs no table rewrite.
- **SAFETY / privacy:** a saved vehicle is visible ONLY to its owner. No RPC,
  feed, search or post surface exposes another user's garage — absence-tested
  for `anon` and for a different signed-in user. Garage rows and their storage
  objects are removed with the vehicle and on account deletion; they are NOT
  subject to the 30-day post-closure retention rule, which governs post
  artefacts (SECURITY_AND_TRUST.md §3).

## States & logging

Empty garage gets a warm, value-led `EmptyState` — *"Add your car now and
reporting it stolen later takes seconds"* — plus the Add CTA. Loading renders
skeletons. Logged under `[garage]`: vehicle added, vehicle removed, and
prefilled-post launched. The add → post conversion is this feature's proof of
worth.

## Nudges — getting the garage filled in before it's needed

The garage only pays off if it's set up in peacetime, so three prompts exist.
They are deliberately unequal in how much they interrupt:

| | Where | When | Interrupts? |
|---|---|---|---|
| **Exit sheet** | `SaveYourCarSheet`, mounted at the app root | Opening the post-a-car wizard and **leaving without posting**, with no saved car | Yes — once per install |
| **Feed card** | `SaveYourCarCard` in Explore's `listHeader` | Member, account ≥ 3 days old, no saved car, never offered | No — inline, dismissible |
| **Profile hint** | `subtitle` on Profile → My cars | No saved car | No — permanent, undismissable |

**The exit sheet fires on EXIT, never on entry.** Prompting when someone *taps*
Report would be backwards: whoever taps that button has very likely just had
their car stolen, and an interstitial costs them time at the exact moment the
garage exists to save it — adding a car first is strictly slower than reporting.
Backing out, by contrast, is the clearest signal in the app that someone is
exploring. A real victim never sees it. This is the deliberate inverse of the
"no offer *after* posting" rule in Out of scope below; both follow from the same
principle, which is why neither should be deleted as contradicting the other.

Two guards make that safe, and both are tested:
- `PostACarScreen`'s `onAbandon` fires only when **no draft exists** — someone who
  got as far as creating one and hit a payment problem is not offered anything.
- The `/post-a-car` route is the only caller. `ReportSavedCarScreen` renders the
  same screen and passes nothing, so the from-garage path is excluded
  structurally rather than by a runtime check.

**One shared flag, `trackitdown.garage_nudge_offered_v1`.** It means *"we asked"*,
not *"they declined"* — the sheet writes it the moment it appears, whatever the
user taps, and the card writes it on dismiss. So the sheet having fired
permanently silences the card: they are the same offer, and asking twice is a
nag. The Profile hint deliberately never reads it, which is what lets the other
two be this conservative — the offer never disappears, it just stops being pushy.
Note the flag **fails closed** (an unreadable flag suppresses), the opposite of
`onboardingStorage` which it is otherwise copied from.

**The shared signal.** `useHasSavedCar` (`'unknown' | 'none' | 'some'`) is a
module-level cached count over `list_my_vehicles`, fetched lazily behind each
caller's cheap checks — so a new or already-offered user costs zero network on
the app's hottest screen. `'unknown'` (guest, failed fetch, request in flight)
**never nudges**. `garageApi` invalidates it after every write, and
`useMyVehicles` primes it for free.

Logged as `garage_nudge_shown / _accepted / _dismissed { surface }`.

## Known gaps (found by review, NOT yet fixed)

Ordered by what would bite first. None is cosmetic.

1. **The post↔vehicle link is not wired.** `create_post` has no `p_vehicle_id`
   and the posting client still sends `p_plate: null`, so `posts.vehicle_id` is
   always NULL. Consequences: `is_currently_posted` is permanently false, the
   "Currently reported stolen" card state and the already-reported guard are
   **dead code**, `VEHICLE_HAS_ACTIVE_POST` can never fire (a car with a live
   listing CAN be removed), and one-active-post-per-plate stays dormant. Needs a
   `create_post` migration + the plate plumbed through `buildCreatePostParams`.
2. **Garage photo objects are never deleted.** `delete_vehicle` drops rows only;
   `update_vehicle` orphans replaced photos. They stay reachable by URL in the
   public bucket — a UK GDPR erasure gap (SECURITY_AND_TRUST §3). Any fix must
   first check `post_photos.url` for the same object, because the garage and
   posts deliberately SHARE objects: deleting one blindly would blank a live
   listing's hero image.
3. **Public bucket for never-stolen cars.** Reusing `post-photos` buys the
   no-re-upload speed win, but a garage photo gets a permanent, unrevocable
   public URL protected only by a 32-bit non-cryptographic hash — and the `<uid>`
   half of the path is already public for anyone who has ever posted. A private
   `garage-photos` bucket with a server-side copy at posting time is the safer
   design; at minimum the object name should come from a CSPRNG.
4. **`posts.vehicle_id` is readable by `anon`** (`grant select on posts` is
   table-wide), making it a cross-post correlation key that links two listings
   to one person. Inert only while gap 1 stands. Needs a column-list grant.
5. **The photo-URL host regex accepts any Supabase project**
   (`[a-z0-9-]+\.supabase\.co`), so a saved photo could point at an attacker's
   storage and become a tracking beacon on a public listing. Inherited from
   `create_post`; should pin the project ref.
6. **Untested:** `updateVehicle` (the full-replace write), all four screens, and
   `useMyVehicles`' user-keying. The SQL suite has never executed — no Docker.

## Out of scope

Sharing vehicles between accounts · MOT / tax / insurance reminders (ROADMAP
note — tempting scope creep) · vehicle history or valuation · more than 5
vehicles · DVLA lookup · V5C and pre-verification · offering to save a car to
the garage **after posting one** from scratch (wrong moment — the user has just
had their car stolen; the exit sheet in Nudges is the deliberate inverse, firing
only when someone leaves WITHOUT posting) · prefilling `/add-vehicle` with what
was typed into the abandoned wizard (would need `onExit(answers)` in
`shared/wizard`, which also powers the money flow).
