# Device checks

Everything shipped since 2026-10-12 that has only been tested by machines, as one
pass through the app on a real phone. Tick a box when it behaves as described;
anything that doesn't, note the time and what you saw.

**Before you start**
- The phone runs the latest preview OTA (**ca40a2d1**, 2026-10-29). Open the app,
  close it fully, open it again: the update applies on the second launch.
- Two accounts: **Owner** (you) and **Spotter** (a second email). Use a throwaway
  third account for the last check — it gets deleted.
- Do it once in **dark mode** and, where it says so, again with **large text**
  (Settings → Display → Font size, near the top).
- Real money is live: use the free option, or the smallest reward, and refund it
  at the end by deactivating the listing.
- When you're done, tell Claude the time you started: it can then read telemetry
  and the server logs for any error during your session.

---

## 1. Opening and signing in

- [ ] **Opening screen** (#231–#233). Cold-start the app. The splash shows the
  mark only, it "breathes", a thin line appears after about 2 seconds, then it
  dissolves into the app — in your app theme, including when the phone is in the
  other theme. ⚠️ The native half needs the **preview build 20caf1ed** APK, not
  just the OTA.
- [ ] **Email code** (#201–#203). Sign out, sign in by email. The code is **6
  digits**, arrives within a minute, and still works after 10 minutes.
- [ ] **Google sign-in** (#197, #198). Sign in with Google. The button is
  Google's own style. If it fails, the Google account must be added as a tester
  on the OAuth consent screen.
- [ ] **Apple on Android** (#200). Tap Apple: a "Coming soon" sheet opens.

## 2. First login (a new account)

- [ ] **Name step** (#292). A brand-new account is asked only for a first name.
- [ ] **Notifications row** (#294, #296). Block notifications for the app in
  phone Settings, open Profile: a row says notifications are off. Turn them on in
  Settings and come back: the row is gone without restarting the app.
- [ ] **Profile photo row** (#293). Add a profile photo from Profile. It uploads
  and shows (photos are private now — #284).

## 3. Posting a car (Owner)

- [ ] **Colour step** (#160–#165). Pick a colour, tap Next: a sheet asks the
  finish. The review shows "Blue · Metallic" (your choice), with no "Selected" line.
- [ ] **Last seen** (#256, #257). The time cards show exact times; only the card
  that is true is lit; changing your mind in the picker cancels the jump ahead.
- [ ] **Reward → free** (#301). Set a reward, go back, choose **No reward**: the
  draft becomes free and saves.
- [ ] **Change the reward while paying** (#303). Set a reward, tap Pay, close
  the payment sheet without paying, change the reward, pay. It goes through at
  the **new** amount, with no "already going through" error left behind.
- [ ] **Payment sheet** (#213). The payment sheet matches the app in light and
  dark.
- [ ] **Going live** (#255). After paying there's no confirmation page; the
  listing shows a "Going live" badge until it is live, and its details are locked
  while the payment is held.
- [ ] **Owner's listing page** (#215). Sightings come first; spotter-only parts
  are hidden; Deactivate is only inside the Manage sheet.

## 4. Reporting a sighting (Spotter)

- [ ] **One question per step** (#234–#243). Open the Owner's listing and report a
  sighting. Each extra question is its own card step: what the car was doing,
  people, damage, missing parts.
- [ ] **999 line** (#241). Choose damage → on fire: "If the car is currently on
  fire, call 999." appears.
- [ ] **Damage as rows** (#251). Damage choices are rows with icons; missing parts
  sit inside them.
- [ ] **Anything else?** (#250, #252). The next question shows as a line with
  **Add**; tapping it opens that question.
- [ ] **Check and send** (#249, #253). The last step shows your answers as cards
  you can't edit by accident, and **no** privacy text above Send.
- [ ] **Car card** (#254). The car card reads year · body · finish · reward, with
  no map explainer.
- [ ] **Sighting photos** (#290). Attach 1–3 photos: they upload and send.

## 5. The sighting, as Owner

- [ ] **Sighting page** (#220–#230). Open the Spotter's sighting:
  - the photos' marks come first; the decide bar shows only while you decide;
  - after deciding, **Change** lets you undo;
  - "Got your car back?" and **Message** work;
  - the answers sit under **Details** as a plain table (Doing / People / Condition);
  - **Where** shows an address chip; Google Maps and Waze each open with directions.
- [ ] …again with **large text** and in **dark mode**: nothing overlaps or clips.
- [ ] **Listing card** (#230). On the listing, the sighting card has its amber tag,
  the marks seen, and a chevron.

## 6. Inbox

- [ ] **Rows** (#218). Each row shows the car line, 16-point text, inset dividers,
  bodies up to two lines.
- [ ] **Notifications by day** (#219). Notifications are grouped Today / Yesterday
  / dates; Messages are not grouped.

## 7. Payouts (Spotter)

- [ ] **Setup wizard** (#169, #188–#194, #206). Profile → Payouts → set up: one step
  per screen, field labels **above** the fields, bank last 4 digits shown at the end.
- [ ] **No signal** (#212). On the bank step, turn on aeroplane mode and submit:
  a clear "couldn't check" state, not a blank or a crash. Turn it off and retry.

## 8. Profile and account (throwaway account)

- [ ] **Download your data** (#273, #274). Profile → Download your data: a
  readable PDF opens in the app (logo on every page, rows, "Nothing to show" where
  empty), with a link to the JSON copy.
- [ ] **Delete account** (#267–#269). Profile → Delete account: a bottom sheet,
  type DELETE, the account goes. Signing in again starts a new account.

## 9. Afterwards

- [ ] Deactivate the Owner's listing, so any reward is refunded.
- [ ] Tell Claude the start time. It checks `telemetry_events` for
  `error_app_crash` and `error_function_call_failed`, and Sentry for server errors,
  across your session (#312, #311).
