// WHAT:  The pure core of the demo-photos tool: env loading, which posts are
//        dummy posts, the Unsplash searches for a car and how their results
//        merge, what counts as a rate limit, where its photos live in our
//        bucket, the row filters, URL parsing and delete guard apply.mjs
//        uses, box validation, and the crop / plate-box geometry.
// WHY:   The hosted project's 30 dummy listings (ids b2b2b2b2-…, added by
//        hand, not in the repo) had no photos, so every card showed the grey
//        placeholder. This tool gives each one 3 real car photos from Unsplash,
//        picked by a person and copied into OUR post-photos bucket as edited
//        copies (docs/DEMO_PHOTOS.md has the licence and compliance notes).
//        Everything with a decision in it lives here so it is unit-tested;
//        find.mjs and apply.mjs only do I/O.
// LINKS: scripts/demo-photos/find.mjs, apply.mjs, edit.mjs, lib.test.mjs;
//        docs/DEMO_PHOTOS.md; supabase/migrations/20260902150000_post_remembers_its_vehicle.sql
//        (v_photo_url_re, the own-folder URL rule our paths satisfy, and the
//        3–6 photo rule at create_post).

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The 30 dummy posts' ids, exactly. They are numbered in HEX, …01 to …1e
 *  (1 to 30): a decimal …030 range silently missed 11 of them. Nothing else
 *  is ever touched. */
const DEMO_ID = /^b2b2b2b2-0000-0000-0000-0000000000(0[1-9a-f]|1[0-9a-e])$/;
const DEMO_ID_FIRST = "b2b2b2b2-0000-0000-0000-000000000001";
const DEMO_ID_LAST = "b2b2b2b2-0000-0000-0000-00000000001e";

/** Photos per dummy post: the minimum create_post demands of a real one. */
export const PHOTOS_PER_POST = 3;

/** Output size: 4:3 like every car photo in the app (VehicleCard). */
export const OUTPUT_WIDTH = 1600;
export const OUTPUT_HEIGHT = 1200;

/** Whether an id is one of the 30 dummy posts'. */
export function isDemoPostId(id) {
  return typeof id === "string" && DEMO_ID.test(id);
}

/** The PostgREST query for the dummy posts: a uuid RANGE, filtered on the
 *  server (a pattern match can't be used on a uuid column, and reading every
 *  post to filter here would silently miss them past the row cap). */
export function demoPostsQuery(columns) {
  return `posts?select=${columns}&id=gte.${DEMO_ID_FIRST}&id=lte.${DEMO_ID_LAST}&order=id`;
}

