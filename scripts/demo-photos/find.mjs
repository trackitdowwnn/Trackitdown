// WHAT:  Step 1 of the demo-photos tool. Reads the hosted project's dummy
//        posts (anon key, read-only), searches Unsplash for each car (the
//        exact car, topped up from "<colour> <type> car" when thin: up to two
//        searches), caches the results, and writes out/shortlist.html: a
//        local page where a person picks 3 photos per car, boxes anything
//        that slipped through, and exports picks.json for apply.mjs.
//        The cache is keyed by post, not by query: after changing the
//        searches, delete out/candidates/<post id>.json for the cars to redo.
// WHY:   Unsplash search can't reliably find a specific model in a specific
//        colour, so a person picks. The shortlist shows Unsplash's own
//        hotlinked thumbnails with each photographer's credit, which is how
//        the API guidelines say search results must be displayed. Results are
//        cached because a demo API key allows only 50 searches an hour.
// LINKS: scripts/demo-photos/lib.mjs (query, env); apply.mjs (step 2);
//        docs/DEMO_PHOTOS.md; https://unsplash.com/documentation#search-photos.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  creditLinks,
  demoPostsQuery,
  isDemoPostId,
  isRateLimited,
  loadEnv,
  mergeCandidates,
  PHOTOS_PER_POST,
  queriesFor,
  titleFor,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const CACHE = join(OUT, "candidates");
const PER_CAR = 15;

const env = loadEnv(ROOT);
if (!env.supabaseUrl || !env.anonKey) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.");
  process.exit(1);
}
if (!env.unsplashKey) {
  console.error("Missing UNSPLASH_ACCESS_KEY in .env.demo.local (see docs/DEMO_PHOTOS.md).");
  process.exit(1);
}
mkdirSync(CACHE, { recursive: true });

/** The live dummy posts, as the public sees them (anon key: RLS shows only
 *  active posts, the ones worth shortlisting), by id range on the server. */
async function fetchDemoPosts() {
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${demoPostsQuery("id,owner_id,make,model,colour,body_type")}`, {
    headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}` },
  });
  if (!res.ok) throw new Error(`posts read failed: HTTP ${res.status}`);
  return (await res.json()).filter((post) => isDemoPostId(post.id));
}

/** Fewer exact-model results than this and the colour-and-type search tops
 *  them up. */
const ENOUGH = 9;

/** The car's searches (lib queriesFor): the exact car first, topped up from
 *  its colour and type when that's thin, de-duplicated, at most PER_CAR. */
async function search(post) {
  const [exact, loose] = queriesFor(post);
  const first = await searchOnce(exact);
  if (first.limited || !loose || first.candidates.length >= ENOUGH) return first;
  const second = await searchOnce(loose);
  // Out of budget for the top-up: retry the whole car next run, rather than
  // caching a thin result that would never be searched again.
  if (second.limited) return second;
  const candidates = mergeCandidates(first.candidates, second.candidates, PER_CAR);
  return { ...second, query: `${exact} / ${loose}`, candidates };
}

async function searchOnce(query) {
  const params = new URLSearchParams({
    query,
    per_page: String(PER_CAR),
    orientation: "landscape",
    content_filter: "high",
  });
  const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${env.unsplashKey}`, "Accept-Version": "v1" },
  });
  // NaN when the header is absent: Number(null) is 0, which would read as
  // "out of budget" and stop after one car.
  const remaining = res.headers.has("x-ratelimit-remaining")
    ? Number(res.headers.get("x-ratelimit-remaining"))
    : NaN;
  // A rate limit is a 429, or a 403 that says so; any other 403 is a bad key.
  if (res.status === 429 || res.status === 403) {
    const text = res.status === 403 ? await res.text() : "";
    if (isRateLimited(res.status, res.headers.get("x-ratelimit-remaining"), text)) {
      return { limited: true, remaining };
    }
    throw new Error("Unsplash refused the search (HTTP 403): check UNSPLASH_ACCESS_KEY in .env.demo.local.");
  }
  if (!res.ok) throw new Error(`Unsplash search failed for "${query}": HTTP ${res.status}`);
  const body = await res.json();
  return {
    remaining,
    query,
    candidates: body.results.map((photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      thumb: photo.urls.small,
      preview: photo.urls.regular,
      page: `${photo.links.html}?utm_source=trackitdown&utm_medium=referral`,
      downloadLocation: photo.links.download_location,
      alt: photo.alt_description ?? "",
      photographer: photo.user.name,
      username: photo.user.username,
      credit: creditLinks(photo.user.username),
    })),
  };
}

const posts = await fetchDemoPosts();
console.log(`${posts.length} dummy posts.`);

const cars = [];
let stoppedAt = null;
for (const post of posts) {
  const cached = join(CACHE, `${post.id}.json`);
  let entry = existsSync(cached) ? JSON.parse(readFileSync(cached, "utf8")) : null;
  if (!entry && stoppedAt === null) {
    const result = await search(post);
    if (result.limited) {
      stoppedAt = post.id;
    } else {
      entry = { query: result.query, candidates: result.candidates };
      writeFileSync(cached, JSON.stringify(entry, null, 2));
      console.log(`  ${titleFor(post)}: ${entry.candidates.length} candidates ("${entry.query}")`);
      // Stop just before the limit (a car can take two searches), rather than
      // running into it mid-car. Downloads need their own hours anyway.
      if (Number.isFinite(result.remaining) && result.remaining <= 2) stoppedAt = "budget";
    }
  }
  if (entry) cars.push({ post: { ...post, title: titleFor(post) }, ...entry });
}

// A replacer FUNCTION, not a string: String.replace expands $' and $` in a
// replacement string, so a photographer name or alt text containing them
// could splice template text back in and inject script. "<" is escaped so
// nothing in the data can close the <script> element.
const data = JSON.stringify({ perPost: PHOTOS_PER_POST, cars }).replace(/</g, "\\u003c");
const html = readFileSync(join(HERE, "shortlist.template.html"), "utf8").replace(
  "/*__DATA__*/null",
  () => data,
);
writeFileSync(join(OUT, "shortlist.html"), html);

console.log(`\nWrote ${join(OUT, "shortlist.html")} with ${cars.length} of ${posts.length} cars.`);
if (stoppedAt !== null) {
  console.log(
    "Unsplash's hourly limit was reached before every car was searched. Run this again in an hour:",
    "cached cars are not searched twice.",
  );
}
console.log("Open the page, pick 3 photos per car, press Export, and save picks.json into", OUT);
