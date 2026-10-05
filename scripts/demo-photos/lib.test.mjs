// WHAT:  Unit tests for the demo-photos tool's pure core (lib.mjs): the
//        dummy-post guard and query, env parsing, the search query per car,
//        storage paths, URLs and the row filter, the Unsplash host check, the
//        4:3 crop and the plate-box mapping.
// WHY:   apply.mjs writes to the hosted project with the service key. The
//        guard and the row filter are what stop it touching a real listing,
//        the path is what keeps the URL inside the app's own-folder rule, the
//        host check keeps the Access Key on Unsplash, and the box mapping is
//        what puts the fill on the plate rather than beside it.
// LINKS: scripts/demo-photos/lib.mjs; docs/DEMO_PHOTOS.md.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bodyTypeFor,
  boxesTag,
  crop43,
  creditLinks,
  demoFilePrefix,
  demoPostsQuery,
  demoRowsFilter,
  isDemoPostId,
  isUnsplashApiUrl,
  parseEnv,
  pathFromPublicUrl,
  publicUrl,
  queriesFor,
  scaleBox,
  storagePath,
  titleFor,
  isDemoPathOf,
  isRateLimited,
  mergeCandidates,
  validBoxes,
} from "./lib.mjs";

const BASE = "https://lbbbxelbembseohxjhkv.supabase.co";
const POST = {
  id: "b2b2b2b2-0000-0000-0000-000000000003",
  owner_id: "33333333-3333-3333-3333-333333333333",
  make: "Toyota",
  model: "RAV4",
  colour: "Blue",
};

test("only the 30 dummy post ids pass the guard", () => {
  const all = Array.from({ length: 30 }, (_, i) => `b2b2b2b2-0000-0000-0000-${(i + 1).toString(16).padStart(12, "0")}`);
  assert.equal(all.filter(isDemoPostId).length, 30);
  assert.equal(isDemoPostId(POST.id), true);
  // Numbered in hex: …0a and …1e are dummy posts, …1f and …20 are not.
  assert.equal(isDemoPostId("b2b2b2b2-0000-0000-0000-00000000000a"), true);
  assert.equal(isDemoPostId("b2b2b2b2-0000-0000-0000-00000000001e"), true);
  assert.equal(isDemoPostId("b2b2b2b2-0000-0000-0000-00000000001f"), false);
  assert.equal(isDemoPostId("b2b2b2b2-0000-0000-0000-000000000020"), false);
  assert.equal(isDemoPostId("b2b2b2b2-0000-0000-0000-000000000000"), false);
  assert.equal(isDemoPostId("b2b2b2b2-1234-0000-0000-000000000001"), false);
  assert.equal(isDemoPostId("a1a1a1a1-0000-0000-0000-000000000001"), false);
  assert.equal(isDemoPostId(undefined), false);
});

test("reads the dummy posts by id range, on the server", () => {
  assert.equal(
    demoPostsQuery("id,owner_id"),
    "posts?select=id,owner_id&id=gte.b2b2b2b2-0000-0000-0000-000000000001&id=lte.b2b2b2b2-0000-0000-0000-00000000001e&order=id",
  );
});

test("refuses to build a path or a row filter for a real post", () => {
  const real = { ...POST, id: "a1a1a1a1-0000-0000-0000-000000000001" };
  assert.throws(() => storagePath(real, 0, "abc"));
  assert.throws(() => demoRowsFilter(real.id));
  assert.throws(() => demoFilePrefix(real.id));
  assert.throws(() => storagePath(POST, 0, "../escape"));
  assert.throws(() => storagePath({ ...POST, owner_id: "../other" }, 0, "abc"));
});

test("parses .env lines: quotes kept whole, inline comments dropped", () => {
  assert.deepEqual(
    parseEnv('# note\nA=1\nB="two # not a comment"\n\nC=\'three\'\nD=abc   # the key\nE=x#y\nnot a line'),
    { A: "1", B: "two # not a comment", C: "three", D: "abc", E: "x#y" },
  );
});

