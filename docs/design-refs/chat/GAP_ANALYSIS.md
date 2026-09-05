# Gap analysis — chat thread

WHAT: Every divergence between the chat thread as it stood on 2026-08-29 and
      ./REFERENCE_SPEC.md, with what was done about each.
WHY:  So the redesign can be checked rather than asserted, and so the things
      deliberately NOT done are recorded as decisions rather than oversights.
LINKS: ./REFERENCE_SPEC.md; src/features/chat/screens/ChatThreadScreen.tsx;
      src/features/chat/components/ThreadHeader.tsx;
      docs/SECURITY_AND_TRUST.md §1.

## The arithmetic, which settles most of the arguments

iPhone 14 Pro, 852pt, insets 59/34, open thread, notice collapsed:

| | Before | After |
|---|---|---|
| top inset | 59 | 59 |
| header row | 72 | **60.5** (one row) |
| car strip | 64 | — (merged) |
| SafetyNotice | 44 | **0** — removed entirely, see #19 |
| QuickReplyRow | 60 | **0** after the first reply (52 before it) |
| composer | 60 | 60 |
| bottom inset | 34 | 34 |
| **chrome** | **393.5 (46%)** | **213.5 (25%)** |
| conversation | 458 | **638.5 (+39%)** |
| **with the keyboard up** | **216 ≈ 3.8 bubbles** | **~336 ≈ 6 turns (+56%)** |

⚠️ **This table was wrong for an hour and said 30%.** #4 (the safety strip
shrink) was reverted and then #19 removed the strip altogether, and the totals
above were not recomputed either time — in a file whose own closing line reads
"a wrong number in a safety file is worse than no number, because the next
person reads it instead of measuring". Recomputed 2026-08-29 after review.

No animation is required to obtain any of that.

| # | Gap | Ours (before) | Reference | Fix | Size | Impact | Done |
|---|---|---|---|---|---|---|---|
| 1 | Two rows of identity for one conversation | person header (72) above a car strip (64) | One header; context reachable, not resident | `ThreadHeader`: back · car photo · name · car + state · owner-only profile button | L | **Highest** | ✅ |
| 2 | Grouped corners were invisible | symmetric `paddingVertical: xs`, so every bubble was 8pt from its neighbour whatever the grouping said | Runs read as one thought | `blockPaddingTop` — 4 within a run, 12 between, 0 under a separator | M | **Highest** | ✅ |
| 3 | An incoming bubble had no boundary | `surfaceSubtle` on `background` ≈ 1.06:1, against a hard near-black for mine | Both sides are shapes | `surface` + hairline, the house flat-card recipe | S | **High** | ✅ |
| 4 | The safety strip was 44pt of band | 8 + 28 + 8 | — | ⚠️ **Attempted and reverted — see #12.** It stays 44 | S | — | ❌ |
| 5 | Quick replies were permanent chrome | shown whenever the draft was empty — which is the resting state | — | `shouldShowQuickReplies`: until you have spoken | S | High | ✅ |
| 6 | The composer jumped when the row left | an entrance, no exit | "animated states" | `FadeOut` + `LinearTransition` on the wrapper | S | Medium | ✅ |
| 7 | A tone step at the very top | `background` behind the status bar, `surface` below it | One continuous object | `edges={['bottom']}` + `paddingTop: insets.top` on the header block | S | Medium | ✅ |
| 8 | Owner and spotter headers looked identical but behaved differently | a Pressable for one, a plain View for the other | — | An explicit profile button, present or absent | S | Medium | ✅ |
| 9 | A screen reader could not get a message's time | drawn above one bubble per group only | — | The time is in every bubble's label | S | Medium | ✅ |
| 10 | The time caption looked like a day separator | centred grey caption, like the day rule's label | — | Side-aligned to the speaker | S | Low | ✅ |
| 11 | Loading and error states were a lone back button | `headerIdentity` rendered `null` | — | A header-shaped skeleton, and a degraded row that keeps "Conversation" + "Try again" | M | Medium | ✅ |

**The three that closed most of the gap: #1, #2, #5.**

## Found by the security-reviewer, after the first build