/**
 * Parse KEY=value lines. Quoted values keep everything inside the quotes;
 * an unquoted value ends at " #" (an inline comment), so a copied
 * `KEY=abc   # note` reads as `abc`, not a broken key.
 */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    const quoted = raw.match(/^(["'])(.*)\1$/);
    out[match[1]] = quoted ? quoted[2] : raw.replace(/\s+#.*$/, "").trim();
  }
  return out;
}

/**
 * The URL and anon key from the app's .env; the two secrets from
 * .env.demo.local (gitignored). The service key never goes in .env, which
 * the app bundles from (.env.example). The URL loses any trailing slash once,
 * here, so every URL built or compared from it agrees.
 */
export function loadEnv(root) {
  const read = (name) => {
    const path = join(root, name);
    return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  };
  const app = read(".env");
  const local = read(".env.demo.local");
  return {
    supabaseUrl: app.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, ""),
    anonKey: app.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    unsplashKey: local.UNSPLASH_ACCESS_KEY || undefined,
    serviceKey: local.SUPABASE_SERVICE_ROLE_KEY || undefined,
  };
}

/** Body type for each dummy post's model ("same colour and type" matching). */
const BODY_TYPES = {
  "honda jazz": "hatchback",
  "hyundai tucson": "SUV",
  "toyota rav4": "SUV",
  "bmw x1": "SUV",
  "audi a4 avant": "estate",
  "nissan juke": "SUV",
  "volvo xc40": "SUV",
  "skoda fabia": "hatchback",
  "ford ecosport": "SUV",
  "toyota aygo": "hatchback",
  "seat ibiza": "hatchback",
  "ford focus": "hatchback",
  "renault clio": "hatchback",
  "ford fiesta": "hatchback",
  "porsche macan": "SUV",
  "bmw 5 series": "saloon",
  "mini countryman": "SUV",
  "land rover defender": "4x4",
  "ford puma": "SUV",
  "mercedes-benz c-class": "saloon",
  "audi q5": "SUV",
  "mercedes-benz gla": "SUV",
  "tesla model y": "SUV",
  "bmw 4 series": "coupe",
  "volkswagen tiguan": "SUV",
  "vauxhall grandland": "SUV",
  "peugeot 2008": "SUV",
  "kia ceed": "hatchback",
  "volkswagen golf": "hatchback",
  "vauxhall corsa": "hatchback",
};

/** Unsplash's photos are tagged in US English: a UK "saloon" is a "sedan"
 *  there ("black saloon car" found nothing at all). */
const SEARCH_WORDS = { saloon: "sedan" };

// No `color=` filter, ever: it ranks photos by how much of the FRAME is that
// colour, so "red hatchback car" came back as fifteen paint close-ups and
// "green 4x4 car" as road markings. The colour word in the query does the job.

/** The car's body type: the map, then the post's own body_type, else null. */
export function bodyTypeFor(post) {
  const key = `${post.make ?? ""} ${post.model ?? ""}`.trim().toLowerCase();
  return BODY_TYPES[key] ?? (post.body_type ? String(post.body_type) : null);
}

/**
 * The Unsplash searches for one car, in order: the car itself ("Blue Audi
 * A4 Avant car"), then its colour and type ("Blue estate car"), which find.mjs
 * uses to top up a thin first result. Searching by model first also gives
 * two cars of the same colour and type different photos. (The owner chose
 * colour-and-type matching, so the fallback is still a fair match.)
 */
export function queriesFor(post) {
  const colour = String(post.colour ?? "").trim();
  const type = bodyTypeFor(post);
  const word = type ? (SEARCH_WORDS[type.toLowerCase()] ?? type) : null;
  // "car" on the end of the exact search too: "White Seat Ibiza" alone found
  // fifteen photos of the island.
  const exact = [colour, post.make, post.model, "car"].filter(Boolean).join(" ");
  const loose = [colour, word, "car"].filter(Boolean).join(" ");
  return exact === loose ? [loose] : [exact, loose];
}

/** A listing's title, as the app shows it: "Blue Toyota RAV4". */
export function titleFor(post) {
  return [post.colour, post.make, post.model].filter(Boolean).join(" ");
}

/** A short, stable tag for a pick's plate boxes ("0" when there are none),
 *  so a re-pick with a box added gets a NEW file name: an overwrite at the
 *  same URL could keep serving the unredacted copy from a CDN cache. */
export function boxesTag(boxes = []) {
  if (boxes.length === 0) return "0";
  const canonical = boxes.map((b) => [b.x, b.y, b.w, b.h].map((n) => n.toFixed(4)).join(",")).join(";");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 8);
}

/**
 * Where a demo photo lives in post-photos: inside the post owner's folder,
 * so the public URL also fits the app's own-folder rule (v_photo_url_re) and
 * a later edit through the RPCs stays valid. The name carries the Unsplash
 * id and the boxes tag, so any change to a pick is a new file, and the old
 * one is swept as an orphan once nothing references it.
 */
export function storagePath(post, position, unsplashId, boxes = []) {
  if (!isDemoPostId(post.id)) throw new Error(`not a demo post: ${post.id}`);
  if (!/^[A-Za-z0-9_-]+$/.test(unsplashId)) throw new Error(`bad photo id: ${unsplashId}`);
  if (!/^[0-9a-f-]{36}$/.test(String(post.owner_id))) throw new Error(`bad owner id: ${post.owner_id}`);
  return `${post.owner_id}/demo-${post.id}-${position}-${unsplashId}-${boxesTag(boxes)}.jpg`;
}

/** The file-name prefix of every demo photo of a post, inside its owner's
 *  folder (for listing leftovers on --remove). */
export function demoFilePrefix(postId) {
  if (!isDemoPostId(postId)) throw new Error(`not a demo post: ${postId}`);
  return `demo-${postId}-`;
}