test("searches for the exact car first, then its colour and type, with no colour filter", () => {
  assert.deepEqual(queriesFor(POST), ["Blue Toyota RAV4 car", "Blue SUV car"]);
  assert.deepEqual(queriesFor({ ...POST, colour: "Grey", make: "Ford", model: "Focus" }), ["Grey Ford Focus car", "Grey hatchback car"]);
  assert.equal(bodyTypeFor({ make: "Audi", model: "A4 Avant" }), "estate");
  // UK "saloon" searched as Unsplash's US "sedan".
  assert.deepEqual(queriesFor({ colour: "Black", make: "BMW", model: "5 Series" }), ["Black BMW 5 Series car", "Black sedan car"]);
  assert.equal(bodyTypeFor({ make: "Unknown", model: "Car", body_type: "Saloon" }), "Saloon");
  assert.deepEqual(queriesFor({ colour: "Silver", make: "Unknown", model: "Car" }), ["Silver Unknown Car car", "Silver car"]);
});

test("titles read as the app shows them", () => {
  assert.equal(titleFor(POST), "Blue Toyota RAV4");
});

test("paths sit in the owner's folder, and URLs fit the app's own-folder rule", () => {
  const path = storagePath(POST, 1, "AbC_12-x");
  assert.equal(path, `${POST.owner_id}/demo-${POST.id}-1-AbC_12-x-0.jpg`);
  const url = publicUrl(`${BASE}/`, path);
  // The v_photo_url_re shape (20260902150000_post_remembers_its_vehicle.sql).
  const rule = new RegExp(
    `^https?://([a-z0-9-]+\\.supabase\\.co)/storage/v1/object/public/post-photos/${POST.owner_id}/[^/]+$`,
  );
  assert.match(url, rule);
  assert.ok(path.slice(POST.owner_id.length + 1).startsWith(demoFilePrefix(POST.id)));
});

test("a pick with boxes gets a new file name, so a fix never reuses a cached URL", () => {
  const box = { x: 0.4, y: 0.6, w: 0.2, h: 0.1 };
  assert.equal(boxesTag([]), "0");
  assert.match(boxesTag([box]), /^[0-9a-f]{8}$/);
  assert.equal(boxesTag([box]), boxesTag([{ ...box }]));
  assert.notEqual(boxesTag([box]), boxesTag([{ ...box, w: 0.25 }]));
  assert.notEqual(storagePath(POST, 0, "abc"), storagePath(POST, 0, "abc", [box]));
});

test("reads a storage path back out of our public URL, and nothing else", () => {
  const path = storagePath(POST, 0, "abc");
  assert.equal(pathFromPublicUrl(BASE, publicUrl(BASE, path)), path);
  assert.equal(pathFromPublicUrl(`${BASE}/`, publicUrl(BASE, path)), path);
  assert.equal(pathFromPublicUrl(BASE, "https://images.unsplash.com/photo-1"), null);
  assert.equal(pathFromPublicUrl(BASE, undefined), null);
});

test("the row filter only reaches this post's demo rows", () => {
  assert.equal(demoRowsFilter(POST.id), `post_id=eq.${POST.id}&url=like.*%2Fdemo-*`);
});

test("the Access Key only ever goes to api.unsplash.com over https", () => {
  assert.equal(isUnsplashApiUrl("https://api.unsplash.com/photos/abc/download?ixid=1"), true);
  assert.equal(isUnsplashApiUrl("http://api.unsplash.com/photos/abc/download"), false);
  assert.equal(isUnsplashApiUrl("https://api.unsplash.com.evil.example/x"), false);
  assert.equal(isUnsplashApiUrl("https://images.unsplash.com/photo-1"), false);
  assert.equal(isUnsplashApiUrl("not a url"), false);
});

test("crops the largest centred 4:3", () => {
  assert.deepEqual(crop43(4000, 2000), { x: 667, y: 0, w: 2667, h: 2000 });
  assert.deepEqual(crop43(3000, 3000), { x: 0, y: 375, w: 3000, h: 2250 });
  assert.deepEqual(crop43(1600, 1200), { x: 0, y: 0, w: 1600, h: 1200 });
});

