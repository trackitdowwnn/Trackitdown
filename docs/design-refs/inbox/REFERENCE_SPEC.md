# Reference spec — two lists in one tab, read by someone waiting for news

WHAT: The measurable target for the inbox tab — its two faces (Messages and
      Notifications), the row anatomy they share, the signals they carry, and
      the register of their copy — each mapped to one of our tokens.
WHY:  Six sections have had Airbnb passes and share a house skeleton; the inbox
      had none, and the notification centre had never been reviewed at all
      (`sizes.attentionBar` exists for it, but no design ref did). This file is
      the standard the redesign is measured against, so "it looks better" can be
      checked rather than asserted.
LINKS: ./GAP_ANALYSIS.md; src/app/(tabs)/inbox.tsx (the segment host);
      src/features/chat/screens/InboxScreen.tsx;
      src/features/notifications/screens/NotificationCenterScreen.tsx;
      docs/DESIGN_SYSTEM.md; docs/design-refs/alerts/REFERENCE_SPEC.md (the
      no-screenshots spec this follows).

## Sources & confidence

⚠️ **NO SCREENSHOTS.** The owner chose on 2026-08-28 to proceed on web research
alone, as with `alerts/` and `report-bug/`. Every measurement below is
**reported** or **inferred**; nothing here is pixel-measured, and the pt values
are OUR translation of a described structure, not Airbnb's numbers.

⚠️ **THE ANALOGUE IS THE STRONGEST WE HAVE HAD, AND THAT IS ITS OWN RISK.**
Unlike alerts (where the screen does not exist at Airbnb) this is a near-twin:
Airbnb's Inbox is a tab holding guest–host conversations, each anchored to a
listing, with unread state and filters. The temptation is therefore to copy
rather than translate — and the two products diverge in exactly one place that
matters, which is who the people are to each other.

| Candidate | Fit | Verdict |
|---|---|---|
| Airbnb Inbox → Messages tab | Conversations anchored to a listing, filtered, unread-bolded | **The twin.** Our car is their listing |
| Airbnb Inbox → Notifications | Account/trip updates, money, alerts | Good structural match for the centre |
| Airbnb Today tab (host) | "what needs you now" | Source of the needs-attention LABEL idea only |

Confidence: **high** on the general design language (photo-led rows, flat lists,
whitespace over dividers, restrained motion) — it is consistent across every
Airbnb surface we have already studied. **Low** on inbox-specific geometry: we
have no measurement of their row height, thumbnail size or type ramp.

Trade dress excluded by rule: Rausch `#FF385C`, Cereal, their icon set, their
verbatim copy. We take structure, rhythm, anatomy, motion feel.

