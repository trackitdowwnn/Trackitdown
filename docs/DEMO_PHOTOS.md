# Demo listing photos

## What the dummy posts are

The hosted Supabase project (the one the app's `.env` points at) holds 30 dummy stolen-car listings:
- ids `b2b2b2b2-0000-0000-0000-000000000001` to `…00000000001e`, numbered in hex (`…01` to `…1e`, which is 1 to 30);
- Hertfordshire areas;
- fake owners (`1111…` to `6666…`);
- made-up plates.

They were inserted by hand and are **not** in the repo. `supabase/seed.sql` is a separate, local-only Manchester set with its own hotlinked placeholder photos.

Until 2026-10-05 the dummy posts had no `post_photos` rows, so every card showed the grey image placeholder. `scripts/demo-photos/` gives each one 3 real car photos.

## Where the photos come from

- **Source:** [Unsplash](https://unsplash.com), under the [Unsplash License](https://unsplash.com/license). That allows commercial use and editing, and needs no attribution.
- **Matching:** the exact car first ("Blue Toyota RAV4 car"), topped up from its colour and body type ("Blue SUV car") when that finds fewer than 9. Colour and type is the accepted fallback, since Unsplash rarely has three photos of a specific model in a specific colour. There is no colour filter: Unsplash's `color=` ranks by how much of the frame is that colour, which returned paint close-ups.
- **Picked by a person:** the owner chooses each photo on a shortlist page.
- **Stored in our own bucket.** Each photo is an edited copy in `post-photos/<owner id>/demo-<post id>-<position>-<unsplash id>-<boxes tag>.jpg`. It is never a hotlink, for two reasons:
  - The app only stores its own storage URLs. A third-party image host would see every viewer's IP (`20260713192000`).
  - These paths also satisfy the own-folder rule (`v_photo_url_re`) that the post RPCs enforce.
- **Edits made to every copy:**
  - centre crop to 4:3;
  - resize to 1600×1200;
  - any box drawn on the shortlist is filled solid;
  - written as a fresh, pixels-only JPEG, so no EXIF survives. A plain Jimp re-encode would keep the original's EXIF; `edit.test.mjs` pins this with a real EXIF+GPS input.
- **Credits:** every photographer is recorded in [`scripts/demo-photos/credits.json`](../scripts/demo-photos/credits.json): name, Unsplash photo id, and Unsplash's referral links. This is so a takedown or credit request can be answered at once.

**Compliance note.** Unsplash's API guidelines ask apps to hotlink API images. They exempt edited derivatives, but the threshold is loosely defined. We stay well inside that exception:
- every copy is edited (cropped, resized, any slip filled);
- the tool triggers each photo's `download_location`, Unsplash's required download event;
- the credits are kept.

If Unsplash ever objects, `--remove` takes every demo photo down in one command.

## The picking rule: no readable plates, no identifiable people or places

These are real people's cars on listings that say **stolen**. A readable plate could point the public at an innocent owner, and a plate can be personal data (ICO guidance on ANPR). A recognisable driver or passer-by would read as a suspect.

**The original photo is public on Unsplash**, so covering something in our copy doesn't hide it from a reverse image search. So the rule is to **pick photos with no readable plate, no identifiable person, and no readable house number, street sign or recognisable home**: a real address beside a real car on a "stolen" listing is the next thing that could point at someone. A box is only for something small that slipped through, and it is filled solid: a pixelated UK plate, in its one fixed font, can be partly reversed.

## Running it

1. **Keys.** Create a free app at <https://unsplash.com/developers>. Only its **Access Key** is used; the Secret Key isn't. Then create `.env.demo.local` in the repo root. It's gitignored by `.env.*.local`; never commit it or paste it anywhere. Put your two values in it, one per line, with no comment after the value:
   ```
   UNSPLASH_ACCESS_KEY=your-access-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   The service key is in the Supabase dashboard → Project Settings → API → `service_role`. The app's own `.env` must never hold it (`.env.example`).
2. **Shortlist.** Run `npm run demo-photos:find`.
   - It searches Unsplash for each car: the exact car, plus a colour-and-type top-up when that finds fewer than 9. It caches the results in `scripts/demo-photos/out/`.
   - The cache is keyed by post, not by query: after changing the searches, delete `scripts/demo-photos/out/candidates/<post id>.json` for the cars to redo.
   - It writes `scripts/demo-photos/out/shortlist.html`.
3. **Pick.** Open the shortlist in a browser.
   - For each car, click 3 photos, in the order they should show, following the picking rule above.
   - Box anything that slipped through on the large previews. The dimmed edges are what the 4:3 crop removes.
   - Your progress is saved in the browser.
   - Press **Export picks.json** and save the file into `scripts/demo-photos/out/`.
4. **Dry run.** Run `npm run demo-photos:apply`. It prints what it would set for each car and changes nothing.
5. **Upload.** Run `npm run demo-photos:apply -- --write`. For each car with 3 picks it:
   - fetches the photos;
   - makes the edited copies and uploads them;
   - swaps in that post's demo `post_photos` rows. It inserts the new rows first, so a failure never leaves a post with no photos. A failure before the insert deletes the files it uploaded (after checking no row points at them); after the insert, both sets are kept for the next run to tidy;
   - updates `credits.json`.

   **Rate limit:** every photo download counts against Unsplash's demo limit of 50 an hour, and 30 cars need 90. So the first run stops cleanly partway and says how many cars are left. Run `--write` again an hour later. Finished cars are skipped without downloading. Commit the updated `credits.json`.
6. **One post only.** Add `-- --only b2b2b2b2-0000-0000-0000-0000000000NN` to steps 4, 5 or 7, where NN is hex `01` to `1e`.
7. **Undo.** Run `npm run demo-photos:apply -- --remove`.
   - It reads the posts with the service key, so it also reaches dummy posts that have expired or been archived.
   - It deletes their demo rows, their files, and any stray demo file a failed run left behind. It also drops their credits.

**Safety rails:**
- The tool only accepts the 30 exact dummy post ids, and only ever deletes rows whose URL contains `/demo-`. It cannot touch a real listing or a real photo.
- The Unsplash key is only sent to `api.unsplash.com`.
- A file that a re-pick stops using is removed by the orphaned-photo sweeper (`20260901160000`), which deletes only files that nothing references.

**Tests:** `npm run test:demo-photos`, also run in CI. It covers:
- the id guard and range, and the delete guard;
- how a car's two searches merge, and what counts as a rate limit;
- that malformed boxes are rejected;
- the paths against the app's URL rule;
- the row filter and host check;
- the crop and box maths;
- that copies are EXIF-free 1600×1200 JPEGs with boxes filled.

## Open question: the dummy plates

The 30 dummy posts use real-format UK plates, such as `EO21 KVX`. Some may well be issued to real cars. Once these listings look convincing, a real spotter could photograph and report an innocent car that happens to carry one.

Before relying on them, check that the plates use a format the DVLA cannot issue, or label the listings as demos. That's a separate decision from the photos.