test("maps a plate box from the original photo onto the output", () => {
  const original = { w: 4000, h: 2000 };
  const crop = crop43(4000, 2000); // x 667, w 2667
  const output = { w: 1600, h: 1200 };
  // A box in the middle of the original: x 0.45–0.55, y 0.70–0.80.
  const box = scaleBox({ x: 0.45, y: 0.7, w: 0.1, h: 0.1 }, original, crop, output);
  assert.deepEqual(box, { x: 679, y: 840, w: 241, h: 120 });
});

test("drops a box the crop removed, and clamps one the crop cuts", () => {
  const original = { w: 4000, h: 2000 };
  const crop = crop43(4000, 2000);
  const output = { w: 1600, h: 1200 };
  assert.equal(scaleBox({ x: 0.01, y: 0.5, w: 0.05, h: 0.1 }, original, crop, output), null);
  const cut = scaleBox({ x: 0.15, y: 0.5, w: 0.1, h: 0.1 }, original, crop, output);
  assert.equal(cut.x, 0);
  assert.ok(cut.w > 0 && cut.w < 241);
});

test("credit links carry Unsplash's referral parameters", () => {
  assert.deepEqual(creditLinks("anniespratt"), {
    photographer: "https://unsplash.com/@anniespratt?utm_source=trackitdown&utm_medium=referral",
    unsplash: "https://unsplash.com/?utm_source=trackitdown&utm_medium=referral",
  });
});

test("one search when the exact and loose queries would be the same", () => {
  assert.deepEqual(queriesFor({ colour: "Silver" }), ["Silver car"]);
});

test("merges a car's two searches: exact first, de-duplicated, capped", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  assert.deepEqual(mergeCandidates([a, b], [b, c], 15), [a, b, c]);
  assert.deepEqual(mergeCandidates([a, b], [c], 2), [a, b]);
  assert.deepEqual(mergeCandidates([], [c], 15), [c]);
});

test("only a 429, or a 403 that says so, counts as a rate limit", () => {
  assert.equal(isRateLimited(429, null), true);
  assert.equal(isRateLimited(403, "0"), true);
  assert.equal(isRateLimited(403, null, "Rate Limit Exceeded"), true);
  // A revoked or wrong key is a hard error, not "try again in an hour".
  assert.equal(isRateLimited(403, "37", "OAuth error: The access token is invalid"), false);
  assert.equal(isRateLimited(401, "0"), false);
  assert.equal(isRateLimited(200, "0"), false);
});

test("accepts only well-formed boxes, as fractions of the photo", () => {
  assert.equal(validBoxes([]), true);
  assert.equal(validBoxes([{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }]), true);
  assert.equal(validBoxes([{ x: 0.1, y: 0.2, w: 0, h: 0.1 }]), false);
  assert.equal(validBoxes([{ x: "0.1", y: 0.2, w: 0.3, h: 0.1 }]), false);
  assert.equal(validBoxes([{ x: 1.5, y: 0.2, w: 0.3, h: 0.1 }]), false);
  assert.equal(validBoxes([null]), false);
  assert.equal(validBoxes("nope"), false);
});

test("the delete guard only passes this post's demo files in its owner folder", () => {
  const path = storagePath(POST, 0, "abc");
  assert.equal(isDemoPathOf(POST, path), true);
  assert.equal(isDemoPathOf(POST, `${POST.owner_id}/hero-1.jpg`), false);
  assert.equal(isDemoPathOf(POST, `${POST.owner_id}/demo-${POST.id}-0-x/../../real.jpg`), false);
  assert.equal(isDemoPathOf(POST, `other-owner/demo-${POST.id}-0-abc-0.jpg`), false);
  const other = { ...POST, id: "b2b2b2b2-0000-0000-0000-000000000004" };
  assert.equal(isDemoPathOf(other, path), false);
  assert.equal(isDemoPathOf(POST, null), false);
  assert.equal(isDemoPathOf({ ...POST, owner_id: null }, path), false);
});
