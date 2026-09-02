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

## Boundary thickness + CAD object snap (2026-08-17)

12. **Scale-aware boundary / selection thickness**
    - Problem: Element outlines and selection boxes used fixed world-space `lineWidth` (e.g. `2` or `3`) while the canvas is transformed by `viewport.scale`. Zooming in made boundaries extremely thick and obscured the PDF.
    - Fix: Added `screenLineWidth(basePx)` and `screenPad(px)` helpers. Boundary and selection strokes now stay approximately constant on screen, and slightly thinner above ~200% zoom so fine detail remains readable.
    - Applied to polygon/rect element strokes, selection boxes, wall/beam strokes, and hover highlights.

13. **CAD-style object snap to element geometry**
    - Added `findNearestElementSnap(world)` that finds the nearest wall/beam segment, polygon edge, or rectangle edge within a ~14px screen tolerance (uses actual geometry, not only bbox).
    - On hover (Select and drawing tools): nearest element is highlighted (amber dashed outline); a crosshair marks the snap point.
    - When drawing walls, beams, slabs, columns, cutouts, or measuring: click position snaps to the highlighted geometry. Hold **Alt** to bypass snap and place exactly.
    - Extends the existing deduction-wall parent snap with a general-purpose mechanism for all takeoff elements (after AI Detect or manual draw).
    - Note: Snap targets existing takeoff geometry, not raw PDF vector operators (the underlay is rasterized by PDF.js).

## Overlapping elements + 3D window elevation (2026-08-17)

14. **Overlapping elements in 2D**
    - Hit-test now collects the full stack of elements under the cursor (`hitTestAllElements`).
    - **Ctrl/Cmd+click** cycles through the stack so the correct wall/column/beam/opening can be selected when they overlap.
    - Overlapping elements show a magenta dashed ring + stack badge (⧉).
    - Hover shows a name/type label listing every element under the cursor; selected/cycled items are marked.
    - Status bar reports `Overlap i/n: Label (Ctrl+click to cycle)` when cycling.

15. **3D window / opening vertical position**
    - Deduction/cutout path previously placed openings at `hM/2` from floor (sill ignored) → windows sat on the floor or looked wrong.
    - Now uses `getOpeningSillM` / `getOpeningHeightM`:
      - Sill defaults: window 0.9 m above FFL, door/opening 0 m (user can override).
      - Opening height defaults: window 1.2 m, door 2.1 m.
    - Box mesh mid-height = sill + openingHeight/2; polygon `yMode: bottom` sits on the sill.
    - Labels and camera bounds account for sill + head level.
    - High-level / ventilation windows preserve elevation when set in Properties (“Elevation above FFL”).

## Wall measurement + column deduction (2026-08-17)

16. **Net wall area with column & opening deductions**
    - `collectWallDeductions(wall)` gathers:
      - Openings/cutouts parented to the wall or overlapping it
      - Columns that intersect the wall in plan (auto), unless `skipWallDeduction`
    - Deduction = width along wall × min(opening/column height, wall height)
    - Wall **geometry is unchanged**; deductions are associated regions only
    - Live quantity table / Properties: Gross − Deduction = Net
    - Columns keep their own volume quantity

17. **2D workflow — Add Deduction**
    - On a selected wall, Properties shows **Add Deduction** (polygon cutout) and **Deduction along wall** (line tool)
    - Parent wall is locked via `pendingDeductionParentId` so the new region attaches to that wall
    - List of deductions shows openings (editable height, removable) and columns (toggle “Deduct this column from wall”)
    - Multiple deductions per wall supported (columns + doors/windows + drawn regions)

## Keep measurement tool active after Enter (2026-08-17)

18. **Enter finishes the current element only**
    - `stayInDrawingTool()` keeps wall/beam/slab/column/cutout/deduction_wall active after Enter, Done, or double-click complete.
    - Drawing buffers are cleared so the next click starts a new element of the same type.
    - Toolbar highlight and crosshair remain on the active tool.
    - Tool exits only on Esc (no in-progress points), selecting another tool, or Select/Pan.

## Research Dashboard – Pro manual recording (2026-08-17)

19. **Manual Pro/Simple measurement entry on dashboard**
    - New card: Participant, Mode (Pro default), type, user value, unit, optional reference/AI, drawing/project IDs, notes.
    - `POST /api/research/records/manual` — fully manual, no AI required.
    - `POST /api/research/records/update` — edit existing row in place.
    - Table **Edit** / **Delete** actions; form validates required fields with clear errors.
    - Manual methods (`manual_dashboard_entry` / `manual`) skip supersede so multiple types can coexist.
    - After save/update/delete: summary + records table refresh automatically.

20. **Pro mode independence from AI**
    - Dashboard manual entry never calls Gemini.
    - Live Pro takeoff still logs quantities via `MCResearch.logMeasurements` when a Participant ID is set, with or without AI Detect.
