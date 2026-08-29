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
| SafetyNotice | 44 | 44 (see #12) |
| QuickReplyRow | 60 | **0** after the first reply (52 before it) |
| composer | 60 | 60 |
| bottom inset | 34 | 34 |
| **chrome** | **393.5 (46%)** | **257.5 (30%)** |
| conversation | 458 | **594.5 (+30%)** |
| **with the keyboard up** | **216 ≈ 3.8 bubbles** | **~292 ≈ 5 turns (+35%)** |

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

## Deliberately not done

| # | Thing | Why not |
|---|---|---|
| A | Collapse-on-scroll header | ⚠️ **The gesture runs backwards.** A thread opens at the bottom (`maintainVisibleContentPosition`), so the only scroll is upward into history — exactly when you most need to know which car and who. And with the header already at 60.5, collapsing to back+name saves **half a point** |
| B | A "Details" link top-right | The car photo already is that link; a word beside it would be a second one, and it would cost the subtitle 50pt of a 375pt row |
| C | `radii.xl` bubbles | At 24 a single-line 48pt bubble is a near-pill, and it would be the only 24pt radius on a screen of 16s |
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