| # | Finding | Fix |
|---|---|---|
| 12 | ⚠️ **The safety strip's 44pt target was fiction.** Shrinking the band to 36 and adding `hitSlop` gave a nominal 44 — but hit-testing walks siblings in reverse draw order, and the branch container drawn AFTER the strip claims any touch below it. The lower 4pt of slop was dead, so the real target was **40** — smaller AND harder to hit, on the one control that is a sighted user's only route to the "call 999" clause | Band restored to 44 drawn, `hitSlop` removed. The 8pt came from the message list's own `paddingVertical` (md→sm) instead, where nothing depends on it. On a safety control an actual 44 beats an arithmetic one |
| 13 | **The test that "pinned" the target asserted a prop.** `expect(props.hitSlop).toBe(4)` would have passed with the band at 0, with the slop occluded, or with `minHeight` deleted — it could not fail for any reason that mattered | Asserts the composed geometry instead: `paddingVertical * 2 + safetyStripRow >= touchTarget` |
| 14 | **The safety strip had no edge either.** `surfaceSubtle` on `background` is ~1.06:1 — the same defect this pass fixed for incoming bubbles, left in place on the element the fix exists to protect | A bottom hairline; the top edge is the header's own |
| 15 | ⚠️ **The quick-reply row flickered back after every send.** The predicate read `messages`, which only fills on RPC confirmation, while a sent message lives in `outgoing` — so the draft cleared, the row faded back in, and faded out again. Exactly the composer jump #6 was added to prevent. Worse: a FAILED send never reaches `messages`, so the row returned for good and sat under a bubble reading "Not sent" | The predicate takes `outgoing` too |
| 16 | **The report sheet never said which message it was about**, now that bubbles in a run sit 4pt apart — a mis-aimed long-press silently flags the neighbour, on the only moderation route a person has | The message is quoted back in the sheet, one line. On screen only: `flagMessage` still sends the id and logs no content |
| 17 | **`numberOfLines={2}` could truncate the actionable half** at large type — and §1 requires the visible half to BE the instruction | Removed; the strip grows instead, which can only make the notice larger |
| 18 | **`sizes.safetyStripRow`'s justification was arithmetically false** — "two lines of `label`" is 36, not 28. The refactor kept the old derivation's number and invented a new reason for it | Comment corrected: 28 is one line plus air, and the row grows when the title wraps |