Sources:
- [Airbnb Resource Centre — Getting the most out of the Messages tab](https://www.airbnb.com/resources/hosting-homes/a/getting-the-most-out-of-the-messages-tab-678) — the filter vocabulary: **Unread** and **Starred**, plus filters by listing and by stage of trip; unread threads render **bold**.
- [Zeevou — Where is my Airbnb inbox](https://zeevou.com/blog/where-is-my-airbnb-inbox/) — thread-level anatomy: a **Details** context card carrying the reservation (dates, payout), a flag action for suspicious messages, star/archive, and **swipe-left to archive**.
- [AlternativeTo — Airbnb 2025 app redesign](https://alternativeto.net/news/2025/5/airbnb-app-redesign-adds-services-booking-trip-planning-and-upgraded-messaging) — the 2025 rebuild ships **photo and video in-thread**, on a stack described as enabling "modular components, animated states".
- [Bootcamp — Airbnb Summer 2025 update](https://medium.com/design-bootcamp/airbnb-summer-2025-update-heres-what-s-new-and-why-it-matters-0ced2338b921) — the 2025 language: a "dimensional + animated design system", motion treated as part of the language rather than decoration.
- [Karri Saarinen — Airbnb DLS](https://karrisaarinen.com/dls/) — components as "elements of a living organism… defined by a set of properties", and **dividers managed through view logic rather than as inherent visual elements** — the licence for our divider-free lists.
- Airbnb's own messaging help copy (via the Resource Centre above) — **time-sensitive messages float to the top of the inbox, with labels highlighting what needs immediate attention**.

## 1 — What this screen is for

| Observation | Note |
|---|---|
| Its job | Carry two kinds of incoming news: a person talking to you about a specific car, and the system telling you something happened |
| Its user | An owner whose car is gone, or a spotter who reported one and is waiting to hear whether it helped |
| Emotional context | Suspense, and sometimes money. **Not hospitality** |
| Success | You can tell which conversation is which at a glance, and nothing that needs you gets scrolled past |
| The stake | This is where a recovery actually gets negotiated — the one surface where the two sides of the product meet |

### ⚠️ Emotional translation — the one place we must diverge

Airbnb's inbox is hospitality: a host greeting a guest, a trip approaching, a
register of warmth and anticipation. Ours carries "your car was seen in Camden"
and "you were not credited". The people in our threads are strangers brought
together by a crime, and one of them is having a bad week.

So we take the **anatomy** — the photograph leading the row, the context anchor,
the quiet unread treatment, the label on what needs you — and none of the tone.
The copy stays in the calm, capable voice the bug-report pass settled on. The
existing strings already do this well (`"All caught up"`, `"Nothing yet"`,
`"Conversations open when a spotter reports a sighting on your car"`) and this
pass changes none of them.

## 2 — Layout & rhythm

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Screen gutter | 16–24 depending on density | inferred | `spacing.xl` (24) — a text list, not an image grid ✅ |
| Rows sit directly on the page | No cards, no separators; whitespace divides | reported (DLS: dividers are view logic) | no surface, no border ✅ already true |
| Row vertical padding | Generous; the row breathes rather than packs | inferred | `spacing.lg` (16) ✅ already true |
| Lead-to-text gap | One step tighter than the gutter | inferred | `spacing.md` (12) ✅ already true |
| Within-row line gap | Tight — three lines read as one block | inferred | `spacing.xs` (4) ✅ already true |
| Day/section grouping | Time-grouped, with quiet labels | reported | `DayHeader` = `label` @ `textSecondary` ✅ (carve-out 2026-08-28) |
| Elevation | Flat throughout | measured (by absence) | no shadow ✅ house rule |
| Both faces share one rhythm | One tab must read as one place | house rule | identical list padding on both ✅ **NEW for this screen** |

⚠️ **The two faces had drifted apart in four measurable ways** — different list
padding, different `centered` styles, a header row that appeared and vanished,
and skeletons that matched neither row. None is visible on its own screen; all
four are visible the instant you switch tabs, which is the one thing a segment
control invites you to do constantly.

## 3 — The row

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| The photograph leads | A listing row leads with the listing photo, at full size | reported | `sizes.inboxRowTile` (64) **NEW** |
| Thumbnail shape | Rounded rectangle, not a circle | inferred | `radii.md` (12) ✅ |
| Title line | Who, with the timestamp trailing | reported | `typography.body` + `caption` ✅ |
| Unread emphasis | **Bold** | reported (Airbnb's own help copy) | family swap to `cardTitle`'s face ✅ already true |
| Second line | The content — what was said | inferred | `typography.body` @ `textSecondary` |
| Third line | The context anchor — which thing this is about | reported (their "Details" card, inline for us) | `typography.caption` @ `textSecondary` ✅ |
| Trailing | Unread mark, right-aligned | reported | `UnreadBadge` **NEW (shared)** |

⚠️ **A 24pt badge is not a photograph.** The row previously led with an
initial-letter avatar wearing the car's cover photo as a 24pt corner badge, and
called that the Airbnb anchor. It is the right idea at the wrong size: you
cannot tell one silver hatchback from another at 24pt, so the anchor anchored
nothing, and the largest element in the row was a letter. Airbnb gives the
photograph the leading slot precisely because recognition is the row's job.

⚠️ **We cannot show the person, and should stop trying.** `other` is parsed
`.strict()` with `firstName` only — the peer's avatar path embeds their uid, so
the API deliberately never returns it. An inverted badge would therefore always
be a single letter in a circle: decoration with no information. The NAME
identifies them better than an initial ever did.

⚠️ **64, not 72.** `carTile` and `alertThumb` are 72 and both lead a *card*,
inside a padded `cardSurface` box. This leads a bare row. At 64 the tile sits
just under the three-line text column's intrinsic height, so the text drives the
row height and the picture never does.

## 4 — Signals

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Time-sensitive items surface with a LABEL | "labels highlighting things that need immediate attention" | reported | `typography.label` @ `textPrimary` + a `warning` ring **NEW for this screen** |
| Unread is quiet but unmissable | Bold text, a mark | reported | family swap + `UnreadBadge` ✅ |
| Counts | Airbnb shows a count on the tab | reported | `badgeDisplay`'s existing "9+" cap ✅ |

⚠️ **A 3pt stripe is status encoded as colour, which we forbid outright.**
`DESIGN_SYSTEM.md` says never encode status by colour alone, and the
needs-attention bar did exactly that for the two kinds where the stakes are
highest — money waiting on bank details, and a contest window running. It also
could not say *what to do*. The bar stays as the peripheral cue; the words are
what was missing.

⚠️ **The mark is a hollow ring, not a filled amber dot.** ReportCard settled
this: amber `#A9762A` against `borderStrong` `#8F8F8F` is a 1.19:1 luminance
ratio, so in greyscale or under deuteranopia a filled amber dot and a neutral
one are the same mark.

## 5 — States

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Skeletons, not spinners | Content-shaped placeholders | house rule | `surfaceSubtle` blocks ✅ |
| The skeleton is the row's own geometry | — | house rule | skeletons exported from the row files **NEW** |
| Empty states explain and invite | Explain the feature, offer one action | reported | `EmptyState` ✅ |
| Errors read as recoverable | Calm, with a retry | house rule | `ErrorState` ✅ |

⚠️ **A skeleton that does not match its row is worse than no skeleton**, because
it makes a promise about where content will land and then breaks it. Both faces
were doing this, and the day grouping would have made it worse by putting a
header at index 0 that no skeleton accounted for.

## 6 — Deliberately not adopted

| Their move | Why not |
|---|---|
| Swipe-left to archive | **We have no archive.** A thread is tied to a live post and closes when the post does; there is nothing to file it into. Chat's README already recorded this as deliberate |
| Starred / pinned threads | Solves a problem of volume we do not have — an inbox is a handful of threads about one or two cars, not a hosting business |
| Filter by listing / trip stage | Our equivalents already exist as "My cars" / "My sightings", which is the same split in our words |
| Read receipts on rows | We have one thread-level `theirLastReadAt` and render a single "Seen" in the thread. Per-row receipts would need a schema change for a feature nobody asked for |
| Scheduled messages / quick replies as canned templates | Quick replies exist and are role-aware; templating is a hosting-business tool |
| Photo and video in-thread (2025) | A real product decision with moderation, storage and safety consequences — not a design pass's call |
| AI action cards in the conversation | No |

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| `sizes.inboxRowTile` | 64 | The leading visual on both inbox faces. Not `carTile`/`alertThumb` (72, card-scale) and not `fab` (64, a round button) |
| `sizes.inboxRowGlyph` | 32 | The notification icon inside that tile. `sizes.icon` (24) reads as a badge lost in a 64pt box; matches `carTileGlyph`'s ratio |
| `sizes.skeletonTimeBar` | 40 | The timestamp bar in a row skeleton. Fixed because the string it stands in for is fixed-ish; a percentage would grow it with the screen |
| `UnreadBadge` (component) | — | Two features need the same mark, and the reserved-slot behaviour must be identical in both |
| `DayHeader` / `DayHeaderSkeleton` (component) | — | Three lists group by day; the third copy is where sharing stops being premature. Needs a `gutter` prop because the three genuinely differ |
| `CarColourTile.size` / `.radius` | 72 / `radii.lg` defaults | Forced by chat needing the same no-photo fallback; defaults keep the report card byte-identical |
| (no new radii/colour/type) | — | The existing scale covers everything measured; `tabLabel`'s scope note was corrected rather than a sibling added |
