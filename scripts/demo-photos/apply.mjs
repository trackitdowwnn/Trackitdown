// WHAT:  Step 2 of the demo-photos tool. Reads out/picks.json (exported from
//        the shortlist) and, for each dummy post with 3 picks, fetches each
//        photo through Unsplash's download endpoint, makes an edited copy
//        (edit.mjs: centre 4:3 crop, 1600×1200, marked boxes filled, a
//        pixels-only JPEG so no EXIF survives), uploads it to post-photos in
//        the post owner's folder, and swaps in that post's demo post_photos
//        rows. Records every photographer in credits.json.
//          node --use-system-ca scripts/demo-photos/apply.mjs            dry run
//          ... apply.mjs --write                                         do it
//          ... apply.mjs --remove                                        undo
//          ... --only b2b2b2b2-0000-0000-0000-000000000001               one post
// WHY:   Our own bucket, not hotlinks: the app stores only its own storage
//        URLs (third-party image hosts would log every viewer's IP, see
//        20260713192000), and the copies are edited, which is the exception
//        Unsplash's hotlinking guideline names. Triggering download_location
//        is the download event Unsplash requires; each one counts against the
//        50-an-hour demo limit, so a post already up to date is skipped and a
//        run that hits the limit stops cleanly and resumes next time. Each
//        post is swapped insert-first, so a failure leaves the old photos or
//        both sets, never none. Files uploaded before a failure are deleted
//        only if no row points at them (re-checked: an insert whose answer
//        was lost may still have landed); --remove sweeps any stray left.
//        It refuses anything that isn't one of the 30 dummy posts, and every
//        delete is checked against this post's own demo-file names.
// LINKS: scripts/demo-photos/lib.mjs; edit.mjs (the copy); find.mjs;
//        docs/DEMO_PHOTOS.md; supabase/migrations/20260901160000_orphaned_photo_queue.sql.

import { Buffer } from "node:buffer";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { editedCopy } from "./edit.mjs";
import {
  creditLinks,
  demoFilePrefix,
  demoPostsQuery,
  demoRowsFilter,
  isDemoPathOf,
  isDemoPostId,
  isRateLimited,
  isUnsplashApiUrl,
  loadEnv,
  pathFromPublicUrl,
  PHOTOS_PER_POST,
  publicUrl,
  storagePath,
  titleFor,
  validBoxes,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const CREDITS = join(HERE, "credits.json");

/** The widest download we ask Unsplash for (imgix resizing, aspect kept, so
 *  the plate boxes still line up): a 20+ MP original is wasted bandwidth. */
const DOWNLOAD_WIDTH = 2400;

// --- Arguments -------------------------------------------------------------------
const args = process.argv.slice(2);
const write = args.includes("--write");
const remove = args.includes("--remove");
const onlyAt = args.indexOf("--only");
const only = onlyAt >= 0 ? args[onlyAt + 1] : null;
if (onlyAt >= 0 && !isDemoPostId(only)) {
  // Without this, a forgotten id would fall through to EVERY post.
  console.error(`--only needs one of the 30 dummy post ids (got ${only ?? "nothing"}).`);
  process.exit(1);
}
if (write && remove) {
  console.error("Use --write or --remove, not both.");
  process.exit(1);
}

const env = loadEnv(ROOT);
if (!env.supabaseUrl || !env.anonKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.");
  process.exit(1);
}
if ((write || remove) && !env.serviceKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.demo.local (see docs/DEMO_PHOTOS.md).");
  process.exit(1);
}
if (write && !env.unsplashKey) {
  console.error("Missing UNSPLASH_ACCESS_KEY in .env.demo.local.");
  process.exit(1);
}

const service = () => ({ apikey: env.serviceKey, Authorization: `Bearer ${env.serviceKey}` });

class RateLimited extends Error {}

// --- Supabase --------------------------------------------------------------------

/** The dummy posts, by id range. For --write and --remove, with the service
 *  key and so EVERY status: a dummy post that has expired or been archived
 *  still has photos that --remove must reach. A dry run reads with the anon
 *  key, as the public does. */
async function fetchDemoPosts() {
  const key = write || remove ? env.serviceKey : env.anonKey;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${demoPostsQuery("id,owner_id,make,model,colour")}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`posts read failed: HTTP ${res.status}`);
  return (await res.json()).filter((post) => isDemoPostId(post.id) && (!only || post.id === only));
}

