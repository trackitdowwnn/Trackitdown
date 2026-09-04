# Reference spec — two strangers negotiating the return of a car

WHAT: The measurable target for the chat thread — how much of the screen the
      conversation should get, the header's anatomy, bubble grouping, and the
      register of the copy — each mapped to one of our tokens.
WHY:  The inbox pass scoped this screen out and fixed three defects on the way
      past. It is the most used surface in the feature and the only one where a
      recovery is actually negotiated, and it was measured at 46% chrome. This
      file is the standard the redesign is measured against, so "it feels
      roomier" can be checked rather than asserted.
LINKS: ./GAP_ANALYSIS.md; src/features/chat/screens/ChatThreadScreen.tsx;
      src/features/chat/components/ThreadHeader.tsx;
      docs/design-refs/inbox/REFERENCE_SPEC.md (the list this screen opens from);
      docs/SECURITY_AND_TRUST.md §1; docs/DESIGN_SYSTEM.md.

## Sources & confidence

⚠️ **NO SCREENSHOTS.** The owner chose on 2026-08-29 to proceed on web research
alone, as with `alerts/`, `report-bug/` and `inbox/`, and chose the same again
on 2026-09-04 for the WhatsApp pass. Every measurement of another product below
is **reported** or **inferred**; the pt values are OUR translation of a described
structure, never their numbers.

⚠️ **A SECOND REFERENCE PRODUCT LANDED 2026-09-04**: **WhatsApp**, at the owner's
request, scoped to the conversation and the Messages list. It is not an Airbnb
screen and the two disagree about where a timestamp lives and what a day
separator is. Where they conflict, **WhatsApp wins for the bubble's meta and the
day separator**; everything else in this file is still measured against Airbnb.
Rows it supersedes are struck through rather than deleted, so a reader can tell
a reversal from a gap. The full record is in `GAP_ANALYSIS.md` § "Second pass".