const PUBLIC_PATH = "/storage/v1/object/public/post-photos/";

/** The public URL for a storage path, in the exact shape the app stores. */
export function publicUrl(supabaseUrl, path) {
  return `${supabaseUrl.replace(/\/+$/, "")}${PUBLIC_PATH}${path}`;
}

/** The storage path inside one of OUR public post-photos URLs, else null. */
export function pathFromPublicUrl(supabaseUrl, url) {
  const prefix = publicUrl(supabaseUrl, "");
  return typeof url === "string" && url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

/** The PostgREST filter for a post's DEMO rows only: rows this tool wrote
 *  carry "/demo-" in their URL; a real photo never does. */
export function demoRowsFilter(postId) {
  if (!isDemoPostId(postId)) throw new Error(`refusing to touch ${postId}`);
  return `post_id=eq.${postId}&url=like.*%2Fdemo-*`;
}

/** Whether a URL is Unsplash's API, the only host the Access Key may go to. */
export function isUnsplashApiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "api.unsplash.com";
  } catch {
    return false;
  }
}

/** The largest centred 4:3 rectangle inside a w×h image. (The shortlist
 *  page has a copy for its dimmed preview edges; keep them the same.) */
export function crop43(width, height) {
  const target = 4 / 3;
  if (width / height > target) {
    const w = Math.round(height * target);
    return { x: Math.round((width - w) / 2), y: 0, w, h: height };
  }
  const h = Math.round(width / target);
  return { x: 0, y: Math.round((height - h) / 2), w: width, h };
}

/**
 * A box the owner drew, as fractions (0–1) of the ORIGINAL photo, in pixels
 * of the processed output: shifted by the crop, scaled by the resize,
 * clamped to the frame. Null when the box falls outside the crop.
 */
export function scaleBox(box, original, crop, output) {
  const sx = output.w / crop.w;
  const sy = output.h / crop.h;
  const left = (box.x * original.w - crop.x) * sx;
  const top = (box.y * original.h - crop.y) * sy;
  const right = left + box.w * original.w * sx;
  const bottom = top + box.h * original.h * sy;
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const w = Math.min(output.w, Math.ceil(right)) - x;
  const h = Math.min(output.h, Math.ceil(bottom)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** A car's candidates from its two searches: the exact results, topped up
 *  from the loose ones, de-duplicated by photo id, at most `max`. */
export function mergeCandidates(first, second, max) {
  const seen = new Set(first.map((c) => c.id));
  return [...first, ...second.filter((c) => !seen.has(c.id))].slice(0, max);
}

/**
 * Whether an Unsplash response means "out of budget for this hour": a 429,
 * or a 403 that says so (remaining "0", or a body naming the rate limit).
 * Any other 403 is a bad or revoked key, a hard error, not "try in an hour".
 */
export function isRateLimited(status, remainingHeader, body = "") {
  if (status === 429) return true;
  if (status !== 403) return false;
  return remainingHeader === "0" || /rate limit/i.test(body);
}

/** Whether a pick's boxes are all well-formed fractions of the photo (a
 *  malformed picks.json must not crash the run or misplace a fill). */
export function validBoxes(boxes) {
  return (
    Array.isArray(boxes) &&
    boxes.every(
      (b) =>
        b &&
        [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
        b.w > 0 &&
        b.h > 0,
    )
  );
}

/** Whether a storage path is one of THIS post's demo files, directly in its
 *  owner's folder: the last check before anything is deleted, so even a
 *  stray row could never steer a delete at a real file. */
export function isDemoPathOf(post, path) {
  if (!isDemoPostId(post.id) || typeof post.owner_id !== "string" || typeof path !== "string") return false;
  const prefix = `${post.owner_id}/${demoFilePrefix(post.id)}`;
  return path.startsWith(prefix) && !path.slice(post.owner_id.length + 1).includes("/");
}

/** Unsplash's referral links, as its attribution guideline asks. */
export function creditLinks(username) {
  const utm = "utm_source=trackitdown&utm_medium=referral";
  return {
    photographer: `https://unsplash.com/@${username}?${utm}`,
    unsplash: `https://unsplash.com/?${utm}`,
  };
}