/** A post's current demo rows (only rows this tool wrote). */
async function demoRows(postId) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/post_photos?select=id,url,position&${demoRowsFilter(postId)}`, {
    headers: service(),
  });
  if (!res.ok) throw new Error(`post_photos read failed for ${postId}: HTTP ${res.status}`);
  return res.json();
}

async function deleteRowsById(ids) {
  if (ids.length === 0) return;
  const res = await fetch(`${env.supabaseUrl}/rest/v1/post_photos?id=in.(${ids.join(",")})`, {
    method: "DELETE",
    headers: service(),
  });
  if (!res.ok) throw new Error(`post_photos delete failed: HTTP ${res.status} ${await res.text()}`);
}

async function insertRows(rows) {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/post_photos`, {
    method: "POST",
    headers: { ...service(), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`post_photos insert failed: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function upload(path, bytes) {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/post-photos/${path}`, {
    method: "POST",
    headers: { ...service(), "Content-Type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=3600" },
    body: bytes,
  });
  if (!res.ok) throw new Error(`upload failed for ${path}: HTTP ${res.status} ${await res.text()}`);
}

async function deleteFiles(paths) {
  if (paths.length === 0) return;
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/post-photos`, {
    method: "DELETE",
    headers: { ...service(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`storage delete failed: HTTP ${res.status} ${await res.text()}`);
}

/** Every demo file of a post in its owner's folder, rows or not: catches a
 *  file a failed run left behind with no row pointing at it. */
async function listDemoFiles(post) {
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/list/post-photos`, {
    method: "POST",
    headers: { ...service(), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: post.owner_id, search: demoFilePrefix(post.id), limit: 100 }),
  });
  if (!res.ok) throw new Error(`storage list failed for ${post.id}: HTTP ${res.status}`);
  return (await res.json())
    .map((object) => object.name)
    .filter((name) => name.startsWith(demoFilePrefix(post.id)))
    .map((name) => `${post.owner_id}/${name}`);
}

// --- Unsplash --------------------------------------------------------------------

/** Unsplash's required download event, which also returns the file URL. The
 *  Access Key is only ever sent to api.unsplash.com. */