⚠️ **ITS TRADE DRESS IS EXCLUDED ON THE USUAL BASIS** — the green above all, plus
its typeface and icon set. ADR-0006 makes this app monochrome and the owner
confirmed it holds. We take structure, rhythm, anatomy, motion feel. Note what
that removes: after the green and the tail (owner's call), and with peer avatars
permanently impossible, **most of what makes WhatsApp recognisable was off the
table before the pass began** — which is why it amounts to four changes and a
long list of noes rather than a redesign.

⚠️ **THE ANALOGUE IS CLOSE, WHICH IS THE TRAP.** Airbnb's thread is a near-twin
in structure — two parties, one listing, one conversation — and diverges in the
one place that matters most: theirs is hospitality between a host and a booked
guest, a relationship with a contract behind it. Ours is two strangers brought
together by a crime, where the governing rule is *report, don't approach*. Copy
that transfers is a coincidence, not a pattern.

| Their surface | Fit | Verdict |
|---|---|---|
| Guest–host message thread | Two parties, listing context, quick replies | **The twin.** Our car is their listing |
| Reservation "Details" link | Context available, not permanent | The spatial argument we borrow |
| In-thread action cards | Keeps the workflow contained | Structure noted, not adopted — we have no actions to card |

Confidence: **high** on the spatial principle (the conversation dominates;
context is reachable rather than resident) — it is consistent across every
Airbnb surface studied. **Low** on thread-specific geometry: no measurement of
their bubble radii, header height or padding exists in any source found.

Trade dress excluded by rule: Rausch `#FF385C`, Cereal, their icon set, their
verbatim copy. We take structure, rhythm, anatomy, motion feel.

Sources:
- [Airbnb Resource Centre — Getting the most out of the Messages tab](https://www.airbnb.com/resources/hosting-homes/a/getting-the-most-out-of-the-messages-tab-678) — read receipts; the filter vocabulary.
- [Zeevou — Where is my Airbnb inbox](https://zeevou.com/blog/where-is-my-airbnb-inbox/) — **"Details" is a link in the thread's top-right corner**, carrying dates and payout; a flag action for suspicious messages.
- [CometChat — Beyond the bubble: Airbnb](https://www.cometchat.com/blog/beyond-the-bubble-airbnb) — tapping the **profile picture** opens the peer's profile; in-thread prompts keep the booking workflow contained; **phone-number masking** to keep conversations on-platform; photo sharing gated to post-booking; reported absences — no typing indicators, no search, no edit.
- [AlternativeTo — Airbnb 2025 app redesign](https://alternativeto.net/news/2025/5/airbnb-app-redesign-adds-services-booking-trip-planning-and-upgraded-messaging) — photo and video in messages; "modular components, animated states".

⚠️ **A conflict, recorded rather than resolved:** one source describes editing
within 15 minutes and unsending within 24 hours; another states there is no edit
capability at all. Nothing in this spec depends on either.

## 1 — What this screen is for

| Observation | Note |
|---|---|
| Its job | Let an owner and a spotter agree what was seen, where, and what happens next |
| Its user | Someone whose car was stolen this week, or a stranger who chose to help them |
| Emotional context | Suspense and obligation. **Not hospitality** |
| Success | The two of them work out whether this is the car, without either going near it |
| The stake | The one screen where a recovery is actually negotiated |

### ⚠️ Emotional translation — the one place we must diverge

Airbnb's thread is warm because a booking is a welcome. Ours carries "I think I
saw it on Bath Road" between people who have never met, one of whom is
frightened. So we take the **spatial** argument — the conversation is the
screen, context is reachable rather than resident — and refuse the sociability:
no reactions, no read-receipt richness, no playfulness, and above all no
affordance that could read as *go and look again*.

The existing copy already does this and **this pass changes none of it.** The
quick replies in particular were written under a safety review: "was it still
there when you left?" is past tense on purpose, because "is it still there?"
invites a spotter to go and verify.

## 2 — How much of the screen the conversation gets

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| The conversation dominates | Context behind a link, not a permanent strip | reported | — |
| One identity row | Header names the peer; the listing is a picture | reported | `sizes.threadHeaderTile` (44) **NEW** |
| Chrome budget | — | house rule | **≤30% at rest** ✅ **NEW for this screen** |
| Screen gutter | 24 everywhere, including the bubble column | house rule | `spacing.xl` ✅ |
| Composer comfort | Untouched — it is the thing you use while distressed | house rule | `sizes.touchTarget` (44) ✅ |

⚠️ **The number is the spec.** At rest this screen was 393.5pt of chrome on an
852pt phone — **46%** — and with the keyboard up it left ~216pt, under four
message bubbles. Any change here is measured against that, not against taste.

## 3 — The header

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| The peer is the title | Their header names the guest | reported | `typography.cardTitle` ✅ |
| The listing is the picture | Photo leads | reported | `AppImage` / `CarColourTile` at 44 ✅ |
| Two targets in one row | Picture → person, words → booking | reported | — |
| Context is one line | — | inferred | `typography.caption` @ `textSecondary` ✅ |

⚠️ **WE INVERT THEIR CURRENCY, because we have to.** Airbnb's picture opens the
person and their words open the booking. We can never have a photograph of the
person — the avatar path embeds their uid, so the API withholds it by design —
so our picture is the *car* and it opens the *post*, and the profile becomes an
explicit trailing button. An initial-letter circle in the leading slot would be
spending the most valuable position on a letter.

## 4 — Bubbles

| Observation | Reference | Confidence | Nearest token |
|---|---|---|---|
| Grouped runs | Consecutive messages read as one thought | inferred | `groupPos` + `blockPaddingTop` ✅ |
| Within-run gap vs between-run | — | inferred | 4 vs 12 — `spacing.xs` / `spacing.md` **NEW** |
| Bubble radius | Rounded, not pill | inferred | `radii.lg` (16) ✅ |
| Incoming has a boundary | — | house rule | `surface` + hairline ✅ |
| Timestamps are sparse | Grouped, not per message | inferred | `caption`, first-of-day or >15min ✅ |

⚠️ **The grouped corners were invisible before this pass.** Every bubble sat in
a symmetric 8pt, so corners tightened and nothing drew closer — the grouping
existed in code and not on screen.

⚠️ **An incoming bubble had no edge at all.** `surfaceSubtle` on `background` is
about 1.06:1; mine was a hard near-black. One side was a shape and the other was
a stain, which is most of what "the bubbles look plain" meant.

## 5 — Deliberately not adopted

| Their move | Why not |
|---|---|
| Photo and video in messages (2025) | `ChatMessage` has no attachment field, and the moderation, storage and safety consequences are a product decision, not a design pass's |
| Threaded replies, edit, unsend | All need schema |
| Reactions | Same, and the register is wrong — this is not a chat with a friend |
| Read receipts per message | We have one thread-level marker and render one honest "Seen". ⚠️ Re-examined 2026-09-04 for WhatsApp's double tick and refused again, on stronger grounds: a glyph would be legal under the never-colour-alone rule, but a tick on one bubble and not its neighbours asserts a PER-MESSAGE fact the schema does not carry. The word is the only true rendering |
| Typing indicators | Airbnb has none either, and it would mean a realtime channel the feature deliberately avoids |
| Phone-number masking | A real idea, and out of scope for a design pass — flagged for its own look |
| A "Details" text link | The car photo already is the link; a word beside it would be a second one |
| Scroll-collapsing header | ⚠️ **The gesture runs backwards here.** A thread opens at the bottom, so the only scroll available is upward into history — precisely when you most need to know which car and who |

## Proposed token additions

| Token | Value | Justification |
|---|---|---|
| `sizes.threadHeaderTile` | 44 | The car in a thread header. Not `inboxRowTile` (64): a list row uses the picture to tell conversations apart, a thread is already inside one, and it should match the 44pt controls either side |
| `sizes.safetyStripRow` | 28 | The collapsed safety row. Replaces `touchTarget - 2 * spacing.sm`, a derivation that silently stopped meaning anything when the padding changed |
| `blockPaddingTop()` | 4 / 12 / 0 | Not a token but the same kind of decision: within-run, between-run, and after a separator that already pads itself |
| `colors.textOnPrimaryMuted` | `#949494` / `#5E5E5E` | ⚠️ **Added 2026-09-04 for the in-bubble timestamp.** `textOnPrimary` was the only sanctioned ink on a `primary` fill, and at ~17:1 it makes metadata shout as loudly as the message; every other surface has `textSecondary` for exactly this. Cannot be one value — `primary` inverts between schemes. **Not an opacity**: white at `opacity.inactive` over `#1A1A1A` is ~3.4:1 and at 0.6 is ~4.30:1, both under the text floor, and `colors.test.ts` cannot re-derive a runtime alpha. Measured 5.74:1 / 5.79:1 |
| `formatClock()` | — | Not a token, but the same kind of decision: the inbox row was about to be the THIRD hand-rolled copy of one `toLocaleTimeString` call. Extracted to `shared/lib/dateTimeLabel.ts`; `formatDateTimeLabel` and the bubble's meta both consume it, and a test pins that they agree |
| (no new radii or type) | — | The existing scale covers everything; the incoming bubble and the day chip both use `surface` + the standard hairline |
