# Gap analysis — alerts

WHAT: Every divergence between the alerts screen as it stood on 2026-08-27 and
      ./REFERENCE_SPEC.md, with what was done about each.
WHY:  So the redesign can be checked rather than asserted, and so the things
      deliberately NOT done are recorded as decisions rather than oversights.
LINKS: ./REFERENCE_SPEC.md; src/features/notifications/screens/AlertsScreen.tsx.

| # | Gap | Ours (before) | Reference | Fix | Size | Impact | Done |
|---|---|---|---|---|---|---|---|
| 1 | Empty state under-sold the core loop | `"No alerts yet"` + a two-line body + **ghost** button | Explain the feature, native illustration, one unmissable CTA | Solid primary, glyph illustration, copy naming frequency **and** the privacy guarantee | S | **Highest** | ✅ |
| 2 | No section rhythm | one flat `gap: spacing.lg` for primer, notice, rows, button and footnote alike | 32 between sections, tighter within a set | `spacing.xxl` between groups, `spacing.md` between cards | M | **Highest** | ✅ |
| 3 | Rows were five identical grey blocks | no icon, no image, no border | Picture leads the card | `AlertZoneThumb` (72pt map over a drawn plate) | L | **Highest** | ✅ |
| 4 | No back button | bare `<Text>Alerts</Text>` | Always escapable | House header row, **outside** the state switch | S | High | ✅ |
| 5 | Permission primer was a full *page* inlined in a card | ~265dp primer + a ~70dp prose notice above the list | Compact, one action | `AlertPermissionBanner` on `NudgeRow` (~64dp), notice folded in | M | High | ✅ |
| 6 | Three controls in one card | switch + ghost "Edit" + ghost "Delete" | Secondary actions behind one affordance | Card press → edit; "⋯" → sheet; switch stays | M | High | ✅ |
| 7 | "Paused" indistinguishable from the summary | both `caption`/`textSecondary` | Status reads as status | `typography.label` (Medium) | S | Medium | ✅ |
| 8 | Delete looked exactly like Edit | ghost button, no danger tone | Destructive is marked | `destructive` `ListRow` in the sheet | S | Medium | ✅ |
| 9 | Spinner on a list | `FullscreenLoader` | Skeletons | Two skeleton rows mirroring the card's geometry | S | Medium | ✅ |
| 10 | At-cap CTA was dead | `disabled` "Limit reached (5)" | — (house rule) | Stays tappable, toasts the reason | S | Medium | ✅ |
| 11 | Not using `Screen` | `SafeAreaView` from **react-native** — a plain View on Android, no inset | — | `Screen` | S | Medium | ✅ |
| 12 | Signed-out state had no way in | title + body only | — | "Log in" → `requireAuth({ context: 'alert_settings' })` | S | Low | ✅ |
| 13 | Dead copy | `secondaryLabel: 'Not now'` declared, `onSecondary` never wired, so it never rendered | — | Removed with the primer | S | Low | ✅ |
| 14 | Cards had no boundary in dark | `surface` on `background` = #1E1E1E on #141414 | Hairlines, not shadows | `StyleSheet.hairlineWidth` + `border` | S | Medium | ✅ |

**The three that closed most of the gap: #1, #2, #3.**

## Deliberately not done

| # | Thing | Why not |
|---|---|---|
| A | A match-count preview on each alert | **The data does not exist.** `useAlertReach` answers an owner-side question ("how many spotters would a post reach") and is superseded dead code. Promising a number we cannot compute would be worse than silence |
| B | A static map image instead of a live one | The Google Maps keys are **build-time native and application-restricted**, which the Static Maps web API rejects; it would need either a public scrapeable key or an Edge Function proxy, and Static Maps has no circle primitive so the radius would become a hand-encoded polyline. Recorded as the escape hatch if iOS memory proves fatal |
| C | A header `+` instead of the sticky CTA | Arguable, and `MyCarsScreen` — the sibling screen whose cap of 5 this deliberately mirrors — uses a header `+`. The sticky bar was the approved plan; worth revisiting together with that screen rather than diverging here |
| D | `StatusPill` for "Paused" | Its badge fills with `c.surface`, which is exactly this card's colour, so it would silently render as a bare dot and label — acceptable by accident, not design. A surface-aware pill is a shared/ui change |
| E | Swipe-to-delete | Undiscoverable, weaker on Android, and the house has no precedent |
| F | An illustration library | This is the app's second `EmptyState` illustration in ~35. A composition of tokens avoids starting one on this screen |

## Found by the ui-reviewer, after the first build

| # | Finding | Fix |
|---|---|---|
| 15 | **The card collapsed at 200% text.** Two fixed-width neighbours (72pt tile, ~95pt controls) left the text ~127pt; `flex: 1` is basis-0, so the name rendered ~4 characters | Stacks above `listRowStackFontScale` — controls drop to their own row |
| 16 | **The switch and "⋯" were unreachable to VoiceOver on iOS.** `Pressable` is `accessible` by default and iOS groups its children, so pause and delete existed on Android and not on iOS | One element with `accessibilityActions` (`pause`, `more`) + `accessibilityState.checked`; the controls are hidden from the tree |
| 17 | **The switch's own target was ~31pt, and a near-miss navigated** — the parent caught it and opened the editor | Wrapped in a `sizes.touchTarget` box |
| 18 | **Light-mode glyph was 2.15:1**, under the 3:1 graphic floor (dark was fine at 3.34:1) | Ring stroke moved to `borderStrong` — the token whose job is "small elements that must stay visible". `mapZoneFill` keeps the fill |
| 19 | Empty-state CTA sat 64pt below the body (48 from `EmptyState` + 16) and stretched full-width under centred inset text | New `EmptyState.actionVariant` — the override lives in the primitive now, so the next screen inherits the rhythm |
| 20 | Loading → ready shifted 8pt; the comment claimed it didn't | `body` takes `scroll`'s `paddingTop`; skeleton gap and padding match the card exactly |
| 21 | Card padding was 12 against the documented 16 | `spacing.lg` |
| 22 | The "⋯" `hitSlop` overlapped the switch and won those 4pt | Dropped — the button is already 44pt |
| 23 | The thumbnail lost its edge on press (frame and pressed card are both `surfaceSubtle`) | Hairline on the frame |
| 24 | The header comment described a `StatusPill` the card doesn't render | Comment corrected |

⚠️ **One left open deliberately: the card has no shadow, and `DESIGN_SYSTEM`'s
Card entry still specifies `shadows.soft`.** All five previous Airbnb passes
also shipped cards flat, so code and doc now disagree across six screens. That
is a rulebook decision, not one to settle inside this feature — flagged rather
than silently resolved either way.

## Verify before trusting

1. **Five thumbnails on a real Android device** — the whole reason `SHOW_MAP`
   exists. Lite mode renders a bitmap rather than a `GLSurfaceView`, which is
   what makes a rounded clipped tile safe, but it has not been seen on hardware.
2. **Five on a real iOS device** — no lite mode there; the focus gate drops them
   while the wizard is on top, and the bounded cap of 5 is the other mitigation.
3. **Dark mode** — lite mode must still honour `customMapStyle`, or the tile
   shows a light basemap over a correctly themed plate.
4. **200% text** — the card carries a press target, a switch and a "⋯" beside a
   72pt tile.
5. All six states: loading, error, signed out, empty, populated, at cap.