async function downloadFromUnsplash(candidate) {
  if (!isUnsplashApiUrl(candidate.downloadLocation)) {
    throw new Error(`unexpected download host for ${candidate.id}: refusing to send the key there`);
  }
  const res = await fetch(candidate.downloadLocation, {
    headers: { Authorization: `Client-ID ${env.unsplashKey}`, "Accept-Version": "v1" },
  });
  // A rate limit is a 429, or a 403 that says so. Any other 403 (a revoked
  // or wrong key) is a hard error, not "try again in an hour".
  if (res.status === 429 || res.status === 403) {
    const body = res.status === 403 ? await res.text() : "";
    if (isRateLimited(res.status, res.headers.get("x-ratelimit-remaining"), body)) throw new RateLimited();
    throw new Error(`Unsplash refused the download for ${candidate.id} (HTTP 403): check UNSPLASH_ACCESS_KEY.`);
  }
  if (!res.ok) throw new Error(`Unsplash download event failed for ${candidate.id}: HTTP ${res.status}`);
  const { url } = await res.json();
  const sized = new URL(url);
  sized.searchParams.set("w", String(DOWNLOAD_WIDTH));
  sized.searchParams.set("q", "90");
  const file = await fetch(sized);
  if (!file.ok) throw new Error(`photo fetch failed for ${candidate.id}: HTTP ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}

// --- Credits ---------------------------------------------------------------------

function readCredits() {
  return existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, "utf8")) : {};
}

function writeCredits(credits) {
  writeFileSync(CREDITS, `${JSON.stringify(credits, null, 2)}\n`);
}

// --- Run -------------------------------------------------------------------------

const posts = await fetchDemoPosts();
if (posts.length === 0) {
  console.error("No matching dummy posts.");
  process.exit(1);
}

if (remove) {
  const credits = readCredits();
  for (const post of posts) {
    const rows = await demoRows(post.id);
    await deleteRowsById(rows.map((row) => row.id));
    const paths = new Set(
      [...rows.map((row) => pathFromPublicUrl(env.supabaseUrl, row.url)), ...(await listDemoFiles(post))]
        // The last word before a delete: only this post's own demo files.
        .filter((path) => isDemoPathOf(post, path)),
    );
    await deleteFiles([...paths]);
    delete credits[post.id];
    console.log(`  ${titleFor(post)}: removed ${rows.length} row(s), ${paths.size} file(s).`);
  }
  writeCredits(credits);
  process.exit(0);
}

const picksFile = join(OUT, "picks.json");
if (!existsSync(picksFile)) {
  console.error(`No ${picksFile}. Export it from out/shortlist.html first.`);
  process.exit(1);
}
const { picks } = JSON.parse(readFileSync(picksFile, "utf8"));
const credits = readCredits();

let updated = 0;
let current = 0;
let left = 0;
let limited = false;
for (const post of posts) {
  const chosen = picks?.[post.id] ?? [];
  const cacheFile = join(OUT, "candidates", `${post.id}.json`);
  if (chosen.length !== PHOTOS_PER_POST) {
    console.log(`  skip ${titleFor(post)}: ${chosen.length} of ${PHOTOS_PER_POST} picked.`);
    continue;
  }
  if (!existsSync(cacheFile)) {
    console.log(`  skip ${titleFor(post)}: no cached candidates (run find.mjs first).`);
    continue;
  }
  if (!chosen.every((pick) => pick && typeof pick.id === "string" && validBoxes(pick.boxes ?? []))) {
    console.log(`  skip ${titleFor(post)}: a pick in picks.json is malformed (bad id or box).`);
    continue;
  }
  const { candidates } = JSON.parse(readFileSync(cacheFile, "utf8"));
  const resolved = chosen.map((pick, position) => {
    const candidate = candidates.find((c) => c.id === pick.id);
    const boxes = pick.boxes ?? [];
    return candidate ? { candidate, boxes, position, path: storagePath(post, position, candidate.id, boxes) } : null;
  });
  if (resolved.some((r) => !r)) {
    console.log(`  skip ${titleFor(post)}: a pick isn't in the cached candidates (re-run find.mjs).`);
    continue;
  }
  const summary = resolved
    .map(({ candidate, boxes, position }) =>
      `${position + 1}. ${candidate.id} by ${candidate.photographer}${boxes.length ? ` (${boxes.length} box)` : ""}`)
    .join("; ");

  if (!write) {
    console.log(`  would set ${titleFor(post)}: ${summary}`);
    updated += 1;
    continue;
  }
  // Already exactly these photos? Then nothing to download (saves the
  // hourly budget). Checked even after the limit is hit: it costs no
  // Unsplash call, and keeps the "left" count honest.
  const before = await demoRows(post.id);
  const target = resolved.map((r) => publicUrl(env.supabaseUrl, r.path));
  const existing = [...before].sort((a, b) => a.position - b.position).map((row) => row.url);
  if (existing.length === target.length && existing.every((url, i) => url === target[i])) {
    current += 1;
    continue;
  }
  if (limited) {
    left += 1;
    continue;
  }

  // A path is fixed by post, position, photo and boxes, so a file a current
  // row already points at is exactly this pick: no need to fetch it again.
  const stillUsed = new Set(before.map((row) => pathFromPublicUrl(env.supabaseUrl, row.url)));
  const uploaded = [];
  let insertedOk = false;
  try {
    for (const r of resolved) {
      if (stillUsed.has(r.path)) continue;
      await upload(r.path, await editedCopy(await downloadFromUnsplash(r.candidate), r.boxes));
      uploaded.push(r.path);
    }
    // Insert first, then delete the old rows by id: a failure in between
    // leaves both sets (a re-run tidies it), never a post with no photos.
    await insertRows(resolved.map((r, i) => ({ post_id: post.id, url: target[i], position: r.position })));
    insertedOk = true;
    await deleteRowsById(before.map((row) => row.id));
  } catch (err) {
    // Before the insert, files no row points at would never be swept (the
    // orphan queue learns of a file only when a row is deleted), so take
    // them back down. AFTER it, the new rows point at them: leave both sets.
    // And re-check first: an insert whose answer was lost may have landed.
    if (!insertedOk && uploaded.length > 0) {
      try {
        const referenced = new Set(
          (await demoRows(post.id)).map((row) => pathFromPublicUrl(env.supabaseUrl, row.url)),
        );
        await deleteFiles(uploaded.filter((path) => !referenced.has(path) && isDemoPathOf(post, path)));
      } catch (cleanup) {
        console.error(
          `  couldn't tidy ${uploaded.length} uploaded file(s) for ${titleFor(post)} (${cleanup.message});`,
          "--remove sweeps strays.",
        );
      }
    }
    if (err instanceof RateLimited) {
      limited = true;
      left += 1;
      continue;
    }
    throw err;
  }

  credits[post.id] = {
    listing: titleFor(post),
    photos: resolved.map(({ candidate, boxes, position }) => ({
      position,
      unsplashId: candidate.id,
      photographer: candidate.photographer,
      ...creditLinks(candidate.username),
      edits: ["centre crop to 4:3", "resized to 1600x1200", ...(boxes.length ? ["area filled (plate or person)"] : [])],
    })),
  };
  writeCredits(credits);
  updated += 1;
  console.log(`  set ${titleFor(post)}: ${summary}`);
}

if (!write) {
  console.log(`\nDry run: ${updated} post(s) ready. Re-run with --write to upload.`);
} else {
  console.log(`\nDone: ${updated} post(s) updated, ${current} already up to date. Credits in ${CREDITS}.`);
  if (limited) {
    console.log(`Unsplash's hourly limit was reached with ${left} post(s) left. Run --write again in an hour;`);
    console.log("finished posts are skipped without downloading.");
    process.exit(2);
  }
}
