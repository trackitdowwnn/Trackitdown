# Plate scanning: decisions (agreed 2026-10-30)

How the app suggests a number plate from the photos an owner adds (My cars → Add a car, and the stolen-car report). Agreed with the owner after a measured baseline; this records what was decided and why.

## The problem, measured

80 openly licensed photos of UK cars from Wikimedia Commons (65 with a readable plate, 15 without), labelled by hand and run through the real pipeline on an emulator (dev-only harness, never merged: branch `tools/plate-eval`).

| | Plates found | Suggestions wrong | Silent on no-plate photos |
|---|---|---|---|
| Today (ML Kit on the whole photo, best UK-shaped text) | 58% | **45%** | 13% |

Beta telemetry agreed: the sheet was rejected 5 times out of 6. Wrong suggestions came from **another vehicle's plate** in the frame (14 of 31), **near misses** of one or two characters (10) and **non-plate text** that fits a UK shape (7). Downscaling to 2000px was not a cause: full-resolution input did worse (42% found, 58% wrong).

The set leans to classic cars and daylight; night, rain and dirty plates are barely covered.

## Decisions

1. **The go/no-go metric is wrong suggestions.** Target: under 5% of suggestions wrong, and none on photos without a plate. Offering nothing beats offering a wrong plate, because a listing's plate can never be changed.
2. **Accuracy: A + B now, then C1.**
   - **A, selection rules.** Ignore lines with lowercase letters; at most one corrected character (none for dateless and suffix shapes); suggest only the largest plate text; say nothing if it is too small (under 2% of the photo's height) or if a second plate is nearly as large (at least 70% of its height). Fixes the bug where a whole line of badge text ("ST LINE") was corrected into a plate ("S71 INE"). Measured: 40% found, 28% wrong, 87% silent.
   - **B, second read.** Crop each plate-shaped line from the full-size photo, read it again, and suggest only when both reads agree (position-aware correction allowed for current and prefix shapes, at most one character). Measured with A: 37% found, **17% wrong**, 87% silent; +0.1–0.3 s per photo.
   - **C1, DVLA make check** (next, once Trackitdown Limited has a Vehicle Enquiry Service API key). Only the candidate plate text goes to our Edge Function, which asks DVLA for its make and colour. A plate whose make matches what the owner entered is confirmed. Modelled: ~58% found, ~0–3% wrong.
   - **On a DVLA make mismatch, say nothing.** Treat it as a misread; never show another vehicle's details.
   - **Rejected:** full-resolution input (worse); a cloud recognition service (sends every photo to a US processor, per-photo cost, accuracy unmeasured); an on-device plate detector (new native build, a model to train or license, and B already gets most of its benefit).
3. **UX, approved as proposed.** One suggestion, with a crop of the plate beside it so the owner can check it at a glance; "✓ <make> · <colour>" only when DVLA confirms; "Which plate is your car's?" with two crops when two cars are equally in shot; no sheet when unsure, nothing found or on error. The plate step then says it could not read the plate and offers **Add a close photo of the plate** (camera) alongside the existing skip. Typing keeps auto-spacing, capitals and the non-blocking format warning. Screen readers hear the plate spelt out and a label for the crop.
4. **Privacy.** A and B run entirely on the phone: no photo or plate leaves it and nothing new is stored. C1 sends only plate text, from an authenticated, rate-limited Edge Function; neither the plate nor DVLA's answer is stored (outcome only). The privacy policy and the Art. 30 record gain an entry before C1 ships.
5. **Logging.** Per photo step: the scan outcome (none, likely, confirmed, two cars, error), the candidate count and timing; and how it ended (accepted, edited with an edit-distance bucket, typed, skipped). Never plate text or images.
6. **Rollout.** Behind `EXPO_PUBLIC_PLATE_SCAN_V2`, on for preview testers first. C1 also has a server-side off switch.

## Phases

- **4a:** selection rules, the bug fix, one suggestion, logging, the flag. Checkpoint: ≤ 28% wrong on the set.
- **4b:** second read, plate crops and the new states. Checkpoint: ≤ 17% wrong, plus a device check.
- **4c:** DVLA check (owner applies for the key). Checkpoint: DVLA's test endpoint, then a real car.
- **5:** re-run the evaluation, tests, handover.

## Evaluation data

Photos, labels and raw OCR live outside the repo (they show real registrations) and are deleted when this work ends. Attribution for every photo is kept with them.