⚠️ **Two of these (#12, #18) were false claims in comments, not just code defects.**
A wrong number in a safety file is worse than no number, because the next
person reads it instead of measuring.

## Owner decision, after using it (2026-08-29)

| # | Change | What it touched |
|---|---|---|
| 19 | **The SafetyNotice is gone from the chat thread**, and the automatic "Safety first…" system message with it | `ChatThreadScreen.tsx`; `20260829120000_thread_without_system_message.sql` |

⚠️ **This relaxes the app's one documented safety control, and the doc moved
with it.** `SECURITY_AND_TRUST.md` §1 named the chat thread specifically and a
security review had made the notice unconditional. §1 is rewritten rather than
quietly ignored — a repo that asserts a control it does not implement is worse
than either choice on its own. The test that asserted the notice's presence now
asserts its absence, with the reasoning, so the next reader sees a decision
rather than an oversight.

⚠️ **Scope, deliberately narrow.** The safety rule still reaches five surfaces:
the COMPONENT renders on four (the sighting wizard, post sightings, sighting
detail, post detail) and onboarding carries the COPY — `onboardingSlides.ts`
imports `SAFETY_RULE_LINE` and `OnboardingSlide.tsx` renders it as a
warning-bordered pill, 999 clause deliberately omitted at that stage. Between
them they cover the moment someone is deciding whether to go and look at a car.

⚠️ **I got that wrong once, in the safety doc, while reducing safety coverage.**
Auditing with `grep "<SafetyNotice"` I concluded onboarding was not a surface
and wrote that into §1 — deleting a true statement about coverage in the same
change that removed a surface. The copy travels through a prop, so the component
name never appears at the render site. Both reviewers caught it independently.
The lesson is in §1 now: that grep is not the audit. The quick-reply safety register (no meeting, following,
waiting, watching, approaching) and its lexicon test are untouched, as is the
ban on features that facilitate pursuit.

⚠️ **Nothing was deleted from history.** The migration changes `open_thread`
for new threads only; every existing conversation keeps its stored system
message. `chat_verification.sql` gained CHECK 1b to assert exactly that, because
"we did not do the destructive thing" is the kind of claim that needs a test.

⚠️ **A consequence, handled: a thread can now be empty.** It never could be
before — the server opened every one with that message — so the screen had no
empty state. Without one, the first thing a spotter saw after tapping "Message
the owner" would have been a blank rectangle. It now says "No messages yet. Say
what you saw, and where."

## Deliberately not done

| # | Thing | Why not |
|---|---|---|
| A | Collapse-on-scroll header | ⚠️ **The gesture runs backwards.** A thread opens at the bottom (`maintainVisibleContentPosition`), so the only scroll is upward into history — exactly when you most need to know which car and who. And with the header already at 60.5, collapsing to back+name saves **half a point** |
| B | A "Details" link top-right | The car photo already is that link; a word beside it would be a second one, and it would cost the subtitle 50pt of a 375pt row |
| C | `radii.xl` bubbles | ~~At 24 a single-line 48pt bubble is a near-pill, and it would be the only 24pt radius on a screen of 16s~~ ⚠️ **This reason went stale — see "Second pass" for the one that replaces it.** Still not done |
| D | Shrinking the composer | It is the one thing here that must stay comfortable to hit while distressed |
| E | Promoting `ThreadHeader` to shared/ui | One consumer |
| F | Any new gesture on bubbles | Long-press is the report path, and it is the only moderation route a person has |
| G | Animating confirmed sends, history, or the skeleton | All deliberate, all pre-existing, all still right — an animated optimistic→persisted swap reads as a double send |

## Verify before trusting

1. **Both themes.** The incoming bubble's new hairline is a *separator* weight
   (`border` ≈ 1.25:1 on light), not a 3:1 graphic. If it reads too soft at
   bubble scale the escalation is `borderStrong`, but that will be loud on every
   incoming message. Check before deciding.
2. **200% text.** The header's 60.5 is a 100%-type figure; the subtitle grows
   and the row goes to ~90. That is correct — the car is content, not chrome —
   but do not quote 60.5 as a guarantee.
3. **The report path**, now that runs are 4pt apart: long-press an incoming
   bubble in a tight run and confirm you get the right one. Internal padding was
   deliberately NOT shaved, so the target stays ≥48pt tall.
4. **Android keyboard**, gesture and 3-button nav — still unverified from the
   inbox pass, and this screen is where it matters.
5. **The safety notice at 36pt** — it is pinned, undismissable, `role="alert"`,
   and reads in full to a screen reader in both states, and
   `SafetyNotice.test.tsx` asserts every one of those. What a test cannot tell
   you is whether it still *feels* unmissable. Look at it.
6. All states: loading, meta error, missing, closed thread, failed send, and a
   thread whose post has no photo.

---

## Second pass — the WhatsApp structure pass (2026-09-04)

Everything above is measured against Airbnb's guest–host messaging. The owner
then asked for the messaging screens in **WhatsApp's design language**, scoped to
the conversation and the Messages list. Their decisions, made before any code:
**stay fully monochrome**, **no screenshots** (web research only), **no tails**,
**a plain tinted ground rather than a pattern**, **the time inside the bubble**,
**keep the inbox row's third line**.

⚠️ **This pass has no evidence behind it, and that is worth stating.** The
onboarding rebuild was justified by a number (1 completed run against 6 skipped).
This one is taste — a legitimate reason on one's own product. Chat already emits
`thread_opened` and `message_sent`, and since the telemetry sink landed those
reach `record_telemetry_events`, so ten testers would give this screen real data
within days.

### What the reference actually had to offer

WhatsApp's structural signature, ranked by recognisability: **(1)** the tail,
**(2)** the green, **(3)** inline bottom-right meta with the last line reserving
space for it, **(4)** a floating centred date chip on a wallpaper, **(5)**
avatar-led two-line rows with the unread pill bottom-right, **(6)** an
icon-dense composer, **(7)** near-pill bubble radius.

1 and 2 were ruled out by the owner and by ADR-0006. 5's avatar is **impossible**
— `chatApi` `.strict()`-parses the peer block and a test fails if `avatar_path`
appears, because the path embeds the peer's uid. 6 is empty once attachments,
camera, mic and emoji are all out of scope by spec and schema. 7 fails on
geometry (below). **That leaves 3 and 4**, which is what shipped, plus two
adjacent wins the pass surfaced on the way past.

| Was | Now | Why |
|---|---|---|
| Conversation on `background` | On `surfaceSubtle` | The structural half of a wallpaper. Incoming bubble separation went ~1.07:1 → ~1.16:1 light and ~1.10:1 → ~1.16:1 dark. ⚠️ Forced the loading skeleton to `surfaceSubtlePressed` — it had been `surfaceSubtle`, which is now the ground |
| Ruled divider for the day | A centred `surface`+hairline chip | Same recipe as an incoming bubble, which is what the reference does; centring, `caption` and `radii.full` keep them apart. +8pt per separator, accepted |
| Sparse time caption above a run | Every bubble carries its own time, bottom-right inside it | Also closes a real defect: most messages showed no time at all to a sighted reader, and gap #9 had fixed that only in the a11y label |
| `Seen` as its own caption below the bubble | Rides the meta: `14:32 · Seen` | Same thread-level claim, one row less |
| `Sending…` as its own caption | Occupies the meta slot the time will fill | The optimistic→persisted swap becomes a text substitution with **no reflow**, which serves item G rather than fighting it |
| Inbox row `timeAgo` ("2h ago") | A clock ("14:32") | `InboxScreen` already day-groups, so `timeAgo` was a second answer: "2h ago" under **Today** is redundant, "3d ago" under **23 July** contradicts it |
| Composer `arrow-up` | `send` | The up-arrow is now the LLM prompt-box convention; every messaging app uses a directional glyph |

**Chrome budget untouched at 25.1%** — nothing here is chrome.

**One new token**: `textOnPrimaryMuted` (5.74:1 light / 5.79:1 dark, re-derived in
`colors.test.ts`). `textOnPrimary` at ~17:1 was the only sanctioned ink on a
`primary` fill, and it makes a timestamp shout as loudly as the message. ⚠️ Not
an opacity: white at `opacity.inactive` over `#1A1A1A` is ~3.4:1 and at 0.6 is
~4.30:1 — both under the floor, and `colors.test.ts` cannot see a runtime alpha.

### Added to "Deliberately not done"

| | | Why |
|---|---|---|
| H | **Bubble tails** | Owner's call, and the system already answers it: run-facing corners tighten to `radii.sm` and block padding is 4pt within a run against 12pt between. The corner is doing the tail's job |
| I | **`radii.full` bubbles** — ⚠️ **the replacement reason for item C** | C's original argument has gone stale: WhatsApp's 2026 redesign moved deliberately *toward* the near-pill, and `radii.full` is already on this screen (the composer), so it is not a novel radius. It still fails for a better reason — **RN clamps `9999` to half the box height, so the radius varies with CONTENT**: ~24pt on a one-line bubble, ~36pt on a three-line one. Tightening one corner to `radii.sm` against a 36pt sibling is not a legible relationship. With no tail, the corner *is* our entire grouping signal |
| J | **Per-message ticks** | ⚠️ A data claim, not a taste. A glyph would be legal under the never-colour-alone rule and is still wrong: our marker is THREAD-level, so a tick on one bubble and not its neighbours asserts a per-message fact the schema does not carry. `messageGroups.ts` already forbids the rendering claiming more than the marker. The word "Seen" is the only true rendering |
| K | **A patterned wallpaper** | Ours would have to be monochrome, and a patterned grey field is this app's LOADING SKELETON — the charge that killed the first onboarding hero. Wrong register too: doodles behind a conversation about a stolen car. Note the reference's wallpaper mainly exists to make a GREEN bubble read as an object; ours is `primary` near-black at ~16:1 and already unmistakable |
| L | **Moving the unread badge bottom-right** | `sizes.unreadSlot` is a FIXED 26pt slot, and `ThreadRow` shares one silhouette with `NotificationRowItem`. Costs the Notifications face for cosmetics |
| M | **Two-line inbox rows** | Owner's call, and the right one: the context line is what we have INSTEAD of an avatar. Drop it and an owner with three posted cars cannot tell three threads apart |
| N | **`✓ your reply` preview prefix** | Schema, not design. `InboxThread` carries no sender field; it needs a new column on `get_inbox` |
| O | **Hiding send until there is text** | The reference can, because a mic occupies that slot when the box is empty. We have nothing to swap to, so the pill's width would jump on the first keystroke — item D in a new costume |

### ~~Consequence accepted, not fixed~~ — resolved 2026-09-04/05

⚠️ ~~**The two inbox faces now format time differently.** Messages draws a clock;
Notifications still draws `timeAgo`.~~

**Closed in two halves.** The DRAWN half went when both lists were flattened —
with no header above a row to say the day, one shared `formatListStamp` ladder
had to serve both faces. The SPOKEN half survived it unnoticed for a day:
`NotificationRowItem`'s accessibility label was still built from `timeAgo` while
its row drew the stamp, so the divergence had simply moved one layer down where
nobody looks. Caught by the code review of 2026-09-05 and moved to
`formatDateTimeLabel`, matching `ThreadRow`.

⚠️ Worth keeping as a pattern rather than an anecdote: **a fix applied to the
drawn layer is not finished until the spoken layer is checked.** The same review
found "Seen" had gone silent for the same reason — it moved inside a bubble
whose explicit `accessibilityLabel` replaces everything its children say.
