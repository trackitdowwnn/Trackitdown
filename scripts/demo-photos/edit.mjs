// WHAT:  editedCopy — turns a downloaded Unsplash photo into the demo copy we
//        upload: centre 4:3 crop, 1600×1200, any box the owner drew filled
//        solid, and re-encoded as JPEG q80.
// WHY:   Writing a fresh image from the raw pixels is what drops every
//        EXIF/GPS tag (the app's own upload rule, scripts/check-exif-strip.mjs;
//        a plain Jimp re-encode does NOT, see below), and the
//        edits make the copy a derivative, the case Unsplash's hotlinking
//        guideline exempts. Boxes are FILLED, not pixelated: UK plates use one
//        fixed font, so a coarse pixelation can be partly reversed. (Boxes are
//        a last resort anyway: the original is public on Unsplash, so the rule
//        is to pick photos with no readable plate or identifiable person.)
//        Kept apart from apply.mjs so it is tested offline.
// LINKS: scripts/demo-photos/lib.mjs (crop43, scaleBox); apply.mjs;
//        scripts/demo-photos/edit.test.mjs; docs/DEMO_PHOTOS.md.

import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

import { crop43, OUTPUT_HEIGHT, OUTPUT_WIDTH, scaleBox } from "./lib.mjs";

const require = createRequire(import.meta.url);
const Jimp = require("jimp-compact");

/** The fill for redacted boxes: the app's near-black ink. */
const FILL = Jimp.rgbaToInt(26, 26, 26, 255);

/** The demo copy of a photo, as JPEG bytes. Boxes are fractions of the
 *  ORIGINAL photo (as drawn on the shortlist). */
export async function editedCopy(bytes, boxes = []) {
  const image = await Jimp.read(bytes);
  const original = { w: image.bitmap.width, h: image.bitmap.height };
  const crop = crop43(original.w, original.h);
  image.crop(crop.x, crop.y, crop.w, crop.h).resize(OUTPUT_WIDTH, OUTPUT_HEIGHT);
  const output = { w: OUTPUT_WIDTH, h: OUTPUT_HEIGHT };
  for (const box of boxes) {
    const scaled = scaleBox(box, original, crop, output);
    if (scaled) {
      image.scan(scaled.x, scaled.y, scaled.w, scaled.h, function (x, y) {
        this.setPixelColor(FILL, x, y);
      });
    }
  }
  // ⚠️ A FRESH image from the raw pixels, never `image` itself: Jimp keeps a
  // decoded JPEG's EXIF bytes on the bitmap (bitmap.exifBuffer) and its
  // encoder writes them straight back out, GPS and all. "Re-encoding strips
  // EXIF" is false for Jimp; only pixels-only output is. edit.test.mjs pins
  // it with a real EXIF+GPS input (it failed until this line existed).
  const clean = new Jimp({ data: Buffer.from(image.bitmap.data), width: output.w, height: output.h });
  return clean.quality(80).getBufferAsync(Jimp.MIME_JPEG);
}
