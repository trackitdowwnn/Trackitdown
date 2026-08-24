# Feature: auth

Sign up / sign in, session handling, onboarding, and the deferred-auth gate.
**One passwordless path: sign-up == sign-in** — email OTP plus native
Apple/Google — and **one auth surface: the AuthSheet**, which appears only at
the moment an action needs an account (Airbnb's pattern). Guests browse the
feed, map, and post details freely; the sheet is calm and quick (~20s) because
it stands between a theft victim and posting their car.

## Onboarding (first slice)

Four calm slides shown once on first launch (what-this-is → post → spot-and-
report-from-a-distance → recovered), stepped one at a time. Re-viewable via
`/onboarding?revisit=1` ("How Trackitdown works" in settings). Local AsyncStorage
flag `trackitdown.onboarding_seen_v1`.

**Restyled 2026-08-08** against `docs/design-refs/onboarding/ob1.webp`. Three
progress indicators became one: dots, a numbered step rail ("01 Post") and a
separate button collapsed into a single **ring FAB** (`OnboardingRingFab`) that
is both the progress and the control. The step names went with them — they
restated the headline directly above. Skip moved from top-right into the footer
beside the ring, matching `shared/wizard/WizardFooter`'s grammar. The last slide
alone keeps a full-width button: "Get started" is a commitment and should be
read, not inferred from an arrow. Headlines now alternate **weight**
mid-sentence (Satoshi-Black against Regular) where they used to mark a trailing
phrase in an accent colour that, at #1A1A1A on #222222, was invisible.

**It steps; it does not swipe.** Slides move with the same Reanimated layout
animations as `shared/wizard/WizardScreen` — same SlideIn/SlideOut pair, same
250ms ease-out — so the app's two stepped flows feel like one product. That
meant knowingly giving up the horizontal pager: layout animations move a step
between two settled states, which is a different idea from tracking a finger,
and running both would put two systems on the same position mid-drag. Advance
with the ring; Android back steps back.

**The hero above the words, third attempt (2026-08-23).** Two had come and
gone. First a placeholder emoji in a grey circle per slide (🚗 📣 📸 🎉), which
read as unfinished, told four unrelated stories and — on the recovery slide —
celebrated with confetti at someone whose car had just been stolen. Then, from
2026-08-06, a UK registration plate drawn in code and pinned above the pager,
whose stamped status changed as you swiped: Reported → Broadcast → Sighted →
Recovered. It lasted two days and did not earn the room; it went on 2026-08-08
with `OnboardingPlate`, the per-slide `stamp`, and the demonstration plate
constant. For two weeks what replaced it was nothing — the headline took the
space at 40pt.

What is there now is **`OnboardingMap`**: an abstract map field with pins,
drawn in SVG. Three things make it a different proposition from the two that
failed, and if it is ever removed the reason should be measured against them:

1. **It is the subject, not an accompaniment.** A map of stolen cars near you
   is what the product IS. The emoji were decoration and the plate was an
   illustration of a step; this is the thing itself.
2. **It answers the complaint the copy could not.** The flow opened on "Your
   car, stolen? Post it." — the middle of a story, to a reader who has never
   heard of us. A map full of pins says "noticeboard for stolen cars" before
   the first sentence is read.
3. **It does not remount per slide.** It sits OUTSIDE the keyed stage, so the
   words step over a map that persists and morphs through four states
   (`scatter → posted → alerted → recovered`). `OnboardingSlide`'s own header
   rejects per-slide artwork because "a thing sliding while its own contents
   did something else" reads wrong — one continuous map is the shape that
   answers it, and it is why the slides now read as one car's story rather
   than four pictures.

It is **abstract, not cartographic**, on purpose: a real map means a real
place, and on first launch we have neither location permission nor any business
asking. It also still owns no image assets — this is SVG, like the wash and the
ring — so "no illustration assets to do it honestly" remains true and remains
the reason there is no photograph here.

**The alert slide was absorbed, not deleted.** "People nearby get alerted." had
its own screen; the map now shows it, as rings reaching the other pins, and the
sentence moved into the post slide's body. That kept the flow at four once the
premise slide was added — a screen whose only job is to say what the picture is
already doing is a screen to cut.

The reference is lilac and leans on photography. Neither came across: ADR-0006
makes monochrome a decision rather than a habit. What was borrowed is the
anatomy — one soft wash (`OnboardingBackdrop`, drawn with the `react-native-svg`
already in the tree), a ring control, weight contrast — not the trade dress.

⚠️ Note for anyone bringing photography here later: the map takes 55% of the layout below the footer (not of the
screen — see ONBOARDING_WASH_HOLD) and the words sit below it
on `background`. **The headline must never move onto the image.** `mediaScrim`
at 45% was measured on 2026-08-23 at ~3.4:1 for 14pt white over a light
subject; anything carrying text takes an opaque `surfaceOverMedia`. Keeping the
two apart is why this layout has no contrast problem to solve.

## The deferred-auth gate (guest-first)

`onboarding → the tabs, as a GUEST`. No auth wall anywhere: browsing (feed,
map, post detail — all anon-granted RPCs) is open. Auth appears only when an
action needs an account, and **the original action continues after sign-in**
without re-tapping.

**The mechanism** — `useRequireAuth()(intent)` is the ONE gate:
- standing `member` (session + `profiles` row) → `intent.run()` immediately;
- otherwise → the intent (`{ context, run? }`) is stored in the module-level
  `gateIntent` store and the **AuthSheet** opens, titled for the context
  ("Log in to report a sighting") — an invitation, never a wall.
- The continuation is a closure held in memory only — never serialized. It
  dies with the JS session (a killed app = the user re-taps; no stale replays).
- The sheet resolves the intent only at standing `member` — session AND
  profile row confirmed — so a continued action can rely on post-auth data.
- Dismissal (swipe/backdrop) = graceful cancel: intent dropped, no nagging.

**AuthSheet steps** (internal sheet navigation, sliding horizontally, keyboard-
aware, dynamic height): email entry → `OtpInput` (6 boxes, auto-submit, shake
on a wrong code, 60s resend) → new users only: first name (the public
identity, DOMAIN). Social buttons (Apple iOS-only, Google) sit on the email
step. An orphaned session (killed mid-sign-up) opens the sheet directly at the
first-name step on the next gated action. "New user" == **no `profiles` row**
(`hasProfile` via `.maybeSingle()`).

**Gated today**: the tab-bar `+` (post a car), "I've seen this car" (post
detail — continuation is the coming-soon acknowledgement until sightings land),
profile edit, and the My Cars guest-tab "Log in" invitation
(tabs never auto-fire the sheet; actions do). Chat and alert-radius gating
adopt the same one-liner when those features are built.

> **Profile + Inbox tab override (deliberate).** A guest tapping the Profile
> or Inbox TAB opens the AuthSheet directly (`tab_profile` / `tab_inbox`,
> hold-and-sheet: the press is prevented, the sheet appears over the current
> tab, dismissal moves nothing; the continuation lands on the tab signed-in).
> Rationale: a guest's profile or inbox has nothing behind it but the
> invitation itself, so the tap IS the action. Inbox joined on 2026-08-06
> (owner call); My Cars keeps its invitation screen — it shows real value
> behind the gate. ONE implementation for both:
> `src/features/auth/gate/useTabAuthGate.ts`, wired by
> `src/features/profile/hooks/useProfileTab.ts` (Profile) and the tabs layout
> (Inbox) — a second hand-written copy is how a tab silently loses its gate.
> Both guest invitation screens remain reachable via deep link.

**Session & gating** — the Supabase client persists the session in the OS
keychain (`expo-secure-store`). `AuthGate` (root layout) shows a brand-mark
splash while the session + onboarding flag restore, then:
`loading→splash · onboarding unseen→/onboarding · everyone else→/(tabs)/explore`.
Sign-out drops to **guest mode and switches to the Explore tab** (2026-08-05) —
there is no auth screen to bounce to, and staying on Profile would re-render it
as that tab's own login invitation, reading as a wall the user just walked into.
Account deletion still lands in place.
Deep links open for guests; any gated action inside them goes through the gate.

**Data** — reads/writes only `profiles` (existing; `profiles_insert_self` RLS +
INSERT grant). **No migration.** The first-ever profile INSERT lives here.

**Logging** — `[auth]` tag; funnel events `otp_requested / otp_verified /
otp_failed / social_signin / profile_completed`, plus the gate funnel
`gate_shown / gate_completed / gate_dismissed` — each with `{ context }` so we
can read which actions actually convert guests (`gate_completed` also carries
`newUser`; `gate_dismissed` carries the step it died on). The email is
**always redacted** (`redactEmail`) — never logged in full (SECURITY_AND_TRUST §3).

**Out of scope** — phone/SMS OTP, magic links (deep-link), passwords, biometric
re-auth, alert radius (→ notifications), account deletion (→ profile).

## Config (NOT code — set these before the flow works end-to-end)

**Email OTP (works today with the defaults)** — `supabase/config.toml` already
provisions it: `otp_length = 8`, `otp_expiry = 3600`, `enable_confirmations =
false`. Local dev uses **Inbucket** (no real email). Production needs **custom
SMTP** — a Phase 5 task; Supabase's default sender is fine for dev/beta.
Dashboard (hosted): set the email OTP template + confirm the OTP length/expiry.

### Email OTP template (manual dashboard step)

> **Status (2026-07-15): APPLIED to the hosted project** via the management
> API (`PATCH /v1/projects/{ref}/config/auth`, fields
> `mailer_templates_magic_link_content` + `mailer_subjects_magic_link`) —
> the Magic Link slot now holds this template with `{{ .Token }}` and the
> subject below; hosted `mailer_otp_length = 8` / expiry 3600 confirmed.
> The **"Confirm signup" slot also carries the same template** (originally a
> wrong-slot paste, kept deliberately as the step-5 belt-and-braces).
> Gotcha that prompted this: pasting into "Confirm signup" INSTEAD of
> "Magic Link" leaves OTP logins receiving the default magic-link email.
> The steps below remain the recipe for re-applying or for a new project.

The branded OTP email lives at `supabase/templates/otp-email.html` (table-based,
inline-styled, image-free so it renders with images blocked; colours hard-coded
from `docs/DESIGN_SYSTEM.md` with a token→hex map in the file header). It is
**not** applied automatically on hosted Supabase — paste it in by hand:

1. **Dashboard → Authentication → Email Templates → "Magic Link".**
   Email OTP shares its implementation with Magic Links: `signInWithOtp` sends
   using the **Magic Link** template, so this is the slot our 8-digit code goes
   in ([Supabase docs](https://supabase.com/docs/guides/auth/passwordless-login/auth-email-otp):
   "To send an OTP instead of a Magic Link, alter the Magic Link email template").
2. **Replace the entire template body** with the contents of
   `supabase/templates/otp-email.html`.
3. **Subject line:** `Your Trackitdown login code`.
   Deliberately **no code in the subject** — subjects surface in lock-screen /
   banner notification previews, so a code there is shoulder-surfable. Keeping it
   body-only costs one extra tap to open the email; the hidden preheader is set to
   "Your login code is inside." so the inbox preview still reads cleanly.
4. **The OTP variable is `{{ .Token }}`** — Supabase substitutes the numeric code
   at send time. (Not `{{ .ConfirmationURL }}`; there is no magic link in this
   template. The 60-minute expiry copy matches `otp_expiry = 3600`.)
5. **Belt-and-braces (verify, not doc-confirmed):** our call uses
   `signInWithOtp({ shouldCreateUser: true })`, so a **brand-new** user's first
   code may be sent via the **"Confirm signup"** template instead of Magic Link.
   The Supabase OTP doc only covers Magic Link, so **test a first-ever signup**
   (below); if that email arrives as a confirmation link rather than a code, paste
   the same HTML into the **"Confirm signup"** slot too (subject identical).

**After pasting, manually verify three things:**
1. **Send yourself a real OTP** (trigger a login from the app or Auth → Users) and
   confirm the email shows the 8-digit code in the hero block, from the right
   sender, with intact layout.
2. **Open it in iPhone Mail:** check iOS offers the code as a one-tap suggestion
   above the keyboard. That autofill keys off wording — the email must contain the
   word "code" near the digits (it does: "Your login code" / "Enter this code");
   don't reword that away.
3. **Check it doesn't land in spam** (Gmail + iCloud/Outlook if you can). On the
   default Supabase sender some filtering is expected — this is the concrete
   argument for the Phase 5 custom-SMTP move onto our own verified domain.

**Rate limits** — `email_sent = 2/hour` (kept deliberately tight). The 60s
resend and testing hit this fast; the UI shows "Too many codes requested —
please try again later" (time-honest: never promise "a minute" against an
hourly budget). Raise it in the dashboard only if beta feedback needs it.

**Apple + Google (code-complete; inert until you do this)**
1. **Apple** — Apple Developer: enable "Sign in with Apple" for the app id;
   Supabase dashboard → Auth → Providers → Apple: add the Services ID / secret.
   (The `expo-apple-authentication` plugin adds the iOS entitlement.)
2. **Google** — Google Cloud → Credentials: create OAuth client ids (Web, iOS,
   Android). Supabase dashboard → Auth → Providers → Google: set the **Web**
   client id as "Client ID" and add the iOS/Android ids to "Authorized Client
   IDs". In `.env`: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`,
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and `GOOGLE_IOS_URL_SCHEME` (the reversed
   iOS client id) — read by `app.config.ts`.
3. **Rebuild** — Apple/Google are native modules; make a new dev build
   (`npx expo run:ios` / `run:android`), not Expo Go. The buttons activate then.

## Notes / follow-ups

- SecureStore has a ~2048-byte iOS value limit; base sessions fit. If a real
  session overflows, swap the client's adapter for an encrypted LargeSecureStore
  (cipher key in SecureStore, ciphertext in AsyncStorage).
- Apple nonce hardening (hashed nonce through `signInAsync`) is a sensible later
  addition; the baseline passes the identity token directly.
- **Profiles read-path hardening (tracked, pre-existing).** `profiles.display_name`
  is readable by any signed-in user (permissive `profiles_select_authenticated`
  policy), yet DOMAIN/SECURITY_AND_TRUST §1 say a surname must stay private. This
  flow therefore does NOT collect a surname at sign-up (first name only). Before
  any surname is collected anywhere (e.g. the profile-edit screen), harden the
  read path: a first-name-only view/RPC + revoke the raw-row SELECT. Not this
  feature's scope.
