// WHAT:  Offline tests for editedCopy: the output is a 1600×1200 JPEG, an
//        EXIF segment (with GPS) in the input does not survive, and a marked
//        box is filled solid while the rest of the photo is untouched.
// WHY:   These copies go into a public bucket. A copy that kept the
//        original's metadata, or left a plate readable, is the failure that
//        matters, and neither shows up until someone looks at the photo.
// LINKS: scripts/demo-photos/edit.mjs.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { test } from "node:test";

import { editedCopy } from "./edit.mjs";

const require = createRequire(import.meta.url);
const Jimp = require("jimp-compact");

/** A 2000×1000 test photo with fine black/white stripes, so a filled box is
 *  easy to detect (stripes have a wide grey spread, a fill has none). */
async function stripedImage() {
  const image = new Jimp(2000, 1000, 0xffffffff);
  image.scan(0, 0, 2000, 1000, function (x, _y, idx) {
    const v = x % 2 === 0 ? 0 : 255;
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = v;
    this.bitmap.data[idx + 2] = v;
  });
  return image;
}

/**
 * A JPEG carrying a real APP1 Exif segment with a GPS IFD pointer and a
 * recognisable marker string, spliced in after SOI: what a phone photo with
 * location looks like to a parser that only checks for the segment.
 */
async function jpegWithExif() {
  const jpeg = await (await stripedImage()).quality(90).getBufferAsync(Jimp.MIME_JPEG);
  // TIFF header (little-endian) + IFD0 with one entry: GPSInfo (0x8825) → offset 26,
  // then a GPS IFD with one entry (GPSLatitudeRef = "N").
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x25, 0x88, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x01, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x4e, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0"), tiff, Buffer.from("SECRET-GPS-MARKER")]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/** Spread of grey values in a region: wide for stripes, ~0 for a fill. */
function spread(image, x, y, w, h) {
  let min = 255;
  let max = 0;
  image.scan(x, y, w, h, function (_x, _y, idx) {
    const v = this.bitmap.data[idx];
    min = Math.min(min, v);
    max = Math.max(max, v);
  });
  return max - min;
}

test("drops an EXIF (GPS) segment the input carried, and outputs 1600×1200 JPEG", async () => {
  const input = await jpegWithExif();
  // The fixture really does carry it, so the check below can fail...
  assert.equal(input.includes(Buffer.from("Exif\0\0")), true);
  assert.equal(input.includes(Buffer.from("SECRET-GPS-MARKER")), true);
  const out = await editedCopy(input);
  // ...and the copy does not.
  assert.equal(out.includes(Buffer.from("Exif\0\0")), false);
  assert.equal(out.includes(Buffer.from("SECRET-GPS-MARKER")), false);
  assert.equal(out[0], 0xff);
  assert.equal(out[1], 0xd8); // JPEG SOI
  const image = await Jimp.read(out);
  assert.equal(image.bitmap.width, 1600);
  assert.equal(image.bitmap.height, 1200);
});

test("fills a marked box solid and leaves the rest alone", async () => {
  const input = await (await stripedImage()).getBufferAsync(Jimp.MIME_PNG);
  // A box in the middle of the original: 40–60% across, 60–80% down.
  const out = await Jimp.read(await editedCopy(input, [{ x: 0.4, y: 0.6, w: 0.2, h: 0.2 }]));
  // Its output position: crop x 333 w 1333, scale 1.2 → x 560–1040, y 720–960.
  const inside = spread(out, 600, 760, 300, 160);
  const outside = spread(out, 100, 100, 200, 120);
  assert.ok(inside < 25, `box region still detailed (spread ${inside})`);
  assert.ok(outside > 100, `untouched region lost detail (spread ${outside})`);
});
