# MeasureCraft Review Fixes

This build applies the highest-impact review and traceability fixes without changing the existing project format.

## AI detection and review

The backend now validates detection output before it reaches the browser. It normalizes supported element types, clips boxes to the source image, rejects malformed geometry, limits the result count, and suppresses near-duplicate boxes. The AI prompt now requests a confidence value from 0 to 1, but confidence is presented only as a review triage aid.

Simple Mode now treats new AI detections as **AI generated / unreviewed** until a user accepts them. The review step shows confidence, supports explicit QS review, and prevents costing from proceeding when no detection has been accepted. These decisions persist when sending a takeoff to Professional Mode.

Professional Mode now records `AI_GENERATED`, `QS_REVIEWED`, and `FINAL` states. Accepting an AI detection converts it to a retained QS-reviewed item, so it is not silently discarded on a future AI re-detection. Confirming the takeoff locks all elements and records a finalization timestamp; unlocking returns the items to their prior draft provenance.

## BOQ and audit trail

The live Professional Mode quantity table now includes review status and confidence. The exported Element Detail worksheet also includes Review Status and Confidence columns, allowing a reviewer to distinguish AI-generated quantities, QS-reviewed quantities, and final locked quantities.

## Validation

The backend, Professional Mode inline JavaScript, and Simple Mode inline JavaScript were syntax-checked. Both workflows were loaded in the local browser after the changes; no runtime errors were reported on page load.

## Geometry and measurement fixes

Pro Mode line-based walls and beams now transfer their exact endpoints, angle, length, and thickness to Simple Mode. Simple Mode renders those elements as rotated four-corner footprints rather than axis-aligned rectangles. The same line metadata is retained when returning to Pro Mode, with legacy rectangle payloads still supported through the previous inference fallback.

The Pro Mode measurement badge is now recalculated from the measurement midpoint in world coordinates whenever the canvas renders. It remains attached to the measured points while zooming, panning, fitting, or changing viewport scale.

Simple Mode wall quantities now use the preserved line length and thickness for line-based walls instead of using the bounding box dimensions.

## Validation

Both HTML pages returned HTTP 200 from the local server, and all inline JavaScript blocks in the patched Pro and Simple pages parsed successfully with Node.js syntax validation.


## Bug fixes (2026-08-13)

1. **Simple Mode review status column removed**  
   The Review status column (QS reviewed / AI generated) is no longer shown in the Material / element review table. Simple Mode is AI-driven without a separate QS review step in the UI.

2. **Simple → Pro transfer no longer drops AI elements**  
   Transfer always writes a full payload to IndexedDB. SessionStorage gets a lighter copy, with a no-image fallback if quota is exceeded.  
   Pro Mode no longer clears the pending flag before an async IndexedDB load finishes. If the session payload has fewer elements than IndexedDB, the full IDB payload is re-applied. Scale and elements are re-rendered after apply.

3. **Pro Mode badge “AE” → “AI”**  
   AI-edited elements now show the same **AI** badge as AI-generated ones (no more “AE”).

4. **Elevation guidance for openings and beams**  
   Windows/doors: Properties label is “Elevation above FFL” with preset buttons (Floor 0, 0.9, 1.0, 1.2 m).  
   Beams: “Elevation / soffit” with presets (Auto, 2.1–3.0 m).  
   First selection of a window/door or beam shows a toast tip that height is not always from floor level and can be adjusted.

5. **Done and Cut (×) buttons**  
   - **Done**: still finishes an in-progress polygon/line. When idle, confirms takeoff complete and opens Export so the user can download then log out.  
   - **Cut / × (Cancel)**: cancels an active drawing, or if idle and an underlay exists, confirms removal of the drawing underlay (elements kept) with a notification.  
   - **Delete (trash)**: notifies if nothing is selected.

## Export shortcut & AI re-detect (2026-08-13)

6. **Ctrl+S / Cmd+S opens Export**
   - Pro Mode: opens the existing Export modal (same as Export toolbar button).
   - Simple Mode: opens an Export options popup (Excel BOQ, copy text summary, or jump to Report & export step).
   - Browser “Save page” is prevented when the shortcut is handled.

7. **Second AI Detect run – warning & keep manual** *(superseded — see item 11)*
   - Pro Mode: clearer confirm dialog — previous AI-generated elements will be removed to avoid overlap; manual / AI-edited stay.
   - Simple Mode: same behaviour — confirm before re-run; only pure AI elements are removed; manual/edited kept and merged with the new detection.

## AI Detect clears all existing elements (2026-08-14)

11. **AI Detect now deletes manual + previous AI (with warning)**
   - Problem: After accurate manual measurements, running AI Detect produced overlapping boxes on the same geometry.
   - Change (Simple Mode + Pro Mode): When the user clicks AI Detect / Run AI detection and any elements already exist (manual and/or previous AI), a confirm popup warns that **all** current measurements — manual measured items and previous AI-detected elements (including accepted/edited) — will be deleted to avoid overlap, then replaces them with the new AI result.
   - Popup text explicitly lists counts of manual vs previous AI items when present.
   - UI copy updated so it no longer states that manual measurements are never removed by AI.

## Bug fixes (2026-08-13 evening)

8. **Opening / deduction height popup — FFL clarity**
   - Deduction Wall and polygon cutout prompts now state that the opening starts from **finished floor level (FFL)** (sill at 0 m = from floor) and that the entered value is the opening height deducted from the wall.
   - Window/door elevation prompt clarifies that the value is the **start height above FFL** (sill / bottom of opening), not the opening height itself.

9. **Simple → Pro: AI elements no longer dropped**
   - `buildTransferPayload` now always sends **all** elements (accepted, unreviewed AI, and manual) instead of filtering.
   - Transfer payload includes `from: 'simple'`.
   - Pro IndexedDB merge no longer requires `imageDataUrl` to restore elements; if sessionStorage lost elements (quota) but IDB has more, Pro clears and re-applies the full IDB list (no duplicates).
   - Transfer pending flag is always set after handoff so Pro attempts session + elements-only + IDB recovery paths.

## Bug fix: Simple AI detections dropped in Pro (2026-08-13)

10. **Simple → Pro: AI-detected elements now persist**
    - Root causes addressed:
      - `shortSide` was only defined when type was unknown; wall/beam path referenced it (fragile).
      - SessionStorage quota could drop the elements array while IndexedDB still held the full list; merge only ran when IDB count was strictly greater in some paths.
      - Per-element import had no try/catch, so one bad box could abort the whole import.
      - Confidence / explicit `accepted: false` / `reviewStatus: AI_GENERATED` were not always carried into Pro element objects.
    - Changes:
      - Always compute `longSide` / `shortSide` before wall/beam thickness logic.
      - Import each transfer item in try/catch; skip only the bad item.
      - Preserve AI `source`, `ai`, `confidence`, `reviewStatus`, and explicit `accepted` (including `false` for unreviewed detections).
      - Prefer `mc-plan-transfer-elements` backup whenever it has more elements than the main session payload.
      - Prefer IndexedDB full payload when restoring from Simple if session lost elements.
      - Simple `buildTransferPayload` always includes every element (AI + manual), with line metadata and explicit `accepted: true` only when the user accepted.
